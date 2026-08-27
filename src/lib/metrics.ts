/**
 * Catalogo de metricas da operacao — fonte unica.
 *
 * As oito metricas do diario de equipe estavam copiadas em `DailyReport.FIELDS`
 * e `PublicDirectorCheckpoint.MONTH_FIELDS`, e as metas do funil (10 / 40 / 50)
 * apareciam mais tres vezes: no `ComparativeFunnel`, no `DirectorDashboard` e no
 * `Checkpoint`. Era o achado T07 — mudar uma meta exigia lembrar de cinco
 * lugares. Aqui e um.
 *
 * `Checkpoint`, `DailyReport` e `PublicDirectorCheckpoint` ainda tem a copia
 * deles; adotam este modulo quando forem redesenhados.
 */

/** Metrica do diario. `color` e classe de texto para quem lista campo a campo. */
export const DAILY_METRICS = [
  { key: "leads", label: "Leads", color: "text-info" },
  { key: "ligacoes", label: "Ligações", color: "text-info" },
  { key: "coleta_docs", label: "Coleta Docs", color: "text-info" },
  { key: "visitas_agendadas", label: "Visita Agend.", color: "text-chart-5" },
  { key: "visitas_realizadas", label: "Visita Real.", color: "text-chart-5" },
  { key: "analises", label: "Análise Env.", color: "text-warning" },
  { key: "aprovados", label: "Análise Aprov.", color: "text-success" },
  { key: "vendas", label: "Venda", color: "text-warning" },
] as const;

export type DailyMetricKey = (typeof DAILY_METRICS)[number]["key"];

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
