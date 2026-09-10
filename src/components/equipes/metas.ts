import { format } from "date-fns";

/**
 * Meta de perfil em `goals` (scope 'profile', metric 'vgv'): período e valor.
 *
 * Vive fora da tela porque leitura e gravação estão em pontos diferentes de
 * Equipes.tsx e precisam da MESMA data. Enquanto cada lado montava o período
 * por conta própria, a tela salvava num período e lia noutro — a meta salva
 * nunca voltava para o campo.
 */

/** Primeiro dia do mês e do ano correntes, que é como `goals.period` guarda. */
export const goalPeriods = (ref = new Date()) => ({
  month: `${format(ref, "yyyy-MM")}-01`,
  year: `${format(ref, "yyyy")}-01-01`,
});

/** Campo vazio é zero; meta negativa não existe (check `target >= 0` da tabela). */
export const parseGoal = (raw: string): number | null => {
  if (raw.trim() === "") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export interface GoalPeriods {
  month: string;
  year: string;
}

export interface ProfileGoalRow {
  profile_id: string | null;
  period_type: string;
  period: string;
  target: number | string;
  /** `goals.metric`: 'vgv', 'sales', 'visits'… Ausente = tratado como 'vgv'. */
  metric?: string | null;
}

/**
 * Metas de perfil por pessoa, casando o PAR (period_type, period).
 *
 * Só o `period_type` não basta: a meta MENSAL de janeiro tem
 * `period = 'YYYY-01-01'`, idêntico ao período anual, então ela entra no mesmo
 * `in (mês, ano)` da consulta e cairia no ramo do mês corrente — sobrescrevendo
 * ou sendo sobrescrita por ele conforme a ordem que o PostgREST devolvesse.
 * Quem não casar nenhum dos dois períodos é descartado.
 */
export const goalsByProfile = (
  rows: ProfileGoalRow[],
  periods: GoalPeriods,
  metric = "vgv",
) => {
  const byProfile = new Map<string, { monthly: number; yearly: number }>();
  for (const row of rows) {
    if (!row.profile_id) continue;
    // A consulta traz TODAS as métricas (era filtrada em `vgv` e as 7 metas de
    // vendas e 3 de visitas que existem no banco não apareciam em lugar nenhum).
    // Quem separa por métrica é esta linha; `metric` ausente na linha só
    // acontece em dado antigo e cai fora.
    if ((row.metric ?? "vgv") !== metric) continue;
    const isMonth = row.period_type === "month" && row.period === periods.month;
    const isYear = row.period_type === "year" && row.period === periods.year;
    if (!isMonth && !isYear) continue;
    const current = byProfile.get(row.profile_id) ?? { monthly: 0, yearly: 0 };
    if (isMonth) current.monthly = Number(row.target);
    else current.yearly = Number(row.target);
    byProfile.set(row.profile_id, current);
  }
  return byProfile;
};

/** Rótulo curto de cada métrica de meta, para a linha "além do VGV". */
export const METRIC_LABEL: Record<string, string> = {
  vgv: "VGV",
  sales: "Vendas",
  visits: "Visitas",
  leads: "Leads",
};

/**
 * As metas do MÊS que não são de VGV, por pessoa — ex.: "Vendas 3 · Visitas 10".
 *
 * Existem no banco (7 de vendas, 3 de visitas na homologação) e nenhuma tela as
 * mostrava: a de Equipes filtrava `metric = 'vgv'` e escrevia R$ 0,00 por cima
 * de gente que tinha meta. Aqui elas são só LEITURA — editá-las é outra tela,
 * e prometer edição num campo que não grava seria o defeito de novo.
 */
export const otherMetricsByProfile = (rows: ProfileGoalRow[], periods: GoalPeriods) => {
  const byProfile = new Map<string, string>();
  const partes = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.profile_id) continue;
    const metric = row.metric ?? "vgv";
    if (metric === "vgv") continue;
    if (row.period_type !== "month" || row.period !== periods.month) continue;
    const list = partes.get(row.profile_id) ?? [];
    list.push(`${METRIC_LABEL[metric] ?? metric} ${Number(row.target)}`);
    partes.set(row.profile_id, list);
  }
  for (const [id, list] of partes) byProfile.set(id, list.join(" · "));
  return byProfile;
};
