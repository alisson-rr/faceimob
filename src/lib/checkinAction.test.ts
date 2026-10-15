import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkinAction, checkinDeadline, CHECKIN_TIMEOUT_MS } from "./checkinAction";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
beforeEach(() => { vi.useFakeTimers(); invoke.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("check-in com chamadas simultâneas", () => {
  it("uma chamada presa não impede as outras de concluírem", async () => {
    invoke.mockImplementationOnce(() => new Promise(() => {}));
    invoke.mockResolvedValue({ data: { success: true }, error: null });
    const preso = checkinAction("checkin");
    const resultadoPreso = expect(preso).rejects.toThrow("pode ter sido salvo");
    await Promise.all(Array.from({ length: 20 }, () => checkinAction("checkin")));
    expect(invoke).toHaveBeenCalledTimes(21);
    const sinais = invoke.mock.calls.map((call) => call[1].signal);
    expect(new Set(sinais).size).toBe(21);
    await vi.advanceTimersByTimeAsync(CHECKIN_TIMEOUT_MS);
    await resultadoPreso;
    expect(sinais[0].aborted).toBe(true);
    expect(sinais[1].aborted).toBe(false);
  });
  it("consulta inicial também termina com erro se a leitura não responde", async () => {
    const leitura = checkinDeadline(() => new Promise(() => {}));
    const erro = expect(leitura).rejects.toThrow("demorou para responder");
    await vi.advanceTimersByTimeAsync(CHECKIN_TIMEOUT_MS);
    await erro;
  });
  it("preserva recusas de IP ou atraso e não informa sucesso com resposta vazia", async () => {
    invoke.mockResolvedValue({ data: { error: "IP não autorizado para check-in." }, error: null });
    await expect(checkinAction("checkin")).rejects.toThrow("IP não autorizado");
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(checkinAction("checkin")).rejects.toThrow("confirmar a gravação");
  });
  it("preserva a ação de checkout e traduz sessão perdida", async () => {
    invoke.mockResolvedValue({ data: { error: "unauthorized" }, error: null });
    await expect(checkinAction("checkout")).rejects.toThrow("Sua sessão expirou");
    expect(invoke.mock.calls[0][1].body).toEqual({ action: "checkout" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
