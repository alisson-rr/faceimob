import { afterEach, describe, expect, it, vi } from "vitest";
import { comPrazo } from "./prazo";
import { describeError } from "./supabaseError";

afterEach(() => { vi.useRealTimers(); });

describe("comPrazo", () => {
  it("promessa que nunca termina vira erro com a mensagem da tela", async () => {
    vi.useFakeTimers();
    const pendurada = comPrazo(new Promise<never>(() => undefined), 1_000, "O envio demorou demais.");
    vi.advanceTimersByTime(1_000);
    const erro = await pendurada.catch((e: unknown) => e);
    expect(describeError(erro, "fallback")).toBe("O envio demorou demais.");
  });

  it("promessa dentro do prazo passa o valor, e o erro dela não vira estouro", async () => {
    await expect(comPrazo(Promise.resolve(7), 1_000, "x")).resolves.toBe(7);
    await expect(comPrazo(Promise.reject(new Error("recusado")), 1_000, "x")).rejects.toThrow("recusado");
  });
});
