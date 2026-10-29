import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQueries } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCheckinUpdates } from "./useCheckinUpdates";

const realtime = vi.hoisted(() => ({ callbacks: new Map<string, () => void>(), remove: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_event: string, filter: { table: string }, callback: () => void) => {
      realtime.callbacks.set(filter.table, callback);
      return channel;
    },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: realtime.remove } };
});

let root: Root | undefined;
let client: QueryClient;
beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  client?.clear();
  realtime.callbacks.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mount() {
  const calls = { today: vi.fn(), "current-shift": vi.fn(), eligibility: vi.fn(), counts: vi.fn(), shifts: vi.fn() };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  function Probe() {
    useCheckinUpdates("p1");
    useQueries({ queries: Object.entries(calls).map(([name, record]) => ({
      queryKey: name === "today" || name === "counts" ? ["checkin", name, "p1"] : ["checkin", name],
      queryFn: async () => { record(); return []; },
    })) });
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => { root!.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
  await vi.waitFor(() => expect(calls.today).toHaveBeenCalledTimes(1));
  vi.useFakeTimers();
  return calls;
}

describe("atualizações de check-in em rajada", () => {
  it("agrupa presenças sem recarregar catálogo ou contadores de leads", async () => {
    const calls = await mount();
    for (let i = 0; i < 30; i++) realtime.callbacks.get("checkins")!();
    expect(calls.today).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls.today).toHaveBeenCalledTimes(2);
    expect(calls["current-shift"]).toHaveBeenCalledTimes(2);
    expect(calls.eligibility).toHaveBeenCalledTimes(2);
    expect(calls.counts).toHaveBeenCalledTimes(1);
    expect(calls.shifts).toHaveBeenCalledTimes(1);
  });

  it("inclui contadores quando a rajada também altera atribuições", async () => {
    const calls = await mount();
    realtime.callbacks.get("checkins")!();
    realtime.callbacks.get("lead_assignments")!();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls.today).toHaveBeenCalledTimes(2);
    expect(calls.counts).toHaveBeenCalledTimes(2);
    expect(calls.shifts).toHaveBeenCalledTimes(1);
  });

  it("cancela recargas pendentes ao sair da tela", async () => {
    const calls = await mount();
    realtime.callbacks.get("checkins")!();
    act(() => root?.unmount());
    root = undefined;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.today).toHaveBeenCalledTimes(1);
  });
});
