import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadCheckinButton } from "./LeadCheckinButton";

const state = vi.hoisted(() => ({
  shift: "shift-1" as string | null,
  allowed: true,
  reason: "Tudo certo.",
  active: false,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "broker" } }) }));
vi.mock("@/integrations/supabase/checkin", () => ({
  getCurrentShiftId: async () => state.shift,
  getCheckinEligibility: async () => ({ allowed: state.allowed, reason: state.reason, overdue_count: 0, threshold: 20 }),
  listTodayCheckins: async () => state.active ? [{
    id: "checkin", shift_id: "shift-1", work_date: "2026-10-01", checked_in_at: "2026-10-01T10:00:00Z",
    checked_out_at: null, auto_checkout: false, leads_received: 0,
  }] : [],
  performBrokerPresence: vi.fn(async () => undefined),
}));
vi.mock("@/integrations/supabase/client", () => {
  const channel = { on: vi.fn(), subscribe: vi.fn() } as {
    on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>;
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return { supabase: { channel: () => channel, removeChannel: vi.fn() } };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderButton() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => {
    root.render(<QueryClientProvider client={client}><LeadCheckinButton /></QueryClientProvider>);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(container.textContent).not.toMatch(/Verificando/);
  return {
    container,
    cleanup: async () => { await act(async () => root.unmount()); client.clear(); container.remove(); },
  };
}

describe("LeadCheckinButton", () => {
  beforeEach(() => {
    state.shift = "shift-1";
    state.allowed = true;
    state.reason = "Tudo certo.";
    state.active = false;
  });

  it("chama para a roleta com animação quando o corretor está inativo", async () => {
    const view = await renderButton();
    const button = view.container.querySelector("button")!;
    expect(button.textContent).toMatch(/Fazer check-in/i);
    expect(button.className).toContain("motion-safe:animate-pulse");
    expect(button.disabled).toBe(false);
    await view.cleanup();
  });

  it("mostra claramente quando o check-in está ativo", async () => {
    state.active = true;
    const view = await renderButton();
    const button = view.container.querySelector("button")!;
    expect(button.textContent).toMatch(/Check-in ativo/i);
    expect(button.getAttribute("aria-label")).toMatch(/você está na roleta/i);
    await view.cleanup();
  });

  it("explica o bloqueio em vez de oferecer um clique que o banco recusará", async () => {
    state.allowed = false;
    state.reason = "Regularize seus leads atrasados.";
    const view = await renderButton();
    const button = view.container.querySelector("button")!;
    expect(button.disabled).toBe(true);
    expect(view.container.textContent).toMatch(/Regularize seus leads atrasados/i);
    await view.cleanup();
  });
});
