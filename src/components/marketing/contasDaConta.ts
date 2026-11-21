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

/**
 * A linha do gráfico (pedido de 21/11/2026): cadastro (formulário e landing
 * page) e conversa (WhatsApp) em gráficos separados — juntos, a conversa
 * encarecendo ficava escondida pelo cadastro.
 */
export type LinhaDoGrafico = "cadastro" | "conversa";

const custoDe = (linha: LinhaDoGrafico) => (d: MetaDiaRow) =>
  linha === "cadastro" ? { gasto: d.spend_cadastro, n: d.cadastros } : { gasto: d.spend_conversa, n: d.conversas };

/** Custo de cada dia na linha escolhida. Dia sem resultado fica sem ponto. */
export const serieDeCusto = (dias: MetaDiaRow[], linha: LinhaDoGrafico): DiaDoGrafico[] =>
  dias.map((d) => {
    const { gasto, n } = custoDe(linha)(d);
    return { dia: d.day, rotulo: d.day.slice(8, 10), cpl: divide(gasto, n) };
  });

const custoDoTrecho = (dias: MetaDiaRow[], linha: LinhaDoGrafico) => {
  const partes = dias.map(custoDe(linha));
  return divide(partes.reduce((t, p) => t + p.gasto, 0), partes.reduce((t, p) => t + p.n, 0));
};

export type ResumoDoGrafico = {
  /** Total da linha no período. */
  resultados: number;
  investido: number;
  /** Custo do período inteiro: gasto ÷ resultados, não média das médias. */
  media: number | null;
  /** Primeira semana contra a última (negativo = ficou mais barato). Só com 14 dias ou mais. */
  primeiraParaUltima: number | null;
};

export function resumoDoGrafico(dias: MetaDiaRow[], linha: LinhaDoGrafico): ResumoDoGrafico {
  const partes = dias.map(custoDe(linha));
  return {
    resultados: partes.reduce((t, p) => t + p.n, 0),
    investido: partes.reduce((t, p) => t + p.gasto, 0),
    media: custoDoTrecho(dias, linha),
    primeiraParaUltima: dias.length >= 14
      ? variacao(custoDoTrecho(dias.slice(-7), linha), custoDoTrecho(dias.slice(0, 7), linha))
      : null,
  };
}
