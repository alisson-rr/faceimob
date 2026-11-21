import { describe, expect, it } from "vitest";
import { etapasDoFunil, type FunilPorEtapas } from "./funilPorEtapas";

const funil: FunilPorEtapas = {
  mes: "2026-11-01", diretor: null, leads: 1419,
  documentos: { producao: [{ rotulo: "APROV. TOTAL", n: 60 }, { rotulo: "PENDENTE", n: 18 }], legado: [{ rotulo: "BACEN", n: 178 }] },
  envios: { total: 109, do_mes: 92, outros_meses: 17 },
  aprovados: { total: 51, itens: [] },
  vendas: { total: 12, itens: [] },
  diretorias: [], pode_ver_imob: true,
};

describe("etapasDoFunil — régua de 21/11/2026", () => {
  it("documentos somam produção e legado e não têm meta", () => {
    const docs = etapasDoFunil(funil)[1];
    expect(docs).toMatchObject({ total: 256, meta: null, taxa: null });
  });

  it("envios sobre leads (10%), aprovados sobre envios (40%), vendas sobre aprovados (50%)", () => {
    const [, , envios, aprovados, vendas] = etapasDoFunil(funil);
    expect(envios.taxa).toBeCloseTo(109 / 1419);
    expect(envios.esperado).toBe(142);
    expect(aprovados.taxa).toBeCloseTo(51 / 109);
    expect(aprovados.esperado).toBe(44);
    expect(vendas.taxa).toBeCloseTo(12 / 51);
    expect(vendas.esperado).toBe(26);
  });

  it("sem envios não há taxa de aprovação", () => {
    const [, , , aprovados] = etapasDoFunil({ ...funil, envios: { total: 0, do_mes: 0, outros_meses: 0 } });
    expect(aprovados.taxa).toBeNull();
  });
});
