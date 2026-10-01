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
  Tables["deal_statuses"]["Row"],
  "id" | "value" | "label" | "group_id" | "position" | "active" | "locked" | "stage_id" | "requires_note" | "color"
> & { tone: StatusTone };

export type DealStatusCcaStage = Pick<
  Tables["cca_stages"]["Row"], "id" | "name" | "position" | "active" | "deal_status_id"
>;

/**
 * Funções que a matriz do Status 2 distingue (0164). Admin e sócio passam
 * sempre, no banco (`is_admin()`) e aqui — não têm linha.
 */
export type StatusRole = "broker" | "manager" | "director" | "cca";
export const STATUS_ROLES: { role: StatusRole; label: string }[] = [
  { role: "broker", label: "Corretor" },
  { role: "manager", label: "Gerente" },
  { role: "director", label: "Diretor" },
  { role: "cca", label: "CCA" },
];

/** Quem coloca (`enter`) e quem tira (`exit`) o negócio do Status 2. */
export type StatusPermission = { enter: boolean; exit: boolean };
export type StatusPermissionRow = {
  status_id: string;
  role: StatusRole;
  can_enter: boolean;
  can_exit: boolean;
};

export type DealStatusCatalog = {
  /** Por `position`. */
  groups: DealStatusGroup[];
  /** Pela ordem do Status 1 e, dentro dele, por `position`. */
  statuses: DealStatus[];
  /** Chave normalizada (`statusKey`) → índice em `statuses`. */
  indexByKey: Map<string, number>;
  groupById: Map<string, DealStatusGroup>;
  /** Status 2 → função → quem coloca/tira (0164). Sem entrada = só admin. */
  permissions: Map<string, Partial<Record<StatusRole, StatusPermission>>>;
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
  permissionRows: StatusPermissionRow[] = [],
): DealStatusCatalog {
  const permissions = new Map<string, Partial<Record<StatusRole, StatusPermission>>>();
  for (const row of permissionRows) {
    const porFuncao = permissions.get(row.status_id) ?? {};
    porFuncao[row.role] = { enter: row.can_enter, exit: row.can_exit };
    permissions.set(row.status_id, porFuncao);
  }
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
    permissions,
  };
}

/** Catálogo enquanto a consulta não respondeu: a tela mostra só o valor gravado. */
export const EMPTY_STATUS_CATALOG = buildDealStatusCatalog([], []);

export async function listDealStatusCatalog(): Promise<DealStatusCatalog> {
  const [groups, statuses, permissions] = await Promise.all([
    supabase.from("deal_status_groups").select("id,code,label,position,active"),
    supabase.from("deal_statuses").select("id,value,label,group_id,position,tone,color,active,locked,stage_id,requires_note"),
    supabase.from("deal_status_permissions").select("status_id,role,can_enter,can_exit"),
  ]);
  if (groups.error) throw dbError("deal_status_groups", groups.error);
  if (statuses.error) throw dbError("deal_statuses", statuses.error);
  if (permissions.error) throw dbError("deal_status_permissions", permissions.error);
  return buildDealStatusCatalog(
    groups.data ?? [],
    // `tone` é texto no banco (CHECK com seis valores): a fronteira valida em
    // vez de confiar no cast.
    (statuses.data ?? []).map((row) => ({ ...row, tone: ccaStageTone(row.tone) })),
    // Só as funções que a matriz conhece; o enum do banco tem outras.
    (permissions.data ?? []).filter((row): row is StatusPermissionRow =>
      STATUS_ROLES.some((item) => item.role === row.role)),
  );
}

export const dealStatusKeys = {
  catalog: ["deal-status-catalog"] as const,
  ccaStages: ["deal-status-cca-stages"] as const,
};

export const useDealStatusCatalog = () =>
  useQuery({ queryKey: dealStatusKeys.catalog, queryFn: listDealStatusCatalog, staleTime: 5 * 60_000 });

export async function listDealStatusCcaStages(): Promise<DealStatusCcaStage[]> {
  const { data, error } = await supabase
    .from("cca_stages")
    .select("id,name,position,active,deal_status_id")
    .eq("active", true)
    .order("position");
  if (error) throw dbError("cca_stages", error);
  return data ?? [];
}

export async function updateCcaStageDealStatus(stageId: string, dealStatusId: string | null) {
  const { data, error } = await supabase
    .from("cca_stages")
    .update({ deal_status_id: dealStatusId })
    .eq("id", stageId)
    .select("id");
  if (error) throw dbError("cca_stages", error);
  conferir("cca_stages", data);
}

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
  row: Pick<DealStatus, "value" | "group_id" | "position" | "tone"> & { color?: string | null },
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
  patch: Partial<Pick<DealStatus, "label" | "group_id" | "tone" | "color" | "active" | "position" | "stage_id" | "requires_note">>,
) {
  const { data, error } = await supabase.from("deal_statuses").update(patch).eq("id", id).select("id");
  if (error) throw dbError("deal_statuses", error);
  conferir("deal_statuses", data);
}

/** Grava quem coloca/tira o negócio de um Status 2, para uma função (só admin, 0164). */
export async function setDealStatusPermission(
  statusId: string,
  role: StatusRole,
  patch: Partial<StatusPermission>,
) {
  const { data, error } = await supabase
    .from("deal_status_permissions")
    .upsert({
      status_id: statusId,
      role,
      ...(patch.enter === undefined ? {} : { can_enter: patch.enter }),
      ...(patch.exit === undefined ? {} : { can_exit: patch.exit }),
      updated_at: new Date().toISOString(),
    }, { onConflict: "status_id,role" })
    .select("status_id");
  if (error) throw dbError("deal_status_permissions", error);
  if (!data?.length) conferir("deal_status_permissions", null);
}

/**
 * Por que quem está logado não pode trocar o Status 2 de `from` para `to`, ou
 * `null`. O MESMO recorte de `deal_status_move_block` (0164) — a tela usa para
 * desenhar a recusa antes do gesto; quem decide é o banco.
 */
export function statusMoveBlock(
  catalog: Pick<DealStatusCatalog, "statuses" | "indexByKey" | "permissions">,
  from: string | null | undefined,
  to: string,
  who: { isAdmin: boolean; roles: readonly string[] },
): string | null {
  if (who.isAdmin) return null;
  const destinoIndex = catalog.indexByKey.get(statusKey(to));
  const destino = destinoIndex === undefined ? null : catalog.statuses[destinoIndex];
  if (!destino) return "Este Status 2 não está no cadastro.";
  const origemIndex = catalog.indexByKey.get(statusKey(from));
  const origem = origemIndex === undefined ? null : catalog.statuses[origemIndex];
  const pode = (statusId: string, campo: keyof StatusPermission) => {
    const porFuncao = catalog.permissions.get(statusId) ?? {};
    return STATUS_ROLES.some(({ role }) => who.roles.includes(role) && porFuncao[role]?.[campo]);
  };
  if (origem && origem.id !== destino.id && !pode(origem.id, "exit")) {
    return `Seu perfil não tira o negócio de "${origem.label}".`;
  }
  if (!pode(destino.id, "enter")) return `Seu perfil não coloca o negócio em "${destino.label}".`;
  return null;
}

/**
 * Troca o Status 2 pela RPC da 0164: a matriz, a observação obrigatória e a
 * etapa que o status implica são do banco.
 */
export async function moveDealStatus(dealId: string, status: string, note?: string) {
  const { error } = await supabase.rpc("move_deal_status", {
    p_deal_id: dealId,
    p_status: status,
    ...(note?.trim() ? { p_note: note.trim() } : {}),
  });
  if (error) throw dbError("mover Status 2", error);
}
