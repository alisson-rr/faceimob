import { describe, expect, it } from "vitest";
import { abreSozinho, hojeLocal, primeiraAberturaDoDia } from "./vezPorDia";

/** Armazém de mentira, com o mesmo contrato do `localStorage`. */
const fake = () => {
  const mapa = new Map<string, string>();
  return {
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
  };
};

const bloqueado = {
  getItem: () => {
    throw new DOMException("SecurityError");
  },
  setItem: () => {
    throw new DOMException("SecurityError");
  },
};

describe("vezPorDia", () => {
  it("abre uma vez por dia e não abre de novo no mesmo dia", () => {
    const store = fake();
    expect(primeiraAberturaDoDia("p1", "2026-09-10", store)).toBe(true);
    expect(primeiraAberturaDoDia("p1", "2026-09-10", store)).toBe(false);
    expect(primeiraAberturaDoDia("p1", "2026-09-11", store)).toBe(true);
  });

  it("é por pessoa: a marca de um não silencia o modal do outro no mesmo navegador", () => {
    const store = fake();
    expect(primeiraAberturaDoDia("p1", "2026-09-10", store)).toBe(true);
    expect(primeiraAberturaDoDia("p2", "2026-09-10", store)).toBe(true);
  });

  it("armazenamento bloqueado não abre e não estoura", () => {
    // Sem poder lembrar, abrir seria abrir a TODA navegação — pior do que não
    // abrir, e o botão "Painel" continua na tela.
    expect(() => primeiraAberturaDoDia("p1", "2026-09-10", bloqueado)).not.toThrow();
    expect(primeiraAberturaDoDia("p1", "2026-09-10", bloqueado)).toBe(false);
  });

  it("abre sozinho só para o corretor", () => {
    const store = fake();
    expect(abreSozinho("manager", "p1", "2026-09-10", store)).toBe(false);
    expect(abreSozinho("director", "p1", "2026-09-10", store)).toBe(false);
    expect(abreSozinho("admin", "p1", "2026-09-10", store)).toBe(false);
    expect(abreSozinho("partner", "p1", "2026-09-10", store)).toBe(false);
    expect(abreSozinho("broker", "p1", "2026-09-10", store)).toBe(true);
  });

  it("não marca o dia de quem não abre — o corretor que trocar de papel de volta ainda vê o modal", () => {
    const store = fake();
    // O gerente passa pelo Pipeline e o curto-circuito do `&&` impede a marca.
    expect(abreSozinho("manager", "p1", "2026-09-10", store)).toBe(false);
    expect(abreSozinho("broker", "p1", "2026-09-10", store)).toBe(true);
  });

  it("sem sessão não abre nada", () => {
    expect(abreSozinho("broker", null, "2026-09-10", fake())).toBe(false);
  });

  it("hojeLocal usa o relógio local, não UTC", () => {
    // 23h30 local de 10/09 continua sendo 10/09 aqui, mesmo que em UTC já seja 11.
    expect(hojeLocal(new Date(2026, 8, 10, 23, 30))).toBe("2026-09-10");
  });
});
