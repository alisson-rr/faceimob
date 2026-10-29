import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMyQueues } from "./useMyQueues";

const mocks = vi.hoisted(() => ({
  getMyQueues: vi.fn(),
  channels: [] as { handlers: (() => void)[] }[],
  removeChannel: vi.fn(),
}));
vi.mock("@/integrations/supabase/checkin", () => ({ getMyQueues: mocks.getMyQueues }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const channel = {
        handlers: [] as (() => void)[],
        on(_event: string, _filter: unknown, handler: () => void) {
          this.handlers.push(handler);
          return this;
        },
        subscribe() { return this; },
      };
      mocks.channels.push(channel);
      return channel;
    },
    removeChannel: mocks.removeChannel,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let results: ReturnType<typeof useMyQueues>[];

function Consumer({ profileId, slot }: { profileId: string | null; slot: number }) {
  results[slot] = useMyQueues(profileId);
  return null;
}

async function render(profiles: (string | null)[]) {
  await act(async () => {
    root.render(<QueryClientProvider client={client}>
      {profiles.map((profileId, slot) => <Consumer key={slot} slot={slot} profileId={profileId} />)}
    </QueryClientProvider>);
  });
  await tick(1);
}
async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
function event() { mocks.channels.at(-1)!.handlers.forEach((handler) => handler()); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  mocks.getMyQueues.mockReset().mockResolvedValue([]);
  mocks.removeChannel.mockClear();
  mocks.channels.length = 0;
  results = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useMyQueues", () => {
  it("compartilha chamada, canal e polling entre consumidores do mesmo perfil", async () => {
    await render(["a", "a"]);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(1);
    expect(mocks.channels).toHaveLength(1);
    await tick(60_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
    await render(["a"]);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
    await tick(60_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(3);
  });

  it("agrupa rajadas em 1s sem reiniciar o timer e invalida apenas a chave exata", async () => {
    await render(["a", "a"]);
    client.setQueryData(["my-queues", "a", "other"], []);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    event();
    await tick(900);
    event();
    results[0].scheduleRefresh();
    await tick(100);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(
      { queryKey: ["my-queues", "a"], exact: true, refetchType: "active" }, { cancelRefetch: false },
    );
    expect(client.getQueryState(["my-queues", "a", "other"])?.isInvalidated).toBe(false);
  });

  it("não duplica chamada lenta quando realtime e polling coincidem", async () => {
    await render(["a", "a"]);
    let resolve!: (value: never[]) => void;
    mocks.getMyQueues.mockImplementation(() => new Promise<never[]>((done) => { resolve = done; }));
    event();
    await tick(1_000);
    event();
    await tick(1_000);
    await act(async () => { void results[0].refetch({ cancelRefetch: false }); });
    await tick(60_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
    await act(async () => resolve([]));
    await tick(1);
    expect(results[0].data).toEqual([]);
  });

  it("limpa canal e timers ao trocar perfil/desmontar e isola os dados", async () => {
    mocks.getMyQueues.mockImplementation(async (profileId: string) => [{ groupId: profileId, entries: [] }]);
    await render(["a", "a"]);
    event();
    const oldChannel = mocks.channels[0];
    await render(["b", "b"]);
    expect(mocks.removeChannel).toHaveBeenCalledWith(oldChannel);
    await tick(1_000);
    expect(mocks.getMyQueues.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
    expect(results[0].data?.[0].groupId).toBe("b");
    event();
    await render([]);
    await tick(120_000);
    oldChannel.handlers.forEach((handler) => handler());
    await tick(1_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
    expect(mocks.removeChannel).toHaveBeenCalledTimes(2);
  });

  it("reconsulta no retorno à aba mesmo com cache recente", async () => {
    await render(["a", "a"]);
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await tick(1);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
  });

  it("expõe erro e permite nova tentativa sem cancelar chamada concorrente", async () => {
    mocks.getMyQueues.mockRejectedValueOnce(new Error("offline"));
    await render(["a"]);
    expect(results[0].error?.message).toBe("offline");
    await act(async () => { await results[0].refetch({ cancelRefetch: false }); });
    await tick(1);
    expect(results[0].isSuccess).toBe(true);
  });

  it("não consulta nem assina sem perfil", async () => {
    await render([null]);
    await tick(60_000);
    expect(mocks.getMyQueues).not.toHaveBeenCalled();
    expect(mocks.channels).toHaveLength(0);
  });

  it("suspende polling oculto e preserva evento dirty para retorno à aba", async () => {
    await render(["a", "a"]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    await tick(120_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(1);
    expect(client.getQueryState(["my-queues", "a"])?.isInvalidated).toBe(false);
    event();
    await tick(1_000);
    expect(client.getQueryState(["my-queues", "a"])?.isInvalidated).toBe(true);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(1);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    await tick(1);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
    await tick(60_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(3);
  });

  it("preserva evento pendente ao ocultar e não duplica a leitura no retorno", async () => {
    await render(["a", "a"]);
    event();
    await tick(100);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    expect(client.getQueryState(["my-queues", "a"])?.isInvalidated).toBe(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange", { bubbles: true })); });
    await tick(1_000);
    expect(mocks.getMyQueues).toHaveBeenCalledTimes(2);
  });


});
