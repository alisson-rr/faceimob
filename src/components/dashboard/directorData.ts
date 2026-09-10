/**
 * Dados do painel da diretoria: escopo (equipes, gerentes, corretores), diario
 * declarado e pipeline medido. Mesmo padrao do `data.ts` do Dashboard — uma
 * consulta por assunto, chave estavel comecando em "dashboard".
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { nextMonthBase } from "@/lib/dealStatus";
import {
  DEFAULT_TARGETS,
  GLOBAL_TARGET_KEY,
  buildTargetsMap,
  directorTargetKey,
  type FunnelTargetRow,
} from "@/components/checkpoint/funnel";
import type { FunnelCounts } from "@/lib/metrics";
import type { Lead } from "@/types/crm";
import type { PipelineStageRecord } from "@/integrations/supabase/permissions";
import { displayMonthToIso, listPeople } from "@/integrations/supabase/newSchema";
import { leadsInMonth, noFunil, participantsOf, type DealRow } from "./data";

export const ALL_TEAMS = "all";

/**
 * O recorte do mes em datas ISO: `[desde, ate)`. Meia-aberto de proposito — com
 * `lte` no ultimo dia, um `report_date` do dia 31 as 00:00 ainda entra e o dia
 * seguinte tambem, dependendo do fuso.
 */
export const monthRange = (mes: string) => ({
  desde: displayMonthToIso(mes),
  ate: displayMonthToIso(nextMonthBase(mes)),
});

export const EMPTY_DAILY = { leads: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 };
export type DirectorDaily = typeof EMPTY_DAILY;

export const EMPTY_FUNNEL: FunnelCounts = { leads: 0, analises: 0, aprovados: 0, vendas: 0 };

/** A regua do funil ja resolvida, com o escopo de onde ela veio. */
export type FunnelRuler = {
  scope: "director" | "team" | "global" | "ideal";
  analises: number;
  aprovados: number;
  vendas: number;
};

/** De onde a regua saiu — sem isto ninguem sabe se e medido por 10% ou por 11,5%. */
export const RULER_LABEL: Record<FunnelRuler["scope"], string> = {
  director: "meta da sua diretoria",
  team: "meta da equipe",
  global: "meta da empresa",
  ideal: "funil ideal — nenhuma meta cadastrada",
};

/**
 * Qual linha de `funnel_targets` cobra este comparativo: diretoria > equipe >
 * empresa > funil ideal.
 *
 * A mesma precedencia que a RPC `public_director_checkpoint` e o /checkpoint ja
 * usam (`buildTargetsMap` + `targetsFrom`, em `components/checkpoint/funnel`).
 * Enquanto esta aba comparava contra 10/40/50 chumbado em `IDEAL_STAGES`, o
 * MESMO diretor era medido por 53% no /checkpoint e por 50% aqui — e o selo
 * "Abaixo da meta" divergia entre as duas telas com o mesmo dado.
 *
 * Com mais de uma equipe no filtro a regua da equipe nao serve (Paulista cobra
 * 12/45/55 e Sul 11/42/52; media de metas nao e meta de ninguem): cai para a
 * da diretoria, e sem ela para a da empresa.
 */
export const pickFunnelRuler = (
  map: Record<string, { analise_enviada_pct: number; aprovada_pct: number; venda_pct: number }>,
  ctx: { directorId: string | null; teamIds: string[] },
): FunnelRuler => {
  const daDiretoria = ctx.directorId ? map[directorTargetKey(ctx.directorId)] : undefined;
  const daEquipe = ctx.teamIds.length === 1 ? map[ctx.teamIds[0]] : undefined;
  const escolhida = daDiretoria ?? daEquipe ?? map[GLOBAL_TARGET_KEY];
  const scope: FunnelRuler["scope"] = daDiretoria
    ? "director"
    : daEquipe
      ? "team"
      : map[GLOBAL_TARGET_KEY]
        ? "global"
        : "ideal";
  const alvo = escolhida ?? DEFAULT_TARGETS;
  return {
    scope,
    analises: alvo.analise_enviada_pct,
    aprovados: alvo.aprovada_pct,
    vendas: alvo.venda_pct,
  };
};

/**
 * A regua cadastrada em `funnel_targets` (`funnel_targets_select` e `true`: a
 * meta e publica dentro do app). Uma consulta so, cacheada como o catalogo de
 * etapas — a lista tem 4 linhas no banco de homologacao.
 */
export function useFunnelTargets() {
  return useQuery({
    queryKey: ["dashboard", "funnel-targets"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funnel_targets")
        .select("scope,team_id,director_id,lead_to_analysis_pct,analysis_to_approval_pct,approval_to_sale_pct")
        .order("effective_from", { ascending: false });
      if (error) throw dbError("funnel_targets", error);
      return buildTargetsMap((data ?? []) as FunnelTargetRow[]);
    },
  });
}

/**
 * Equipes que a pessoa LIDERA e quem esta nelas.
 *
 * Lidera = `teams.director_id` OU `teams.manager_id` — o mesmo criterio de
 * `auth_led_team_ids()`, que e o que a RLS de `daily_reports` e `daily_entries`
 * usa para liberar a leitura. Sem o `manager_id` aqui, o gerente tinha permissao
 * no banco para ler o diario da propria equipe e nenhuma tela que o mostrasse
 * ao lado do pipeline: o comparativo so existia para ele no /checkpoint, com
 * outra regua.
 *
 * O gerente sai de `teams.manager_id`, nao de `team_members` (achado P06):
 * gerente costuma liderar a equipe sem ser membro dela, e derivar a diretoria
 * pela tabela de membros fazia o gerente sumir do escopo do proprio diretor —
 * so o seed criava esses vinculos, a UI nunca. Corretor continua vindo de
 * `team_members`, onde ele e membro de verdade.
 */
export function useLedTeamsScope(leaderId: string | null) {
  return useQuery({
    queryKey: ["dashboard", "led-teams", "scope", leaderId],
    enabled: !!leaderId,
    queryFn: async () => {
      const [people, teamsRes] = await Promise.all([
        listPeople(),
        supabase
          .from("teams")
          .select("id,name,manager_id,director_id")
          .or(`director_id.eq.${leaderId},manager_id.eq.${leaderId}`)
          .eq("active", true)
          .order("name"),
      ]);
      // Engolir o erro aqui virava painel com tudo zerado, que parece operacao
      // parada em vez de consulta falhada.
      if (teamsRes.error) throw dbError("teams", teamsRes.error);

      const teams = teamsRes.data ?? [];
      const teamIds = new Set(teams.map((team) => team.id));
      const managerIds = new Set(teams.map((team) => team.manager_id).filter(Boolean));
      return {
        teams,
        managers: people.filter((person) => managerIds.has(person.id)),
        brokers: people.filter(
          (person) => person.roles.includes("broker") && person.team_id && teamIds.has(person.team_id),
        ),
      };
    },
  });
}

/**
 * Diario declarado: soma das entradas do mes nas equipes filtradas.
 *
 * O mes vem por parametro, nao do relogio: preso no mes corrente, o painel
 * abria zerado todo dia 1º e nao havia como olhar o mes que acabou de fechar.
 * Ele entra na chave da consulta — senao o React Query serve o cache do mes
 * anterior ao trocar o filtro.
 */
export function useDirectorDaily(teamIds: string[], mes: string) {
  return useQuery({
    queryKey: ["dashboard", "director", "daily", teamIds, mes],
    enabled: teamIds.length > 0,
    queryFn: async (): Promise<DirectorDaily> => {
      const { desde, ate } = monthRange(mes);
      const reportsRes = await supabase
        .from("daily_reports")
        .select("id")
        .in("team_id", teamIds)
        .gte("report_date", desde)
        .lt("report_date", ate);
      if (reportsRes.error) throw dbError("daily_reports", reportsRes.error);

      const reportIds = (reportsRes.data ?? []).map((report) => report.id);
      if (!reportIds.length) return { ...EMPTY_DAILY };

      const entriesRes = await supabase
        .from("daily_entries")
        .select("leads,doc_collections,analyses_sent,analyses_approved,sales")
        .in("report_id", reportIds);
      if (entriesRes.error) throw dbError("daily_entries", entriesRes.error);

      return (entriesRes.data ?? []).reduce<DirectorDaily>(
        (total, entry) => ({
          leads: total.leads + (entry.leads || 0),
          coleta_docs: total.coleta_docs + (entry.doc_collections || 0),
          analises: total.analises + (entry.analyses_sent || 0),
          aprovados: total.aprovados + (entry.analyses_approved || 0),
          vendas: total.vendas + (entry.sales || 0),
        }),
        { ...EMPTY_DAILY },
      );
    },
  });
}

/**
 * Pipeline medido: o que o CRM registrou para os mesmos corretores, no mes.
 *
 * Funcao PURA sobre os negocios e leads que o Dashboard ja carregou. Antes era
 * uma consulta propria que baixava TODOS os negocios e TODOS os leads (oito
 * selects) a cada troca de mes ou de equipe, para filtrar no navegador — os
 * mesmos dados que o painel ao lado ja tinha em memoria.
 *
 * A travessia dos corretores e a mesma do ranking (`participantsOf`): ler so
 * `broker1_id` sumia com o negocio dividido cujo ordinal 1 e de outra equipe —
 * o mesmo negocio contava no Dashboard e nao contava aqui, e com o portao de
 * "nenhum lancamento" o painel chegava a negar movimento que existia.
 *
 * **O medido e CUMULATIVO, como o declarado.** `daily_entries.analyses_sent` e
 * `analyses_approved` contam o que aconteceu NO MES; medir a etapa ATUAL do
 * negocio comparava coisas diferentes: negocio que avancou ate "Fechado" saia
 * de `under_analysis` e o comparativo dizia "2 análises declaradas vs 0
 * medidas · 0% de aderência" — em vermelho — para analise que de fato
 * aconteceu. Aqui o negocio conta na etapa que ele ALCANCOU, pela posicao do
 * catalogo (`pipeline_stages.position`), e por isso a funcao precisa do
 * catalogo: a ordem e dado do banco, nao lista chumbada no frontend.
 *
 * Perdido e cancelado ficam de fora (`noFunil`, a mesma regra do KPI
 * "Negocios"): a etapa `lost` e a ULTIMA do catalogo (posicao 9), entao sem
 * esse filtro todo negocio perdido — mesmo o perdido na proposta — passaria
 * por "alcancou a analise".
 *
 * ponytail: "alcancou" e inferido da posicao atual, nao do historico —
 * `deal_history` existe mas quase nao tem linha de mudanca de etapa (9 no
 * banco de homologacao), entao negocio que passou pela analise e depois foi
 * perdido nao entra. Evoluir para `deal_history` quando o gatilho passar a
 * registrar toda troca de etapa.
 */
export function directorPipeline(
  deals: DealRow[],
  leads: Lead[],
  brokerIds: string[],
  mes: string,
  stages: PipelineStageRecord[],
): FunnelCounts {
  if (!brokerIds.length) return { ...EMPTY_FUNNEL };
  const owners = new Set(brokerIds);
  const rows = deals.filter(
    (deal) =>
      deal.month_base === mes &&
      participantsOf(deal, "broker").some((person) => owners.has(person.id)),
  );

  /** Negocios que chegaram a etapa `code` ou passaram dela. Catalogo sem a
   *  etapa (ou ainda carregando) devolve zero — chutar posicao inventaria
   *  numero. */
  const alcancaram = (code: string) => {
    const alvo = stages.find((stage) => stage.code === code)?.position;
    if (alvo === undefined) return 0;
    return rows.filter((deal) => noFunil(deal) && deal.stage_position >= alvo).length;
  };

  return {
    // A MESMA regra do KPI "Leads" e da aba Leads (`leadsInMonth`). Comparar o
    // `created_at` como texto contra a data pura punha o mesmo lead em dois
    // meses na mesma tela: o PostgREST devolve o instante em UTC
    // ("2026-10-01T02:00:00+00:00" para 30/09 as 23h em Brasilia), entao o
    // recorte por texto jogava para outubro o lead que o cartao ao lado
    // contava em setembro.
    leads: leadsInMonth(leads, mes).filter((lead) => owners.has(lead.broker_id)).length,
    analises: alcancaram("under_analysis"),
    aprovados: alcancaram("approved"),
    vendas: rows.filter((deal) => deal.outcome === "won").length,
  };
}
