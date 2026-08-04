import { supabase } from "./client";
import type { NewAppRole } from "./newSchema";

/**
 * Adaptador da matriz de permissões.
 *
 * As três abas de `AdminPermissions` saem daqui e das duas tabelas que já
 * existiam no schema: `role_permissions` (papel × código) e `stage_permissions`
 * (etapa × papel × entrar/sair). Item de menu é só um código de categoria
 * `menu` no catálogo `permissions` (migration 0015).
 *
 * O RLS já permite `select` do catálogo para todo autenticado — é o desenho
 * original ("o front usa isso para esconder botões") — e restringe a escrita a
 * admin. Por isso não há RPC nova aqui: esconder o botão é conveniência, quem
 * barra de verdade é a policy.
 */

export type PermissionRecord = {
  code: string;
  label: string;
  category: string;
  description: string | null;
};

export type RolePermissionRecord = {
  role: NewAppRole;
  permission: string;
  allowed: boolean;
};

export type PipelineStageRecord = {
  id: string;
  code: string;
  label: string;
  position: number;
};

export type StagePermissionRecord = {
  stage_id: string;
  role: NewAppRole;
  can_enter: boolean;
  can_exit: boolean;
};

/** Papéis editáveis na tela. `admin` fica de fora: `has_permission()` e
 *  `can_enter_stage()` curto-circuitam em `is_admin()`, então conceder ou negar
 *  linha para admin não mudaria nada e daria a impressão errada de que muda. */
export const EDITABLE_ROLES: { value: NewAppRole; label: string; color: string }[] = [
  { value: "partner", label: "Sócio", color: "text-purple-400" },
  { value: "director", label: "Diretor", color: "text-blue-400" },
  { value: "manager", label: "Gerente", color: "text-cyan-400" },
  { value: "broker", label: "Corretor", color: "text-emerald-400" },
  { value: "cca", label: "CCA", color: "text-amber-400" },
  { value: "sdr", label: "SDR", color: "text-pink-400" },
  { value: "marketing", label: "Marketing", color: "text-orange-400" },
];

export async function listPermissionCatalog(): Promise<PermissionRecord[]> {
  const { data, error } = await supabase
    .from("permissions")
    .select("code,label,category,description")
    .order("category")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []) as PermissionRecord[];
}

export async function listRolePermissions(): Promise<RolePermissionRecord[]> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("role,permission,allowed");
  if (error) throw new Error(error.message);
  return (data ?? []) as RolePermissionRecord[];
}

export async function setRolePermission(
  role: NewAppRole,
  permission: string,
  allowed: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("role_permissions")
    .upsert({ role, permission, allowed }, { onConflict: "role,permission" });
  if (error) throw new Error(error.message);
}

export async function listPipelineStages(): Promise<PipelineStageRecord[]> {
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id,code,label,position")
    .eq("active", true)
    .order("position");
  if (error) throw new Error(error.message);
  return (data ?? []) as PipelineStageRecord[];
}

export async function listStagePermissions(): Promise<StagePermissionRecord[]> {
  const { data, error } = await supabase
    .from("stage_permissions")
    .select("stage_id,role,can_enter,can_exit");
  if (error) throw new Error(error.message);
  return (data ?? []) as StagePermissionRecord[];
}

export async function setStagePermission(
  stageId: string,
  role: NewAppRole,
  patch: { can_enter?: boolean; can_exit?: boolean },
): Promise<void> {
  // A linha pode não existir ainda (o seed só cobre parte da matriz), então o
  // upsert precisa de um valor para as duas colunas. `true` é o default da
  // tabela — manter o mesmo default evita que abrir a tela negue acesso.
  const { error } = await supabase
    .from("stage_permissions")
    .upsert(
      { stage_id: stageId, role, can_enter: patch.can_enter ?? true, can_exit: patch.can_exit ?? true },
      { onConflict: "stage_id,role" },
    );
  if (error) throw new Error(error.message);
}

/**
 * A matriz inteira é pequena (dezenas de linhas) e o RLS já a libera para todo
 * autenticado, então o `AuthContext` carrega tudo uma vez e resolve `can()` em
 * memória — sem round-trip por botão e sem uma segunda forma de ler a mesma
 * coisa. É também o que permite ao admin pré-visualizar outro papel.
 */
