import { describe, expect, it } from "vitest";
import { comissaoPrevista } from "./comissao";

type Deal = Parameters<typeof comissaoPrevista>[0];
const deal = (patch: Partial<Deal>): Deal => ({
  status: "09. APROV. TOTAL", outcome: "open", deal_value: 200_000,
  broker1: "Ana Souza", broker1_share: 100, broker2: undefined, broker2_share: null,
  broker3: undefined, broker3_share: null,
  ...patch,
});

// Regra do cliente (29/09/2026): 2% do VGV líquido a partir da aprovação,
// dividida entre os corretores.
describe("comissaoPrevista", () => {
  it("aprovado total: 2% do líquido — R$ 200 mil dão R$ 4 mil", () => {
    expect(comissaoPrevista(deal({}))).toEqual({ total: 4000, porCorretor: [{ nome: "Ana Souza", valor: 4000 }] });
  });

  it("aprovado condicionado e os passos seguintes também mostram; antes da aprovação, não", () => {
    expect(comissaoPrevista(deal({ status: "10. APROV. COND." }))?.total).toBe(4000);
    expect(comissaoPrevista(deal({ status: "08. VIROU NEGÓCIO" }))?.total).toBe(4000);
    expect(comissaoPrevista(deal({ status: "16. PENDENTE" }))).toBeNull();
    expect(comissaoPrevista(deal({ status: "EM ANÁLISE" }))).toBeNull();
    expect(comissaoPrevista(deal({ status: "APROVADO POTENCIAL" }))).toBeNull();
  });

  it("venda mostra; perdido ou cancelado some, qualquer que seja o Status 2", () => {
    expect(comissaoPrevista(deal({ status: "", outcome: "won" }))?.total).toBe(4000);
    expect(comissaoPrevista(deal({ outcome: "lost" }))).toBeNull();
    expect(comissaoPrevista(deal({ outcome: "cancelled" }))).toBeNull();
  });

  it("dois corretores dividem pelo rateio do negócio", () => {
    const r = comissaoPrevista(deal({ broker1_share: 50, broker2: "Bruno Lima", broker2_share: 50 }));
    expect(r?.porCorretor).toEqual([{ nome: "Ana Souza", valor: 2000 }, { nome: "Bruno Lima", valor: 2000 }]);
  });

  it("sem rateio gravado, partes iguais; sem VGV, nada", () => {
    const r = comissaoPrevista(deal({ broker1_share: null, broker2: "Bruno Lima", broker2_share: null }));
    expect(r?.porCorretor.map((c) => c.valor)).toEqual([2000, 2000]);
    expect(comissaoPrevista(deal({ deal_value: 0 }))).toBeNull();
  });
});
