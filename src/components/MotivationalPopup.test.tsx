import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { MotivationalPopup } from "./MotivationalPopup";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "welcome-broker" }, roles: ["broker"], isAdmin: false }),
}));
vi.mock("@/components/leads/mensagensProntasData", () => ({ useMeuApelido: () => "Júlia" }));
vi.mock("@/integrations/supabase/reviews", () => ({ useMyPendingReviewDealIds: () => ({ data: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
}));
vi.mock("@/lib/engagement/audio", () => ({ playSound: vi.fn() }));
vi.mock("@/components/engagement/Confetti", () => ({ fireConfetti: vi.fn() }));

it("não abre boas-vindas sobre o lead, mesmo se o temporizador do login terminar", async () => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = async (paused: boolean) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter><MotivationalPopup paused={paused} /></MemoryRouter>
        </QueryClientProvider>,
      );
    });
  };
  try {
    await render(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render(false);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Júlia");
    await render(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    client.clear();
    vi.useRealTimers();
  }
});
