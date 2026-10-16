import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { PipelineStage } from "./stages";
const api = vi.hoisted(() => ({ schedule: vi.fn(), update: vi.fn(), warning: vi.fn() }));
vi.mock("@/integrations/supabase/activities", () => ({ scheduleVisit: api.schedule }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "b" }, canEnterStage: () => true }) }));
vi.mock("./data", () => ({ updateDeal: api.update, useCanExitStage: () => () => true }));
vi.mock("@/components/ui/calendar", () => ({ Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => <button onClick={() => onSelect(new Date(2026, 9, 20))}>Escolher dia</button> }));
vi.mock("@/components/ui/sonner", () => ({ toast: { success: vi.fn(), warning: api.warning, error: vi.fn() } }));
import { ScheduleVisitDialog } from "./ScheduleVisitDialog";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onScheduled = vi.fn();
const button = (text: string) => Array.from(document.querySelectorAll("button")).find((element) => element.textContent === text)!;
const change = async (label: string, value: string) => {
  const field = Array.from(document.querySelectorAll("label")).find((element) => element.textContent === label)!;
  const input = document.getElementById(field.htmlFor)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(async () => {
  vi.clearAllMocks();
  api.schedule.mockResolvedValue({ id: "v" });
  api.update.mockResolvedValue(undefined);
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root.render(<ScheduleVisitDialog
    deal={{ id: "d", client: "Ana", active: true, stage_position: 1, stage_id: "s1" } as LegacyDealRecord}
    stages={[{ id: "s2", code: "visit_scheduled", position: 2 } as PipelineStage]}
    onClose={() => {}} onScheduled={onScheduled} />));
  await act(async () => button("Escolher dia").click());
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("intervalo da visita no negócio", () => {
  it("exige a hora inicial e não presume a hora final", async () => {
    expect(button("Agendar").disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Sem término.*dia inteiro/);
    await change("Hora de início da visita", "16:15");
    await act(async () => button("Agendar").click());
    expect(api.schedule).toHaveBeenCalledWith({ dealId: "d", brokerId: "b", scheduledAt: new Date(2026, 9, 20, 16, 15).toISOString() });
    expect(api.update).toHaveBeenCalledWith("d", { stage_id: "s2" });
    expect(onScheduled).toHaveBeenCalledOnce();
  });

  it("envia início e fim escolhidos antes de mover o funil", async () => {
    await change("Hora de início da visita", "16:15");
    await change("Hora de término (opcional)", "17:45");
    await act(async () => button("Agendar").click());
    expect(api.schedule).toHaveBeenCalledWith({ dealId: "d", brokerId: "b", scheduledAt: new Date(2026, 9, 20, 16, 15).toISOString(), endsAt: new Date(2026, 9, 20, 17, 45).toISOString() });
    expect(api.schedule.mock.invocationCallOrder[0]).toBeLessThan(api.update.mock.invocationCallOrder[0]);
  });

  it.each(["15:00", "16:15"])("recusa hora final %s sem gravar nem mover o negócio", async (end) => {
    await change("Hora de início da visita", "16:15");
    await change("Hora de término (opcional)", end);
    await act(async () => button("Agendar").click());
    expect(api.schedule).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(api.warning).toHaveBeenCalledWith(expect.stringMatching(/término posterior ao início/));
  });

  it("preserva a visita se a mudança de etapa for recusada", async () => {
    api.update.mockRejectedValue(new Error("etapa recusada"));
    await change("Hora de início da visita", "22:15");
    await change("Hora de término (opcional)", "23:30");
    await act(async () => button("Agendar").click());
    expect(api.schedule).toHaveBeenCalledOnce();
    expect(api.warning).toHaveBeenCalledWith("Visita agendada sem mudar a etapa", expect.any(Object));
    expect(onScheduled).toHaveBeenCalledOnce();
  });
});
