import { describe, expect, it } from "vitest";
import { custoPorDia } from "./custo.ts";

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
