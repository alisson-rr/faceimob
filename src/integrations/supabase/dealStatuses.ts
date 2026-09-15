/**
 * Catálogo do Status 1 (`deal_status_groups`) e do Status 2 (`deal_statuses`),
 * migration 0149.
 *
 * O Status 2 era lista fixa no front (`FACEIMOB_STATUSES`) e status novo exigia
 * deploy. Agora o administrador cadastra pela tela, e é daqui que opções, cor,
 * ordem e nome exibido saem. `value` é o texto gravado em `deals.status_detail`
 * e não muda; `label` é o nome que a tela mostra e muda.
 *
 * As regras que citam status pelo TEXTO (`LOSS_REASONS`, `SYSTEM_STATUSES`)
 * continuam em `@/lib/dealStatus`: são regra, não cadastro.
 */
import { useQuery } from "@tanstack/react-query";
import type { StatusTone } from "@/components/shared";
import { ccaStageTone } from "@/components/pipeline/ccaStage";
import { bareStatus } from "@/lib/dealStatus";
import { dbError } from "@/lib/supabaseError";
import { supabase } from "./client";
import type { Database } from "./types";

type Tables = Database["public"]["Tables"];

const NBSP = String.fromCharCode(160);

export type DealStatusGroup = Pick<
  Tables["deal_status_groups"]["Row"], "id" | "code" | "label" | "position" | "active"
>;

export type DealStatus = Pick<
  Tables["deal_statuses"]["Row"], "id" | "value" | "label" | "group_id" | "position" | "active" | "locked"
> & { tone: StatusTone };

export type DealStatusCatalog = {
  /** Por `position`. */
  groups: DealStatusGroup[];
  /** Pela ordem do Status 1 e, dentro dele, por `position`. */
  statuses: DealStatus[];
  /** Chave normalizada (`statusKey`) → índice em `statuses`. */
  indexByKey: Map<string, number>;
  groupById: Map<string, DealStatusGroup>;
};

/**
 * A mesma chave do índice único `deal_statuses_value_bare_key` e da derivação do
 * Status 1 no banco: sem prefixo numerado, sem caixa e com o NBSP do Bubble
 * trocado por espaço. "QUEDA" e "18. QUEDA" são o mesmo Status 2.
 */
export const statusKey = (value: string | null | undefined): string =>
  bareStatus((value ?? "").split(NBSP).join(" "));

/** Ordena e indexa. Pura: o teste monta o catálogo de fixture por aqui. */
export function buildDealStatusCatalog(
  groups: DealStatusGroup[],
  statuses: DealStatus[],
): DealStatusCatalog {
  const sortedGroups = [...groups].sort((a, b) => a.position - b.position);
  const groupRank = new Map(sortedGroups.map((group, index) => [group.id, index]));
  const sortedStatuses = [...statuses].sort((a, b) =>
    (groupRank.get(a.group_id) ?? sortedGroups.length) - (groupRank.get(b.group_id) ?? sortedGroups.length)
    || a.position - b.position);
  return {
    groups: sortedGroups,
    statuses: sortedStatuses,
    indexByKey: new Map(sortedStatuses.map((status, index) => [statusKey(status.value), index])),
    groupById: new Map(sortedGroups.map((group) => [group.id, group])),
  };
}

/** Catálogo enquanto a consulta não respondeu: a tela mostra só o valor gravado. */
export const EMPTY_STATUS_CATALOG = buildDealStatusCatalog([], []);

export async function listDealStatusCatalog(): Promise<DealStatusCatalog> {
  const [groups, statuses] = await Promise.all([
    supabase.from("deal_status_groups").select("id,code,label,position,active"),
    supabase.from("deal_statuses").select("id,value,label,group_id,position,tone,active,locked"),
  ]);
  if (groups.error) throw dbError("deal_status_groups", groups.error);
  if (statuses.error) throw dbError("deal_statuses", statuses.error);
  return buildDealStatusCatalog(
    groups.data ?? [],
    // `tone` é texto no banco (CHECK com seis valores): a fronteira valida em
    // vez de confiar no cast.
    (statuses.data ?? []).map((row) => ({ ...row, tone: ccaStageTone(row.tone) })),
  );
}

export const dealStatusKeys = { catalog: ["deal-status-catalog"] as const };

export const useDealStatusCatalog = () =>
  useQuery({ queryKey: dealStatusKeys.catalog, queryFn: listDealStatusCatalog, staleTime: 5 * 60_000 });

/**
 * UPDATE recusado pela RLS não é erro: a linha some do `USING` e o PostgREST
 * devolve 204 sem `error`. Sem conferir a linha, a tela diria "salvo" sem ter
 * gravado (mesma regra de `updateDeal`).
 */
const conferir = (table: string, data: { id: string }[] | null) => {
  if (data?.length) return;
  throw dbError(table, {
    code: "P0001",
    message: "Nada foi gravado: o cadastro pode ter mudado por outra pessoa ou seu perfil não tem permissão. Recarregue a página.",
  });
};

export async function createDealStatusGroup(row: { code: string; label: string; position: number }) {
  const { data, error } = await supabase.from("deal_status_groups").insert(row).select("id");
  if (error) throw dbError("deal_status_groups", error);
  conferir("deal_status_groups", data);
}

/** `code` fica de fora: é imutável no banco (P0001). */
export async function updateDealStatusGroup(
  id: string,
  patch: Partial<Pick<DealStatusGroup, "label" | "position" | "active">>,
) {
  const { data, error } = await supabase.from("deal_status_groups").update(patch).eq("id", id).select("id");
  if (error) throw dbError("deal_status_groups", error);
  conferir("deal_status_groups", data);
}

/**
 * Sem nome exibido na entrada: o gatilho da 0149 dá ao Status 2 novo o texto sem
 * o número na frente ("22. AGUARDANDO VISTORIA" → "AGUARDANDO VISTORIA"), a
 * mesma regra dos status do seed. Mandar o texto digitado como nome levava o
 * número a todo Select, tabela e planilha.
 */
export async function createDealStatus(
  row: Pick<DealStatus, "value" | "group_id" | "position" | "tone">,
) {
  // Vazio, e não ausente: `label` é obrigatório no tipo do INSERT, e o gatilho o
  // preenche antes do CHECK de nome em branco.
  const { data, error } = await supabase.from("deal_statuses").insert({ ...row, label: "" }).select("id");
  if (error) throw dbError("deal_statuses", error);
  conferir("deal_statuses", data);
}

/** `value` fica de fora (os negócios guardam o texto) e `locked` também (é do sistema). */
export async function updateDealStatus(
  id: string,
  patch: Partial<Pick<DealStatus, "label" | "group_id" | "tone" | "active" | "position">>,
) {
  const { data, error } = await supabase.from("deal_statuses").update(patch).eq("id", id).select("id");
  if (error) throw dbError("deal_statuses", error);
  conferir("deal_statuses", data);
}
