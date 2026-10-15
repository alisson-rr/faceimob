import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Checkin from "./Checkin";
import { LeadsCheckinCard } from "@/components/checkin/LeadsCheckinCard";

const mocks = vi.hoisted(() => ({ action: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/checkinAction", () => ({ checkinAction: mocks.action }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "p1" }, roles: ["broker"], isAdmin: false }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/QueuePosition", () => ({ default: () => null }));
vi.mock("@/components/LeadCounter", () => ({ default: () => null }));
vi.mock("@/components/checkin/CheckinExterno", () => ({ CheckinExterno: () => null }));
vi.mock("@/integrations/supabase/checkin", () => ({
  listWorkShifts: vi.fn(), listTodayCheckins: vi.fn(), getCurrentShiftId: vi.fn(), getCheckinEligibility: vi.fn(), getLeadCounts: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; }, removeChannel: vi.fn(),
} }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const data: Record<string, unknown> = {
      shifts: [{ id: "s1", label: "Manhã", checkin_start: "09:00", distribution_start: "09:30", checkout_time: "12:00" }],
      today: [], "current-shift": "s1", eligibility: { allowed: true }, counts: { today: 0, week: 0, month: 0 },
    };
    return { data: data[queryKey[1]], isPending: false, error: null };
  },
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.invalidate.mockImplementation(() => new Promise(() => {}));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe.each(["pagina", "card"])("check-in pela %s", (surface) => {
  async function render() {
    await act(async () => root.render(<MemoryRouter>{surface === "pagina" ? <Checkin /> : <LeadsCheckinCard />}</MemoryRouter>));
  }
  it("leitura posterior travada não mantém Aguarde após a gravação", async () => {
    mocks.action.mockResolvedValue(undefined);
    await render();
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Fazer check-in"))!;
    await act(async () => button.click());
    expect(mocks.action).toHaveBeenCalledWith("checkin");
    expect(button.disabled).toBe(false);
    expect(host.textContent).not.toContain("Aguarde…");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("timeout libera nova tentativa e relê presença sem informar sucesso", async () => {
    mocks.action.mockRejectedValue(new Error("O servidor demorou para confirmar."));
    await render();
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Fazer check-in"))!;
    await act(async () => button.click());
    expect(button.disabled).toBe(false);
    expect(mocks.error).toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.invalidate).toHaveBeenCalled();
  });
});
