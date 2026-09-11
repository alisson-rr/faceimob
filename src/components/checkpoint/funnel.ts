import { addDays, endOfMonth, format, min, startOfDay, startOfMonth } from "date-fns";
import { fromDailyEntry, type DailyEntryColumns } from "@/lib/dailyFunnel";
import { idealStagePct } from "@/lib/metrics";

/**
 * Metas e base do funil do Checkpoint — a parte sem JSX, para ser testável.
 */

export type Targets = { analise_enviada_pct: number; aprovada_pct: number; venda_pct: number };

/**
 * Soma da semana de uma equipe; `lancamentos` é quantos diários foram lançados.
 *
 * Vive aqui, e não no arquivo de cards, porque o CSV (`export.ts`) e os testes
 * usam o mesmo formato — e nenhum dos dois deveria importar JSX para isso.
 *
 * `visitas_agendadas`/`visitas_feitas` são coletadas no Diário desde a 0009 e
 * não apareciam em lugar nenhum do Checkpoint: o SELECT da tela nem as pedia.
 *
 * Os nomes são os do card e do CSV, não os do banco: quem preenche este objeto
 * é `addEntry`, e é lá — em um lugar só — que a coluna do banco vira campo de
 * tela.
 */
export type TeamAggr = {
  lancamentos: number; leads: number; ligacoes: number; coleta_docs: number;
  visitas_agendadas: number; visitas_feitas: number;
  enviadas: number; aprovadas: number; vendas: number;
};

export const emptyAggr = (): TeamAggr => ({
  lancamentos: 0, leads: 0, ligacoes: 0, coleta_docs: 0,
  visitas_agendadas: 0, visitas_feitas: 0, enviadas: 0, aprovadas: 0, vendas: 0,
});

/**
 * Sem meta cadastrada, a régua é o funil ideal do produto (`IDEAL_STAGES`).
 *
 * O 10/40/50 era literal aqui e derivado em `@/lib/dailyFunnel` — duas réguas
 * para o mesmo número, e o dia em que o produto mudasse o funil ideal o
 * Checkpoint seguiria cobrando o antigo sem ninguém notar.
 */
export const DEFAULT_TARGETS: Targets = {
  analise_enviada_pct: idealStagePct("analises"),
  aprovada_pct: idealStagePct("aprovados"),
  venda_pct: idealStagePct("vendas"),
};

export const GLOBAL_TARGET_KEY = "__global__";

/** Chave da meta de uma diretoria no mapa de `buildTargetsMap`. */
export const directorTargetKey = (directorId: string) => `dir:${directorId}`;

export type FunnelTargetRow = {
  scope: string;
  team_id: string | null;
  director_id: string | null;
  lead_to_analysis_pct: number;
  analysis_to_approval_pct: number;
  approval_to_sale_pct: number;
};

/**
 * Meta por chave: equipe pelo id, diretoria por `dir:<id>`, global em `__global__`.
 * As linhas chegam da mais recente para a mais antiga e a primeira de cada chave vence.
 *
 * A linha de diretoria tem `team_id` nulo por constraint
 * (`funnel_targets_scope_director`, 0009): chaveá-la pelo `team_id` descartava a
 * meta que o diretor cadastrou, e o card dele saía com a meta da primeira equipe.
 */
export function buildTargetsMap(rows: FunnelTargetRow[]): Record<string, Targets> {
  const map: Record<string, Targets> = {};
  rows.forEach((r) => {
    const key =
      r.scope === "global" ? GLOBAL_TARGET_KEY
      : r.scope === "director" ? (r.director_id ? directorTargetKey(r.director_id) : null)
      : r.team_id;
    if (!key || map[key]) return;
    map[key] = {
      analise_enviada_pct: Number(r.lead_to_analysis_pct),
      aprovada_pct: Number(r.analysis_to_approval_pct),
      venda_pct: Number(r.approval_to_sale_pct),
    };
  });
  return map;
}

/**
 * Precedência chave → global → padrão: a mesma da RPC `public_director_checkpoint`.
 *
 * Chamava-se `targetsFrom`, xará do `targetsFrom` de `@/lib/dailyFunnel`, que
 * resolve OUTRA coisa (uma linha de `funnel_targets`) com outra assinatura.
 * Dois nomes iguais em telas vizinhas é como a régua de um vira a régua do
 * outro num import automático.
 */
export const targetsForKey = (map: Record<string, Targets>, key: string): Targets =>
  map[key] ?? map[GLOBAL_TARGET_KEY] ?? DEFAULT_TARGETS;

/**
 * Sem lead na semana o funil não tem base: 0/0 não é "abaixo da meta".
 * Devolve o rótulo que entra no lugar de gargalo/no ritmo, ou null quando há base.
 */
export const funnelBaseLabel = (aggr: { lancamentos: number; leads: number }): string | null =>
  aggr.lancamentos === 0 ? "Sem lançamentos nesta semana"
  : aggr.leads === 0 ? "Sem leads nesta semana"
  : null;

/**
 * Uma linha de `daily_entries` somada no acumulado da equipe.
 *
 * A tradução coluna → tela é a do Diário (`fromDailyEntry`) e não uma segunda
 * escrita à mão no SELECT do Checkpoint. Os três apelidos abaixo são a única
 * diferença de vocabulário entre o card da reunião e o Diário, e ficam AQUI,
 * uma vez — não espalhados pela consulta, pelo tipo da linha e pela soma.
 */
export function addEntry(acc: TeamAggr, row: DailyEntryColumns): TeamAggr {
  const valores = fromDailyEntry(row);
  acc.leads += valores.leads;
  acc.ligacoes += valores.ligacoes;
  acc.coleta_docs += valores.coleta_docs;
  acc.visitas_agendadas += valores.visitas_agendadas;
  acc.visitas_feitas += valores.visitas_realizadas;
  acc.enviadas += valores.analises;
  acc.aprovadas += valores.aprovados;
  acc.vendas += valores.vendas;
  return acc;
}

export type FunnelStage = { base: number; pct: number; target: number };

/**
 * Estágio sem base (denominador 0) não é "abaixo da meta": 20 leads e nenhuma
 * análise enviada deixa aprovação e venda em 0/0, e apontar "Venda" como
 * gargalo esconde o gargalo real, que é a análise.
 */
export const belowTarget = (s: FunnelStage) => s.base > 0 && s.pct < s.target;

/** O gargalo é o primeiro estágio abaixo da meta na ordem do funil: é ele que trava os seguintes. */
export const bottleneck = <S extends FunnelStage>(stages: S[]): S | null => stages.find(belowTarget) ?? null;

export type NamedStage = FunnelStage & { label: string; value: number };

/**
 * Os quatro estágios do funil de uma equipe, na ordem em que um trava o
 * seguinte. Card e exportação leem daqui: uma segunda conta do gargalo no CSV
 * poderia apontar um estágio diferente do que está na tela da reunião.
 */
export function teamStages(aggr: TeamAggr, targets: Targets): NamedStage[] {
  return [
    { label: "Leads", value: aggr.leads, base: aggr.leads, pct: 100, target: 100 },
    {
      label: "Análise Enviada", value: aggr.enviadas, base: aggr.leads,
      pct: aggr.leads ? (aggr.enviadas / aggr.leads) * 100 : 0,
      target: targets.analise_enviada_pct,
    },
    {
      label: "Análise Aprovada", value: aggr.aprovadas, base: aggr.enviadas,
      pct: aggr.enviadas ? (aggr.aprovadas / aggr.enviadas) * 100 : 0,
      target: targets.aprovada_pct,
    },
    {
      label: "Venda", value: aggr.vendas, base: aggr.aprovadas,
      pct: aggr.aprovadas ? (aggr.vendas / aggr.aprovadas) * 100 : 0,
      target: targets.venda_pct,
    },
  ];
}

/** Gargalo da equipe, ou null quando não há base para medir. Mesma regra do card. */
export function teamBottleneck(aggr: TeamAggr, targets: Targets): NamedStage | null {
  if (funnelBaseLabel(aggr)) return null;
  return bottleneck(teamStages(aggr, targets).slice(1));
}

// ============ Mês acumulado e pendências da semana ============
// Vieram da tela pública do diretor (`public_director_checkpoint`, 0039/0071):
// o quadro logado mostrava só a semana. As duas réguas abaixo são as MESMAS da
// RPC de propósito — se divergirem, o mesmo dia aparece cobrado num lado e
// quitado no outro.

/** Formato de data que `daily_reports.report_date` usa. */
export const ISO_DATE = "yyyy-MM-dd";

/**
 * O mês que o quadro acumula, com a âncora da 0071: na semana em que HOJE
 * está, o mês é o de HOJE; fora dela, o da semana navegada.
 *
 * Ancorar sempre na segunda-feira fazia o acumulado mostrar o mês ANTERIOR nos
 * primeiros dias de todo mês que não começa numa segunda. Termina no fim do mês
 * ou hoje, o que vier antes — mês futuro fica com intervalo vazio e soma zero,
 * como no banco (`least(month_end, current_date)`).
 */
export function monthRange(weekStart: Date, today: Date): { start: Date; end: Date } {
  const hoje = startOfDay(today);
  const weekEnd = addDays(weekStart, 6);
  const ancora = hoje >= weekStart && hoje <= weekEnd ? hoje : weekStart;
  const start = startOfMonth(ancora);
  return { start, end: min([endOfMonth(start), hoje]) };
}

/** Chave de "esta equipe lançou neste dia". Uma só, para os dois lados casarem. */
export const lancamentoKey = (teamId: string, isoDate: string) => `${teamId}|${isoDate}`;

/**
 * Dias úteis da semana em que uma equipe não lançou o Diário — a cobrança da
 * reunião de segunda.
 *
 * Mesma régua da RPC (0080): sábado e domingo fora (ninguém lança no fim de
 * semana), HOJE não é pendência (ainda está aberto para preencher) e dia
 * "preenchido" é dia com LANÇAMENTO — relatório sem nenhuma entrada não limpa a
 * cobrança, senão o Diário seguia mostrando o dia vazio e a tela dizia que
 * estava em dia.
 */
export function missingDays(
  weekStart: Date,
  today: Date,
  teamIds: string[],
  lancado: ReadonlySet<string>,
): { date: string; teamIds: string[] }[] {
  const limite = addDays(startOfDay(today), -1);
  const out: { date: string; teamIds: string[] }[] = [];
  for (let i = 0; i < 5; i += 1) {
    const dia = addDays(weekStart, i);
    if (dia > limite) break;
    const iso = format(dia, ISO_DATE);
    const faltam = teamIds.filter((id) => !lancado.has(lancamentoKey(id, iso)));
    if (faltam.length) out.push({ date: iso, teamIds: faltam });
  }
  return out;
}
