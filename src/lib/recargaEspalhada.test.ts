import { afterEach, describe, expect, it, vi } from "vitest";
import { recargaEspalhada } from "./recargaEspalhada";

describe("recargaEspalhada", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("uma rajada de eventos vira uma recarga só, depois da espera", () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const pedir = recargaEspalhada(recarregar, 2_000, 0);
    for (let i = 0; i < 25; i++) pedir();
    expect(recarregar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(recarregar).toHaveBeenCalledTimes(1);
    pedir();
    vi.advanceTimersByTime(2_000);
    expect(recarregar).toHaveBeenCalledTimes(2);
  });

  it("cancelar descarta a recarga agendada (tela desmontada)", () => {
    vi.useFakeTimers();
    const recarregar = vi.fn();
    const pedir = recargaEspalhada(recarregar, 1_000, 0);
    pedir();
    pedir.cancelar();
    vi.advanceTimersByTime(5_000);
    expect(recarregar).not.toHaveBeenCalled();
  });
});
