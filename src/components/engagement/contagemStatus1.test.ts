import { describe, expect, it } from "vitest";
import { contarStatus1PorPessoa, textoDaContagem } from "./contagemStatus1";

const catalog = {
  groupById: new Map([
    ["g-venda", { code: "VENDA" }], ["g-prop", { code: "PROPOSTA" }],
    ["g-leg", { code: "LEGADO" }], ["g-off", { code: "OFF" }], ["g-dist", { code: "DISTRATO" }],
  ]),
} as never;

const negocio = (status_group_id: string | null, ids: Partial<Record<string, string>>) => ({
  status_group_id, broker1_id: null, broker2_id: null, broker3_id: null, ...ids,
});

describe("contarStatus1PorPessoa", () => {
  it("conta cada Status 1 por corretor do negócio; slot de gestor não entra", () => {
    const contagem = contarStatus1PorPessoa([
      negocio("g-venda", { broker1_id: "c1", manager1_id: "g1" }),
      negocio("g-prop", { broker1_id: "c1", broker2_id: "c2", manager1_id: "g1" }),
      negocio("g-prop", { broker1_id: "c1", manager1_id: "c1" }),
      negocio("g-off", { broker1_id: "c2" }),
      negocio("g-leg", { director1_id: "d1" }),
    ], catalog);
    expect(contagem.get("c1")).toEqual({ VENDA: 1, PROPOSTA: 2, LEGADO: 0, OFF: 0 });
    expect(contagem.get("c2")).toEqual({ VENDA: 0, PROPOSTA: 1, LEGADO: 0, OFF: 1 });
    expect(contagem.has("g1")).toBe(false);
    expect(contagem.has("d1")).toBe(false);
  });

  it("distrato e negócio sem Status 1 ficam de fora", () => {
    const contagem = contarStatus1PorPessoa([
      negocio("g-dist", { broker1_id: "c1" }), negocio(null, { broker1_id: "c1" }),
    ], catalog);
    expect(contagem.has("c1")).toBe(false);
  });

  it("o texto mostra as quatro, zeradas quando não há negócio", () => {
    expect(textoDaContagem(undefined)).toBe("Venda 0 · Proposta 0 · Legado 0 · Off 0");
    expect(textoDaContagem({ VENDA: 2, PROPOSTA: 5, LEGADO: 1, OFF: 0 })).toBe("Venda 2 · Proposta 5 · Legado 1 · Off 0");
  });
});
