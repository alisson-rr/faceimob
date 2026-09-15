import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { allRows, listLegacyDeals, type LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { bareStatus } from "@/lib/dealStatus";
import type { CcaCaseStatus } from "./ccaStage";
import { dealsQuery } from "./data";

export interface CcaStage {
  id: string;
  name: string;
  color: string;
  position: number;
  status: CcaCaseStatus;
  /** Status 2 que a coluna grava no negócio ao receber o caso (0150). Nulo:
   *  a coluna segue o de-para antigo por desfecho. */
  deal_status_id?: string | null;
}

/** Envios ao gerente somados por CPF do titular (`cca_send_counts`, 0150). */
export type CcaSendCount = { agil: number; virar: number };

export type CcaStatusOption = { id: string; label: string; active: boolean };

export interface CcaDeal {
  caseId: string;
  dealId: string;
  client: string;
  developer: string;
  project: string;
  broker: string;
  value: number;
  stageId: string;
  notes: string;
  status: string;
}

export type CcaAnalysis = Record<string, string>;

export const ccaKeys = {
  board: ["cca", "board"] as const,
  // Debaixo de `board`: `useInvalidateCcaBoard` recarrega os envios junto.
  sendCounts: ["cca", "board", "send-counts"] as const,
  statusOptions: ["cca", "status-options"] as const,
  case: (dealId: string) => ["cca", "case", dealId] as const,
};

/**
 * Caso do negócio na esteira, para a aba CCA e para o envio ao gerente (a
 * análise p/ virar negócio depende do `status`).
 *
 * `maybeSingle` porque a maioria dos negócios não tem caso — a ausência é
 * estado normal, não erro. O erro do SELECT, esse, sobe: engoli-lo fazia a aba
 * afirmar "não entrou na esteira" para um negócio que pode ter entrado.
 */
export async function loadCcaCase(
  dealId: string,
): Promise<{ id: string; status: CcaCaseStatus; analysis: CcaAnalysis } | null> {
  const { data, error } = await supabase
    .from("cca_cases").select("id,status,analysis").eq("deal_id", dealId).maybeSingle();
  if (error) throw dbError("cca_cases", error);
  return data ? { id: data.id, status: data.status, analysis: (data.analysis as CcaAnalysis) ?? {} } : null;
}

/**
 * Coluna do caso no quadro: a do próprio estágio, senão a primeira ativa de
 * mesmo desfecho (`stages` vem por posição).
 *
 * Sem nenhuma das duas o caso fica FORA do quadro. Antes caía em `stages[0]`:
 * com a 0150 os 290 casos `cancelled` apontam para "Distrato / Queda", que saiu
 * da tela, e iam todos parar em "EM ANÁLISE" como se estivessem em análise.
 */
export const ccaColumnOf = (
  stages: CcaStage[],
  row: { stage_id: string | null; status: string },
): CcaStage | undefined =>
  stages.find((item) => item.id === row.stage_id) ?? stages.find((item) => item.status === row.status);

/** Rótulos que a coluna não pode gravar — a mesma lista do gatilho
 *  `cca_stages_guard_deal_status` (0150): rótulo de envio ou desfecho.
 *  "RET. ESTEIRA AGIL" pode desde 15/09: é o da coluna RETORNO À ESTEIRA ÁGIL. */
const PROIBIDOS_NA_COLUNA = new Set(["ESTEIRA AGIL", "ANÁLISE P/ VIRAR NEGÓCIO", "QUEDA"]);

export const ccaColumnStatusAllowed = (value: string): boolean => {
  const bare = bareStatus(value.replace(/\u00a0/g, " "));
  return !PROIBIDOS_NA_COLUNA.has(bare) && !/^(OFF|DISTRATO)\b/.test(bare);
};

/** Catálogo de Status 2 que uma coluna pode gravar. Inclui os inativos: a
 *  coluna já ligada a um deles precisa continuar mostrando a ligação. */
export async function loadCcaStatusOptions(): Promise<CcaStatusOption[]> {
  const { data, error } = await supabase
    .from("deal_statuses").select("id,value,label,active").order("label");
  if (error) throw dbError("deal_statuses", error);
  return (data ?? [])
    .filter((row) => ccaColumnStatusAllowed(row.value))
    .map(({ id, label, active }) => ({ id, label, active }));
}

/**
 * Quantas vezes cada cliente foi enviado por esteira. Só as linhas com envio:
 * a contagem começa do zero na 0150 e a função devolve um negócio por caso
 * (~7.500), paginado porque o PostgREST corta em 1.000.
 */
export async function loadCcaSendCounts(): Promise<Map<string, CcaSendCount>> {
  const { data, error } = await allRows((from, to, count) =>
    // `as never`: função sem argumento tem `Args: never` no tipo gerado, e a
    // opção `count` só vai no 3º parâmetro — o mesmo de `deal_participant_names`.
    supabase.rpc("cca_send_counts", undefined as never, { count })
      .or("agil.gt.0,virar.gt.0").order("deal_id").range(from, to));
  if (error) throw dbError("cca_send_counts", error);
  return new Map(data.map((row) => [row.deal_id, { agil: row.agil, virar: row.virar }]));
}

/** `enabled` é `can('cca.review')`: sem ela a função devolve 42501. */
export const useCcaSendCounts = (enabled: boolean) =>
  useQuery({ queryKey: ccaKeys.sendCounts, queryFn: loadCcaSendCounts, enabled });

/**
 * Grava a análise de crédito da aba CCA do negócio.
 *
 * Fica aqui, e não no componente, porque `cca_cases` já é assunto deste módulo
 * — e porque um arquivo de componente que também exporta função quebra o fast
 * refresh (o lint avisa).
 */
export async function saveCcaAnalysis(dealId: string, analysis: CcaAnalysis): Promise<void> {
  const { data, error } = await supabase
    .from("cca_cases").select("id").eq("deal_id", dealId).maybeSingle();
  if (error) throw dbError("cca_cases", error);
  if (!data) return; // Negócio fora da esteira: não há o que gravar.

  // `.select("id")` pelo mesmo motivo de `updateDeal`: a policy `cca_cases_write`
  // é `has_permission('cca.review')` e a aba habilitava por `roles`. Basta o
  // admin desmarcar a permissão para o UPDATE casar 0 linhas — o PostgREST
  // devolve 204 com `error: null` e o modal toastava "Alterações salvas" com a
  // análise de crédito descartada.
  const { data: gravado, error: updateError } = await supabase
    .from("cca_cases").update({ analysis }).eq("id", data.id).select("id");
  if (updateError) throw dbError("cca_cases", updateError);
  if (!gravado?.length) {
    throw dbError("cca_cases", {
      code: "P0001",
      message: "Seu perfil não pode gravar a análise deste caso.",
    });
  }
}

/**
 * Esteira inteira: estágios, casos e os negócios que dão nome a cada caso.
 *
 * O `stage_id` do caso pode estar nulo ou apontar para estágio desativado: cai
 * na coluna de mesmo desfecho (`ccaColumnOf`). Sem coluna o caso sai do quadro,
 * mas não em silêncio — `outside` conta quantos, e a tela diz.
 *
 * Os casos vêm paginados: sem `range` o PostgREST devolve só as primeiras 1.000
 * linhas, sem aviso — a esteira mostrava 1.000 dos 7.560 casos da homologação e
 * os contadores por estágio somavam só esses. As páginas saem por criação, que
 * não muda entre uma página e outra; a tela recebe primeiro o caso mexido por
 * último. O `CcaBoard` desenha 200 cartões por coluna, e o caso recém-movido
 * precisa voltar à vista no topo da coluna de destino, não atrás do "Mostrar
 * mais" (a coluna tem ~1.500 casos na homologação).
 *
 * `loadDeals` é a lista de negócios do cache (`useCcaBoard` passa a MESMA
 * consulta do Pipeline): a esteira baixava a base inteira duas vezes na mesma
 * abertura, uma aqui e outra no `useDeals` da tela.
 */
export async function loadCcaBoard(
  loadDeals: () => Promise<LegacyDealRecord[]> = () => listLegacyDeals(),
): Promise<{ stages: CcaStage[]; deals: CcaDeal[]; outside: number }> {
  const [stagesResponse, casesResponse, dealRows] = await Promise.all([
    supabase.from("cca_stages").select("id,name,color,position,status,active,deal_status_id").eq("active", true).order("position"),
    allRows((from, to, count) => supabase.from("cca_cases")
      .select("id,deal_id,status,stage_id,decision_notes,updated_at", { count })
      .order("created_at").order("id").range(from, to)),
    loadDeals(),
  ]);
  if (stagesResponse.error) throw stagesResponse.error;
  if (casesResponse.error) throw casesResponse.error;

  const stages = (stagesResponse.data || []) as CcaStage[];
  // Um `find` por caso varria a lista inteira: ~28 milhões de comparações.
  const dealById = new Map(dealRows.map((deal) => [deal.id, deal]));
  const recentes = casesResponse.data.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const deals: CcaDeal[] = [];
  let outside = 0;
  for (const row of recentes) {
    const stage = ccaColumnOf(stages, row);
    if (!stage) {
      outside += 1;
      continue;
    }
    const deal = dealById.get(row.deal_id);
    deals.push({
      caseId: row.id,
      dealId: row.deal_id,
      client: deal?.client || "Cliente não informado",
      developer: deal?.developer || "",
      project: deal?.project || "",
      broker: deal?.broker1 || "",
      value: deal?.deal_value || 0,
      stageId: stage.id,
      notes: row.decision_notes || deal?.notes || "",
      status: row.status,
    });
  }

  return { stages, deals, outside };
}

export function useCcaBoard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  return useQuery({
    queryKey: ccaKeys.board,
    // `fetchQuery` serve o cache fresco ou pega carona na carga em voo do
    // `useDeals` que a tela monta junto; só vai à rede se a lista estiver velha.
    queryFn: () => loadCcaBoard(() => queryClient.fetchQuery(dealsQuery(profileId))),
  });
}

export function useInvalidateCcaBoard() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ccaKeys.board });
}
