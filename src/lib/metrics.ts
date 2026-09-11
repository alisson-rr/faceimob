/**
 * Catalogo de metricas da operacao — fonte unica.
 *
 * As oito metricas do diario moram em `DAILY_FIELDS` (`@/lib/dailyFunnel`),
 * ao lado das contas que as usam; aqui ficou so o FUNIL. Ate 11/09/2026 este
 * arquivo mantinha um `DAILY_METRICS` identico byte a byte ao `DAILY_FIELDS`,
 * com um unico consumidor (`DirectorPanel`) — duas listas da mesma coisa nunca
 * sao lidas juntas, e a segunda envelhece calada.
 *
 * O 10/40/50 tambem era literal em cinco lugares (achado T07): mudar uma meta
 * exigia lembrar de todos. Agora sai de `IDEAL_STAGES`, por `idealStagePct`.
 */

/**
 * Funil ideal, etapa a etapa: Leads 100% → Análise 10% das leads → Aprovação
 * 40% das análises → Venda 50% dos aprovados. `absPct` e a fatia em relacao ao
 * topo, ja acumulada (100 · 10 · 4 · 2).
 */
export const IDEAL_STAGES = [
  { key: "leads", label: "Leads", stagePct: 100, absPct: 100 },
  { key: "analises", label: "Análises", stagePct: 10, absPct: 10 },
  { key: "aprovados", label: "Aprovações", stagePct: 40, absPct: 4 },
  { key: "vendas", label: "Vendas", stagePct: 50, absPct: 2 },
] as const;

/**
 * Meta de conversao da etapa no funil ideal — o 10/40/50 sai SO daqui.
 *
 * Etapa desconhecida devolve 0 de proposito: quem chama passa uma chave de
 * `IDEAL_STAGES`, e 0 e o valor que `Number(x) || fallback` trata como "sem
 * meta" em vez de fingir uma regua.
 */
export const idealStagePct = (key: string): number =>
  IDEAL_STAGES.find((stage) => stage.key === key)?.stagePct ?? 0;

export type FunnelStep = {
  key: string;
  label: string;
  value: number;
  /** Meta de conversao em relacao a etapa anterior (leads = 100). */
  targetPct: number;
};

export type FunnelCounts = { leads: number; analises: number; aprovados: number; vendas: number };

/** Contagens → etapas com a meta de cada uma anexada. */
export const toFunnelSteps = (counts: FunnelCounts): FunnelStep[] =>
  IDEAL_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    value: counts[stage.key as keyof FunnelCounts] ?? 0,
    targetPct: stage.stagePct,
  }));

/** O funil ideal desenhado a partir de um topo — a referencia ao lado do real. */
export const idealFunnelSteps = (leads: number): FunnelStep[] =>
  IDEAL_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    value: Math.round(leads * (stage.absPct / 100)),
    targetPct: stage.stagePct,
  }));

/** Conversao da etapa em relacao a anterior. A primeira etapa e a base: 100%. */
export const stageConversion = (steps: FunnelStep[], index: number): number => {
  if (index === 0) return 100;
  const previous = steps[index - 1]?.value ?? 0;
  return previous > 0 ? (steps[index].value / previous) * 100 : 0;
};
