import { describe, expect, it } from "vitest";
import { checkpointCsv } from "./export";
import { emptyAggr, type Targets } from "./funnel";

const META: Targets = { analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 };

describe("checkpointCsv", () => {
  it("leva as visitas e o gargalo já calculado, com a situação da equipe", () => {
    const csv = checkpointCsv([
      {
        equipe: "Equipe Paulista",
        ativa: true,
        aggr: {
          ...emptyAggr(),
          lancamentos: 1, leads: 20, ligacoes: 9, coleta_docs: 3,
          visitas_agendadas: 7, visitas_feitas: 4,
          enviadas: 1, aprovadas: 1, vendas: 1,
        },
        targets: META,
      },
    ]);
    const [cabecalho, linha] = csv.split("\n");
    expect(cabecalho).toContain('"Visitas agendadas","Visitas realizadas"');
    expect(linha).toContain('"7","4"');
    expect(linha).toContain('"ativa"');
    // 1 de 20 = 5%, abaixo dos 10% — o mesmo gargalo que o card mostra.
    expect(linha.endsWith('"Análise Enviada"')).toBe(true);
  });

  it("semana sem lead sai como 'sem base', não como 'no ritmo'", () => {
    const csv = checkpointCsv([
      { equipe: "Equipe Sul", ativa: false, aggr: { ...emptyAggr(), lancamentos: 2 }, targets: META },
    ]);
    const linha = csv.split("\n")[1];
    expect(linha).toContain('"desativada"');
    expect(linha.endsWith('"sem base"')).toBe(true);
  });

  it("nome com vírgula não desloca a coluna seguinte", () => {
    const csv = checkpointCsv([
      { equipe: 'Equipe "Alfa", Zona Sul', ativa: true, aggr: emptyAggr(), targets: META },
    ]);
    const linha = csv.split("\n")[1];
    expect(linha.startsWith('"Equipe ""Alfa"", Zona Sul","ativa"')).toBe(true);
  });
});
