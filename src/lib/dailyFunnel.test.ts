import { describe, expect, it } from "vitest";
import {
  aggregateMonth,
  hasAnyValue,
  isBusinessDay,
  monthMissingDays,
  targetsFrom,
  zeroDailyRow,
} from "./dailyFunnel";

/**
 * As contas do Diário público que mentiam para o gerente.
 *
 * Três defeitos, todos de leitura — o banco estava certo e a tela somava errado:
 *
 *  · "N dias preenchidos" contava LINHA de `daily_entries`, e `public_daily_submit`
 *    grava uma linha para todo o roster a cada save: um corretor que não lançou
 *    nada no mês inteiro aparecia com "20 dias preenchidos";
 *  · a lista de checkpoints não efetuados incluía sábado e domingo, então abria
 *    com ~8 dias em vermelho todo mês — cobrança que sempre acusa deixa de ser
 *    lida;
 *  · as metas do funil eram literais (100/10/40/50) enquanto o checkpoint da
 *    diretoria lia `funnel_targets`: o mesmo número cobrado por duas réguas.
 */

const linha = (profile_id: string, valores: Record<string, number> = {}) => ({
  profile_id,
  leads: 0, calls: 0, doc_collections: 0, visits_scheduled: 0,
  visits_done: 0, analyses_sent: 0, analyses_approved: 0, sales: 0,
  ...valores,
});

describe("dias úteis", () => {
  it("sábado e domingo não são dia de checkpoint", () => {
    // 2026-09-05 é sábado e 2026-09-06 é domingo.
    expect(isBusinessDay("2026-09-04")).toBe(true);
    expect(isBusinessDay("2026-09-05")).toBe(false);
    expect(isBusinessDay("2026-09-06")).toBe(false);
    expect(isBusinessDay("2026-09-07")).toBe(true);
  });

  it("a pendência do mês pula fim de semana, hoje e o que já foi preenchido", () => {
    // Setembro/2026 começa numa terça. Até o dia 9 (quarta), os dias úteis
    // anteriores são 1, 2, 3, 4, 7 e 8 — 5 e 6 caem no fim de semana.
    const faltando = monthMissingDays(["2026-09-02"], "2026-09-09");

    expect(faltando).toEqual(["2026-09-01", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08"]);
    // Hoje ainda está aberto para preencher: não é pendência.
    expect(faltando).not.toContain("2026-09-09");
  });
});

describe("acumulado do mês", () => {
  it("dia preenchido é dia COM lançamento, não linha gravada", () => {
    const { totals, byBroker } = aggregateMonth({
      // Dois dias salvos; o corretor `b` está nas duas linhas, zerado nas duas —
      // é exatamente o que o `submit` grava para quem não lançou nada.
      "2026-09-01": { entries: [linha("a", { leads: 4 }), linha("b")] },
      "2026-09-02": { entries: [linha("a", { leads: 2, sales: 0.5 }), linha("b")] },
    });

    expect(byBroker.a.days_filled).toBe(2);
    expect(byBroker.b.days_filled).toBe(0);
    expect(byBroker.a.leads).toBe(6);
    expect(totals.leads).toBe(6);
    expect(totals.vendas).toBe(0.5);
  });

  it("meia venda conta como dia preenchido", () => {
    // 0,5 é venda dividida entre dois corretores — valor real, não ruído.
    expect(hasAnyValue({ ...zeroDailyRow(), vendas: 0.5 })).toBe(true);
    expect(hasAnyValue(zeroDailyRow())).toBe(false);
  });

  it("mês vazio não inventa corretor nem total", () => {
    const { totals, byBroker } = aggregateMonth({});
    expect(Object.keys(byBroker)).toHaveLength(0);
    expect(totals.leads).toBe(0);
  });
});

describe("metas do funil", () => {
  it("usa a meta cadastrada e diz de onde ela veio", () => {
    expect(targetsFrom({
      scope: "team",
      lead_to_analysis_pct: 12,
      analysis_to_approval_pct: 45,
      approval_to_sale_pct: 55,
    })).toEqual({ scope: "team", analises: 12, aprovados: 45, vendas: 55 });
  });

  it("sem meta cadastrada, cai no funil ideal do produto", () => {
    // O fallback é o mesmo `IDEAL_STAGES` do resto do sistema, não um literal
    // novo — era assim que as duas telas divergiam.
    expect(targetsFrom(null)).toEqual({ scope: "ideal", analises: 10, aprovados: 40, vendas: 50 });
  });

  it("meta ausente no meio do bloco não zera a régua", () => {
    // Uma régua em 0% deixaria toda etapa "dentro da meta" para sempre.
    expect(targetsFrom({ scope: "director", lead_to_analysis_pct: 11.5 })).toEqual({
      scope: "director", analises: 11.5, aprovados: 40, vendas: 50,
    });
  });
});
