import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ insert: vi.fn(), response: { data: null as unknown, error: null as unknown } }));
vi.mock("./client", () => ({ supabase: { from: () => ({ insert: api.insert }) } }));
import { scheduleVisit } from "./activities";
import { describeError } from "@/lib/supabaseError";
beforeEach(() => {
  vi.clearAllMocks();
  api.response = { data: null, error: null };
  api.insert.mockReturnValue({ select: () => ({ single: async () => api.response }) });
});

describe("agendamento manual protegido", () => {
  it("preserva início e fim informados sem inferir duração", async () => {
    api.response = { data: { id: "v", scheduled_at: "2026-10-20T16:15:00-03:00", ends_at: "2026-10-20T17:00:00-03:00" }, error: null };
    const result = await scheduleVisit({ leadId: "l", brokerId: "b", scheduledAt: "2026-10-20T16:15:00-03:00", endsAt: "2026-10-20T17:00:00-03:00" });
    expect(api.insert).toHaveBeenCalledWith(expect.objectContaining({ scheduled_at: "2026-10-20T16:15:00-03:00", ends_at: "2026-10-20T17:00:00-03:00" }));
    expect(result.ends_at).toBe("2026-10-20T17:00:00-03:00");
  });
  it("mantém compatibilidade e não envia fim quando omitido", async () => {
    api.response = { data: { id: "v", ends_at: null }, error: null };
    const result = await scheduleVisit({ brokerId: "b", scheduledAt: "2026-10-20T16:15:00-03:00" });
    expect(api.insert.mock.calls[0][0]).not.toHaveProperty("ends_at");
    expect(result.ends_at).toBeNull();
  });
  it.each(["2026-10-20T16:15:00-03:00", "2026-10-20T16:00:00-03:00", "inválido", ""])("recusa fim %s sem gravar", async (endsAt) => {
    const error = await scheduleVisit({ brokerId: "b", scheduledAt: "2026-10-20T16:15:00-03:00", endsAt }).catch((failure: unknown) => failure);
    expect(describeError(error, "Falhou")).toBe("Informe um fim válido posterior ao início da visita.");
    expect(api.insert).not.toHaveBeenCalled();
  });
  it("traduz conflito da restrição SQL para orientação ao corretor", async () => {
    api.response = { data: null, error: { code: "23P01", message: "constraint overlap" } };
    const error = await scheduleVisit({ brokerId: "b", scheduledAt: "2026-10-20T16:15:00-03:00" }).catch((failure: unknown) => failure);
    expect(describeError(error, "Falhou")).toMatch(/horário já está ocupado.*Escolha outro horário/);
  });
});
