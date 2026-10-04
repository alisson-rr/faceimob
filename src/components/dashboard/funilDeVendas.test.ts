import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { PASSAGENS, comparar, diasDesde, pct, taxa } from "./funilDeVendas";

describe("Funil de Vendas", () => {
  const mes = { leads: 1000, docs: 120, aprovadas: 40, vendas: 20 };

  it("cada passagem mede a camada de baixo sobre a de cima, com o ideal pedido", () => {
    expect(PASSAGENS.map((p) => [p.rotulo, taxa(mes, p.de, p.para), p.ideal])).toEqual([
      ["Lead → Doc", 0.12, 0.1],
      ["Doc → Aprovada", 40 / 120, 0.4],
      ["Aprovada → Venda", 0.5, 0.5],
    ]);
  });

  it("acima, abaixo ou sem base — bater a régua conta como acima", () => {
    expect(comparar(0.12, 0.1)).toBe("acima");
    expect(comparar(40 / 120, 0.4)).toBe("abaixo");
    expect(comparar(0.5, 0.5)).toBe("acima");
    expect(comparar(taxa({ ...mes, leads: 0 }, "leads", "docs"), 0.1)).toBe("sem-base");
  });

  it("formata porcentagem e dias parados", () => {
    expect(pct(0.125)).toBe("12,5%");
    expect(pct(null)).toBe("—");
    expect(diasDesde("2026-10-01T12:00:00Z", new Date("2026-10-05T11:00:00Z"))).toBe(3);
  });
});
