import type { MetaDiaRow } from "@/integrations/supabase/analytics";

/**
 * Contas do painel da conta Meta (pedido de 21/11/2026): os totais do período,
 * a variação contra o período anterior e o custo por lead de cada dia. Puro,
 * para o vitest cobrir. Os dias vêm de `meta_metricas_por_dia` (0350).
 */
export type TotaisDaConta = {
  investido: number;
  resultados: number;
  custoPorResultado: number | null;
  impressoes: number;
  cliques: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
};

const divide = (a: number, b: number) => (b > 0 ? a / b : null);

export function totaisDaConta(dias: MetaDiaRow[]): TotaisDaConta {
  const soma = (f: (d: MetaDiaRow) => number) => dias.reduce((t, d) => t + f(d), 0);
  const investido = soma((d) => d.spend);
  const resultados = soma((d) => d.resultados);
  const impressoes = soma((d) => d.impressions);
  const cliques = soma((d) => d.link_clicks);
  return {
    investido,
    resultados,
    custoPorResultado: divide(investido, resultados),
    impressoes,
    cliques,
    ctr: divide(cliques, impressoes),
    cpm: impressoes > 0 ? (investido * 1000) / impressoes : null,
    cpc: divide(investido, cliques),
  };
}

/** Variação relativa (0,23 = +23%). Sem base no período anterior, não há seta. */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  return (atual - anterior) / anterior;
}

export type DiaDoGrafico = { dia: string; rotulo: string; cpl: number | null };

/** Custo por lead de cada dia, só das campanhas de lead. Dia sem lead fica sem ponto. */
export const serieDeCpl = (dias: MetaDiaRow[]): DiaDoGrafico[] =>
  dias.map((d) => ({ dia: d.day, rotulo: d.day.slice(8, 10), cpl: divide(d.spend_lead, d.resultados_lead) }));

const cplDe = (dias: MetaDiaRow[]) =>
  divide(dias.reduce((t, d) => t + d.spend_lead, 0), dias.reduce((t, d) => t + d.resultados_lead, 0));

export type ResumoDoGrafico = {
  /** Custo por lead do período inteiro: gasto de lead ÷ leads, não média das médias. */
  media: number | null;
  /** Primeira semana contra a última (negativo = ficou mais barato). Só com 14 dias ou mais. */
  primeiraParaUltima: number | null;
};

export function resumoDoGrafico(dias: MetaDiaRow[]): ResumoDoGrafico {
  return {
    media: cplDe(dias),
    primeiraParaUltima: dias.length >= 14 ? variacao(cplDe(dias.slice(-7)), cplDe(dias.slice(0, 7))) : null,
  };
}
