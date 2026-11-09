import { describe, expect, it } from "vitest";
import { custoDoModeloPorDia, custoPorDia, idDoModelo } from "./custo.ts";

describe("custoPorDia", () => {
  it("soma só o utilitário, por dia de São Paulo, e separa o cobrado do grátis", () => {
    // 2026-11-07 12:00 UTC e 2026-11-08 02:00 UTC (= 23:00 do dia 07 em SP).
    const resposta = {
      pricing_analytics: {
        data: [{
          data_points: [
            { start: 1794052800, volume: 3, cost: 0.024, pricing_category: "UTILITY", pricing_type: "REGULAR" },
            { start: 1794103200, volume: 2, cost: 0, pricing_category: "UTILITY", pricing_type: "FREE_CUSTOMER_SERVICE" },
            { start: 1794139200, volume: 1, cost: 0.008, pricing_category: "UTILITY", pricing_type: "REGULAR" },
            // Remarketing no mesmo número: não é custo do aviso.
            { start: 1794139200, volume: 9, cost: 0.5, pricing_category: "MARKETING", pricing_type: "REGULAR" },
          ],
        }],
      },
    };
    expect(custoPorDia(resposta)).toEqual([
      { dia: "2026-11-07", mensagens: 5, cobradas: 3, custo: 0.024 },
      { dia: "2026-11-08", mensagens: 1, cobradas: 1, custo: 0.008 },
    ]);
  });

  it("resposta sem dados vira lista vazia, não erro", () => {
    expect(custoPorDia({})).toEqual([]);
    expect(custoPorDia(null)).toEqual([]);
  });
});

describe("custoDoModeloPorDia", () => {
  it("soma entregues, lidas e o gasto (amount_spent) por dia de São Paulo", () => {
    const resposta = {
      data: [{
        granularity: "DAILY",
        data_points: [
          { template_id: "9", start: 1794052800, sent: 12, delivered: 10, read: 8,
            cost: [{ type: "amount_spent", value: 0.4 }, { type: "cost_per_delivered", value: 0.04 }] },
          { template_id: "9", start: 1794139200, sent: 3, delivered: 3, read: 1, cost: [{ type: "amount_spent", value: 0.12 }] },
        ],
      }],
    };
    expect(custoDoModeloPorDia(resposta)).toEqual([
      { dia: "2026-11-07", mensagens: 10, cobradas: 10, custo: 0.4, lidas: 8 },
      { dia: "2026-11-08", mensagens: 3, cobradas: 3, custo: 0.12, lidas: 1 },
    ]);
  });
});

describe("idDoModelo", () => {
  it("acha o modelo pelo nome e prefere o idioma pt_BR", () => {
    const resposta = { data: [
      { id: "1", name: "novo_lead", language: "en_US" },
      { id: "2", name: "novo_lead", language: "pt_BR" },
      { id: "3", name: "outro", language: "pt_BR" },
    ] };
    expect(idDoModelo(resposta, "novo_lead")).toBe("2");
    expect(idDoModelo(resposta, "sumiu")).toBeNull();
    expect(idDoModelo(null, "novo_lead")).toBeNull();
  });
});
