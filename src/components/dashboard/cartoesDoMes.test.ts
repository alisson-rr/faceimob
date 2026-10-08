import { describe, expect, it } from "vitest";
import { cartoesDoPeriodo, contarDoMes } from "./cartoesDoMes";
import type { DealRow } from "./data";

const catalog = {
  groupById: new Map([
    ["g-venda", { code: "VENDA" }], ["g-prop", { code: "PROPOSTA" }], ["g-leg", { code: "LEGADO" }],
    ["g-dist", { code: "DISTRATO" }], ["g-off", { code: "OFF" }],
  ]),
} as never;

const negocio = (month_base: string, status_group_id: string, status = "") =>
  ({ id: `${month_base}-${status_group_id}-${status}`, month_base, status_group_id, status }) as unknown as DealRow;

describe("contarDoMes", () => {
  it("produção é só proposta; legado fica separado; negócios só o 'Virou Negócio'", () => {
    const c = contarDoMes([
      negocio("09/2026", "g-prop", "08. VIROU NEGÓCIO"),
      negocio("09/2026", "g-prop", "13. ESTEIRA AGIL"),
      negocio("09/2026", "g-leg", "ANÁLISE EXTERNA"),
      negocio("09/2026", "g-off", "18. QUEDA"),
      negocio("09/2026", "g-off", "OFF"),
      negocio("09/2026", "g-dist", "17. DISTRATO"),
      negocio("09/2026", "g-venda", "03. ASSINADO"),
    ], catalog);
    expect(c).toEqual({ propostas: 2, legado: 1, producao: 2, negocios: 1, perdas: 2, distratos: 1 });
  });
});

describe("cartoesDoPeriodo", () => {
  const deals = [
    negocio("09/2026", "g-prop"), negocio("08/2026", "g-prop"), negocio("08/2026", "g-prop", "x"),
    negocio("08/2026", "g-dist"), negocio("07/2026", "g-dist"), negocio("07/2026", "g-dist", "y"),
  ];

  it("distratos são do mês anterior, comparados com o anterior a ele", () => {
    const c = cartoesDoPeriodo(deals, "09/2026", catalog);
    expect(c.atual.propostas).toBe(1);
    expect(c.anterior?.propostas).toBe(2);
    expect(c.distratosAnterior).toBe(1);
    expect(c.distratosAntesDoAnterior).toBe(2);
  });

  it("em todos os meses não há anterior", () => {
    const c = cartoesDoPeriodo(deals, "all", catalog);
    expect(c.atual.propostas).toBe(3);
    expect(c.anterior).toBeNull();
    expect(c.distratosAnterior).toBeNull();
  });
});
