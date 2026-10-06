import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLeadsRealtime } from "./data";

/**
 * Rajada de eventos em `leads` vira uma recarga só. A importação da Leadfy
 * (02/10/2026) gravou ~25 mil leads e cada evento recarregava a lista inteira
 * em toda tela de Leads aberta — o banco afogou e o Dashboard parou.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ouvintes: Array<() => void> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: () => {
      const chain = {
        on: (_tipo: string, _filtro: unknown, fn: () => void) => { ouvintes.push(fn); return chain; },
        subscribe: () => chain,
      };
      return chain;
    },
    removeChannel: () => undefined,
  },
}));

afterEach(() => {
  vi.useRealTimers();
  ouvintes.length = 0;
});

function Ouvinte() {
  useLeadsRealtime("teste");
  return null;
}

describe("useLeadsRealtime", () => {
  it("junta a rajada de eventos numa recarga só", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const invalidar = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => {
      root.render(<QueryClientProvider client={client}><Ouvinte /></QueryClientProvider>);
    });

    for (let i = 0; i < 500; i++) ouvintes[i % ouvintes.length]();
    expect(invalidar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(invalidar).toHaveBeenCalledTimes(1);

    // Evento depois da janela agenda outra recarga.
    ouvintes[0]();
    vi.advanceTimersByTime(1500);
    expect(invalidar).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });
});
