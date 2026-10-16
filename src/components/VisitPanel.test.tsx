import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitRecord } from "@/integrations/supabase/activities";
const api = vi.hoisted(() => ({ list: vi.fn(), schedule: vi.fn(), warning: vi.fn() }));
vi.mock("@/integrations/supabase/activities", () => ({
  listVisitsFor: api.list, scheduleVisit: api.schedule, setVisitResult: vi.fn(),
  VISIT_RESULT_LABEL: { scheduled: "Agendada", completed: "Realizada", no_show: "Não compareceu", cancelled: "Cancelada" },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "b" } }) }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: api.warning } }));
import VisitPanel from "./VisitPanel";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let visits: VisitRecord[];
const change = async (label: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const schedule = async () => {
  const button = Array.from(container.querySelectorAll("button")).find((element) => /Agendar/.test(element.textContent || ""))!;
  await act(async () => button.click());
};
beforeEach(async () => {
  vi.clearAllMocks();
  visits = [];
  api.list.mockImplementation(async () => [...visits]);
  api.schedule.mockImplementation(async (input) => {
    const visit = { id: String(visits.length + 1), scheduled_at: input.scheduledAt, ends_at: input.endsAt ?? null, result: "scheduled" } as VisitRecord;
    visits.push(visit);
    return visit;
  });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root.render(<VisitPanel leadId="l" brokerId="b" />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("intervalo manual da visita", () => {
  it("envia dois intervalos explícitos não sobrepostos no mesmo dia", async () => {
    await change("Data e hora da visita", "2026-10-20T10:00");
    await change("Data e hora de término da visita (opcional)", "2026-10-20T10:30");
    await schedule();
    await change("Data e hora da visita", "2026-10-20T11:00");
    await change("Data e hora de término da visita (opcional)", "2026-10-20T12:15");
    await schedule();
    expect(api.schedule).toHaveBeenCalledTimes(2);
    expect(api.schedule.mock.calls.map(([input]) => [input.scheduledAt, input.endsAt])).toEqual([
      [new Date(2026, 9, 20, 10).toISOString(), new Date(2026, 9, 20, 10, 30).toISOString()],
      [new Date(2026, 9, 20, 11).toISOString(), new Date(2026, 9, 20, 12, 15).toISOString()],
    ]);
    expect(visits).toHaveLength(2);
    expect(container.textContent).toContain("10:30");
    expect(container.textContent).toContain("12:15");
  });

  it.each(["2026-10-20T09:30", "2026-10-20T10:00"])("recusa término %s anterior ou igual ao início", async (end) => {
    await change("Data e hora da visita", "2026-10-20T10:00");
    await change("Data e hora de término da visita (opcional)", end);
    await schedule();
    expect(api.schedule).not.toHaveBeenCalled();
    expect(api.warning).toHaveBeenCalledWith(expect.stringMatching(/fim válido posterior ao início/));
  });

  it("não inventa fim e explica a ocupação do dia inteiro", async () => {
    expect(container.textContent).toMatch(/Sem horário de término.*dia inteiro/);
    await change("Data e hora da visita", "2026-10-20T23:15");
    await schedule();
    expect(api.schedule.mock.calls[0][0]).not.toHaveProperty("endsAt");
    expect(api.schedule.mock.calls[0][0].scheduledAt).toBe(new Date(2026, 9, 20, 23, 15).toISOString());
  });
});
