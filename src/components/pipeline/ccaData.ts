import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SAO_PAULO_UTC_OFFSET } from "@/integrations/supabase/checkin";
import { dbError } from "@/lib/supabaseError";
import { allRows, last30DaysRange, listLegacyDeals, type LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { bareStatus } from "@/lib/dealStatus";
import type { CcaCaseStatus } from "./ccaStage";
import type { Database } from "@/integrations/supabase/types";

// Ponte tipada da 0156 até regenerar types.ts contra o banco migrado.
type CcaCaseWithClock = Pick<Database["public"]["Tables"]["cca_cases"]["Row"],
  "id" | "deal_id" | "status" | "stage_id" | "decision_notes" | "submitted_at"> & { stage_entered_at: string | null };

export interface CcaStage {
  id: string;
  name: string;
  color: string;
  position: number;
  status: CcaCaseStatus;
  /** Status 2 que a coluna grava no negócio ao receber o caso (0150). Nulo:
   *  a coluna segue o de-para antigo por desfecho. */
  deal_status_id?: string | null;
  /** Mover para a coluna avisa corretor e gerente (0155). `false` = movimento
   *  interno da CCA. Ausente vale `true`, o padrão do banco. */
  notify_sales?: boolean;
  /** Nome do Status 2 de `deal_status_id`, para o diálogo de mover dizer qual grava. */
  deal_status?: { label: string } | null;
}

/** A coluna avisa o comercial? Ausente é o padrão do banco: avisa. */
export const ccaStageNotifiesSales = (stage: Pick<CcaStage, "notify_sales">) => stage.notify_sales !== false;

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
  cpf?: string;
  submittedAt?: string | null;
  stageEnteredAt?: string | null;
  agile?: boolean;
}

export type CcaAnalysis = Record<string, string>;

/** Período do quadro pela entrada do caso na esteira (`submitted_at`): datas
 *  `AAAA-MM-DD` do calendário de São Paulo, as duas inclusivas. */
export type CcaPeriodo = { de: string; ate: string };

export interface CcaBoardData {
  stages: CcaStage[];
  deals: CcaDeal[];
  /** Casos do período sem coluna ativa (cancelados ou sem estágio). */
  outside: number;
  /** Negócios dos casos carregados: o editor e o `CcaMoveDialog` leem daqui. */
  negocios: LegacyDealRecord[];
}

export const ccaKeys = {
  /** PREFIXO do quadro: `useInvalidateCcaBoard` recarrega o período aberto e os envios juntos. */
  board: ["cca", "board"] as const,
  period: (de: string, ate: string) => ["cca", "board", "period", de, ate] as const,
  sendCounts: (dealIds: string[]) => ["cca", "board", "send-counts", dealIds] as const,
  statusOptions: ["cca", "status-options"] as const,
  case: (dealId: string) => ["cca", "case", dealId] as const,
};

const DIA_MS = 86_400_000;
const somaDias = (dia: string, dias: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);

/** De hoje-30 até hoje no calendário de São Paulo: o período com que a tela abre —
 *  o mesmo `last30DaysRange` do Pipeline, para as duas telas não divergirem. */
export function ultimos30Dias(agora: Date = new Date()): CcaPeriodo {
  const { from, to } = last30DaysRange(agora);
  return { de: from, ate: to };
}

const DATA = /^20\d{2}-\d{2}-\d{2}$/;

/**
 * Período completo e em ordem. O "20" do ano barra o meio da digitação: o campo
 * de data emite 0002, 0020 e 0202 antes de 2026, e cada um viraria uma consulta
 * de séculos.
 */
export const periodoValido = ({ de, ate }: CcaPeriodo): boolean => DATA.test(de) && DATA.test(ate) && de <= ate;

/** Instantes para o banco: meia-noite de São Paulo do `de` até a do dia seguinte ao `ate`, exclusiva. */
export const limitesDoPeriodo = ({ de, ate }: CcaPeriodo) => ({
  desde: `${de}T00:00:00${SAO_PAULO_UTC_OFFSET}`,
  antesDe: `${somaDias(ate, 1)}T00:00:00${SAO_PAULO_UTC_OFFSET}`,
});

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
 * Quantas vezes cada cliente foi enviado por esteira, só para os negócios do
 * quadro (`p_deal_ids`, 0151) e só as linhas com envio. Paginado porque o
 * PostgREST corta em 1.000, e um período longo passa disso.
 */
export async function loadCcaSendCounts(dealIds: string[]): Promise<Map<string, CcaSendCount>> {
  const { data, error } = await allRows((from, to, count) =>
    // `as never` até o `types.ts` ser regerado com a 0151: o tipo gerado ainda
    // é o da função sem argumento (`Args: never`). O `count` só vai no 3º
    // parâmetro — o mesmo de `deal_participant_names`.
    supabase.rpc("cca_send_counts", { p_deal_ids: dealIds } as never, { count })
      .or("agil.gt.0,virar.gt.0").order("deal_id").range(from, to));
  if (error) throw dbError("cca_send_counts", error);
  return new Map(data.map((row) => [row.deal_id, { agil: row.agil, virar: row.virar }]));
}

/** `enabled` é `can('cca.review')`: sem ela a função devolve 42501. */
export const useCcaSendCounts = (dealIds: string[], enabled: boolean) =>
  useQuery({
    queryKey: ccaKeys.sendCounts(dealIds),
    queryFn: () => loadCcaSendCounts(dealIds),
    enabled: enabled && dealIds.length > 0,
  });

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
 * Esteira de um período: estágios, os casos que ENTRARAM nele e os negócios
 * desses casos.
 *
 * O período vai para o banco (`submitted_at`), não para o navegador: a tela
 * baixava os 7.560 casos e os 7.579 negócios da homologação a cada abertura
 * para mostrar os ~188 dos últimos 30 dias. Os negócios vêm depois, só pelos
 * ids dos casos carregados.
 *
 * Ordem de chegada (`submitted_at asc`, com `id` de desempate para as
 * páginas não trocarem linhas). O `stage_id` nulo ou de estágio desativado cai
 * na coluna de mesmo desfecho (`ccaColumnOf`); sem coluna o caso sai do quadro,
 * mas `outside` conta quantos, e a tela diz.
 */
export async function loadCcaBoard(
  periodo: CcaPeriodo,
  signal: AbortSignal = new AbortController().signal,
): Promise<CcaBoardData> {
  const { desde, antesDe } = limitesDoPeriodo(periodo);
  const [stagesResponse, casesResponse] = await Promise.all([
    supabase.from("cca_stages")
      .select("id,name,color,position,status,active,deal_status_id,notify_sales,deal_status:deal_statuses(label)")
      .eq("active", true).order("position").abortSignal(signal),
    allRows((from, to, count) => supabase.from("cca_cases")
      .select("id,deal_id,status,stage_id,decision_notes,submitted_at,stage_entered_at", { count })
      .gte("submitted_at", desde).lt("submitted_at", antesDe)
      .order("submitted_at", { ascending: true }).order("id").range(from, to).abortSignal(signal)
      .returns<CcaCaseWithClock[]>()),
  ]);
  if (stagesResponse.error) throw stagesResponse.error;
  if (casesResponse.error) throw casesResponse.error;

  // Período sem caso não pede negócio nenhum: lista de ids vazia não vira "todos".
  const negocios = casesResponse.data.length
    ? await listLegacyDeals(signal, { ids: casesResponse.data.map((row) => row.deal_id) })
    : [];

  const stages: CcaStage[] = stagesResponse.data || [];
  const dealById = new Map(negocios.map((deal) => [deal.id, deal]));
  const deals: CcaDeal[] = [];
  let outside = 0;
  for (const row of casesResponse.data) {
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
      cpf: deal?.cpf || "",
      submittedAt: row.submitted_at,
      stageEnteredAt: row.stage_entered_at,
      agile: bareStatus(deal?.status ?? "").normalize("NFD").replace(/\p{M}/gu, "") === "ESTEIRA AGIL",
    });
  }

  return { stages, deals, outside, negocios };
}

export function useCcaBoard(periodo: CcaPeriodo, enabled = true) {
  return useQuery({
    queryKey: ccaKeys.period(periodo.de, periodo.ate),
    queryFn: ({ signal }) => loadCcaBoard(periodo, signal),
    enabled,
    // Trocar a data mantém o quadro anterior até o novo chegar: cair no
    // esqueleto desmontaria os campos de data no meio da digitação.
    placeholderData: keepPreviousData,
  });
}

export function useInvalidateCcaBoard() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ccaKeys.board });
}
