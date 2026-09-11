import { eachDayOfInterval, format, parseISO, startOfMonth } from "date-fns";
import { idealStagePct } from "@/lib/metrics";

/**
 * As contas do Diário — fora do componente porque três telas dependem delas e
 * porque conta que mente precisa de teste.
 *
 * Tudo aqui nasceu de um defeito de leitura, com o banco certo e a tela somando
 * errado: "N dias preenchidos" contava linha em vez de dia com lançamento, a
 * lista de pendências acusava sábado e domingo, e as metas do funil eram
 * literais (100/10/40/50) enquanto o checkpoint da diretoria já lia
 * `funnel_targets` — o mesmo número cobrado por duas réguas.
 */

/**
 * As 8 métricas do checkpoint, na ordem em que a grade as mostra — o catálogo,
 * em um lugar só. `@/lib/metrics` mantinha um `DAILY_METRICS` idêntico byte a
 * byte até 11/09/2026; foi apagado, e quem o usava lê daqui.
 *
 * `col` é o nome da MESMA métrica em `daily_entries`. Fica aqui porque as duas
 * traduções (banco → tela e tela → banco) saem deste par: separá-las era o que
 * permitia uma tela renomear de um lado e esquecer o outro.
 */
export const DAILY_FIELDS = [
  { key: "leads", label: "Leads", color: "text-info", col: "leads" },
  { key: "ligacoes", label: "Ligações", color: "text-info", col: "calls" },
  { key: "coleta_docs", label: "Coleta Docs", color: "text-info", col: "doc_collections" },
  { key: "visitas_agendadas", label: "Visita Agend.", color: "text-chart-5", col: "visits_scheduled" },
  { key: "visitas_realizadas", label: "Visita Real.", color: "text-chart-5", col: "visits_done" },
  { key: "analises", label: "Análise Env.", color: "text-warning", col: "analyses_sent" },
  { key: "aprovados", label: "Análise Aprov.", color: "text-success", col: "analyses_approved" },
  { key: "vendas", label: "Venda", color: "text-warning", col: "sales" },
] as const;

export type DailyFieldKey = typeof DAILY_FIELDS[number]["key"];
export type DailyColumn = typeof DAILY_FIELDS[number]["col"];
export type DailyRow = Record<DailyFieldKey, number>;
export type DailyBrokerMonth = Record<string, DailyRow & { days_filled?: number }>;

/**
 * As oito colunas de `daily_entries` como o BANCO as nomeia, derivadas do
 * catálogo acima.
 *
 * Separado de `DailyEntry` porque nem todo SELECT pede `profile_id`: o
 * Checkpoint soma por equipe e agrupa por relatorio. Sem este tipo, aquela tela
 * reescrevia a traducao coluna → tela inteira so para nao pedir uma coluna.
 */
export type DailyEntryColumns = { [K in DailyColumn]?: number | null };

/** Linha de `daily_entries` como a RPC a devolve, com o dono do lançamento. */
export type DailyEntry = DailyEntryColumns & { profile_id: string };

/** Um dia do mês: quem preencheu, as observações e a linha de cada corretor. */
export type DailyDayRecord = { filled_by?: string | null; notes?: string | null; entries?: DailyEntry[] };

/** Bloco `funnel_targets` como as RPCs públicas o devolvem (0039/0062). */
export type FunnelTargetsRow = {
  scope?: string | null;
  lead_to_analysis_pct?: number | null;
  analysis_to_approval_pct?: number | null;
  approval_to_sale_pct?: number | null;
};

/** Meta do funil já resolvida, com o escopo de onde veio. */
export type DailyTargets = { scope: string; analises: number; aprovados: number; vendas: number };

/** De onde a meta saiu — sem isto ninguém sabe se é medido por 10% ou por 12%. */
export const TARGET_SCOPE_LABEL: Record<string, string> = {
  team: "meta da equipe",
  director: "meta da diretoria",
  global: "meta da empresa",
  ideal: "funil ideal — nenhuma meta cadastrada",
};

export const zeroDailyRow = (): DailyRow =>
  DAILY_FIELDS.reduce((acc, field) => ({ ...acc, [field.key]: 0 }), {} as DailyRow);

/**
 * Linha da RPC (nomes do banco) → linha da tela (nomes das colunas).
 *
 * A ÚNICA tradução coluna → tela do diário. Havia três, com vocabulários
 * diferentes (`visitas_feitas`/`enviadas`/`aprovadas` no Checkpoint), batendo
 * por coincidência de manutenção: renomear uma coluna consertava uma tela e
 * zerava calada a outra. Checkpoint e Diário passam por aqui.
 */
export const fromDailyEntry = (row?: DailyEntryColumns | null): DailyRow =>
  DAILY_FIELDS.reduce(
    (acc, field) => ({ ...acc, [field.key]: Number(row?.[field.col]) || 0 }),
    {} as DailyRow,
  );

/**
 * Linha da tela → colunas de `daily_entries`. O INVERSO de `fromDailyEntry`,
 * derivado do mesmo catálogo.
 *
 * O Diário público escrevia esta tradução à mão no envio — a terceira cópia do
 * mesmo apelidamento, e a que ninguém lembra de atualizar quando uma coluna
 * muda de nome.
 *
 * Recebe um LEITOR, não um objeto, porque o valor não vai cru para o banco: o
 * Diário passa cada número por `halfStep` antes de gravar (0038).
 */
export const toDailyEntry = (
  value: (key: DailyFieldKey) => number,
): Record<DailyColumn, number> =>
  DAILY_FIELDS.reduce(
    (acc, field) => ({ ...acc, [field.col]: value(field.key) }),
    {} as Record<DailyColumn, number>,
  );

/**
 * `funnel_targets` manda quando existe; o funil ideal do produto é o fallback.
 *
 * Meta 0 não é meta, é campo vazio: uma régua em 0% deixaria toda etapa "dentro
 * da meta" para sempre. Por isso `Number(...) || fallback`, e não `??`.
 */
export const targetsFrom = (raw: FunnelTargetsRow | null | undefined): DailyTargets => ({
  scope: raw?.scope ?? "ideal",
  analises: Number(raw?.lead_to_analysis_pct) || idealStagePct("analises"),
  aprovados: Number(raw?.analysis_to_approval_pct) || idealStagePct("aprovados"),
  vendas: Number(raw?.approval_to_sale_pct) || idealStagePct("vendas"),
});

/** Sábado e domingo não são dia de checkpoint. */
export const isBusinessDay = (isoDate: string) => {
  const weekday = parseISO(isoDate).getDay();
  return weekday !== 0 && weekday !== 6;
};

/**
 * Dias do mês sem checkpoint: até ontem e só em dia útil.
 *
 * Fim de semana entrava na conta e a lista abria com ~8 dias em vermelho todo
 * mês. Cobrança que sempre acusa deixa de ser lida — a mesma regra passou a
 * valer nos `missing_days` do checkpoint da diretoria (migration 0062).
 */
export const monthMissingDays = (filledDates: string[], todayStr: string): string[] =>
  eachDayOfInterval({ start: startOfMonth(parseISO(todayStr)), end: parseISO(todayStr) })
    .map((day) => format(day, "yyyy-MM-dd"))
    .filter((iso) => iso < todayStr && isBusinessDay(iso) && !filledDates.includes(iso));

/** Alguma métrica com valor? Linha toda zerada não é dia preenchido. */
export const hasAnyValue = (row: DailyRow) => DAILY_FIELDS.some((field) => (row[field.key] || 0) > 0);

/**
 * Soma o mês: total da equipe e acumulado por corretor.
 *
 * `days_filled` conta DIA COM LANÇAMENTO, não linha gravada:
 * `public_daily_submit` grava uma linha para todo o roster a cada save, então
 * contar linhas dizia "20 dias preenchidos" para quem não lançou nada no mês.
 */
export const aggregateMonth = (month: Record<string, DailyDayRecord>) => {
  const totals = zeroDailyRow();
  const byBroker: DailyBrokerMonth = {};
  Object.keys(month).sort().forEach((iso) =>
    (month[iso]?.entries ?? []).forEach((row) => {
      const values = fromDailyEntry(row);
      const acc = byBroker[row.profile_id] ?? { ...zeroDailyRow(), days_filled: 0 };
      DAILY_FIELDS.forEach((field) => {
        totals[field.key] += values[field.key];
        acc[field.key] += values[field.key];
      });
      if (hasAnyValue(values)) acc.days_filled = (acc.days_filled ?? 0) + 1;
      byBroker[row.profile_id] = acc;
    }),
  );
  return { totals, byBroker };
};
