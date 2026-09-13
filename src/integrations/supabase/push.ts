import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Toda chamada ao banco de notificação push mora aqui (migration 0143).
 *
 * Nenhuma tela chama `.rpc`/`.from` de push direto: a regra de quem registra,
 * quem apaga e o que vale sem preferência gravada é do banco, e este arquivo é
 * a única fronteira do front com ela. Os tipos saem de `types.ts` gerado — sem
 * cast: até a migration ser aplicada e os tipos regenerados, o typecheck acusa
 * este arquivo, e é exatamente o aviso que deve aparecer.
 */

/** Categorias de `push_preferences.category`. A regra kind → categoria é `public.push_category`. */
export type PushCategory = "lead_recebido" | "lead_prazo" | "lead_atividade" | "credito" | "outros";

const CATEGORIES: readonly PushCategory[] = ["lead_recebido", "lead_prazo", "lead_atividade", "credito", "outros"];

const isCategory = (value: unknown): value is PushCategory =>
  typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

/** Chave pública VAPID (base64url). `null` = o servidor ainda não tem a credencial gravada. */
export async function getPushPublicKey(): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_push_public_key");
  if (error) throw dbError("ler a chave pública de push", error);
  return typeof data === "string" && data.trim() ? data.trim() : null;
}

export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

/**
 * Grava (ou assume) o endpoint deste navegador para a conta logada. O banco
 * valida host do serviço de push e tamanho das chaves; o upsert é por endpoint,
 * então o mesmo navegador trocando de conta passa a avisar só a conta nova.
 */
export async function registerPushSubscription(input: PushSubscriptionInput): Promise<void> {
  const { error } = await supabase.rpc("register_push_subscription", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.userAgent,
  });
  if (error) throw dbError("registrar este aparelho para avisos", error);
}

/** Apaga a linha deste endpoint da própria conta. Chamar ANTES de sair: depois não há sessão. */
export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  const { error } = await supabase.rpc("unregister_push_subscription", { p_endpoint: endpoint });
  if (error) throw dbError("desligar os avisos deste aparelho", error);
}

/**
 * Apaga as assinaturas de TODOS os aparelhos da conta — para "encerrar todas as
 * sessões" e troca de senha, que derrubam as outras sessões: um aparelho cuja
 * sessão caiu não pode continuar recebendo lead. A policy de delete só alcança
 * a própria linha; o filtro explícito é porque o PostgREST não deve receber
 * delete sem filtro.
 */
export async function deleteAllMyPushSubscriptions(): Promise<void> {
  const { data: sessao, error: erroSessao } = await supabase.auth.getSession();
  if (erroSessao) throw erroSessao;
  const profileId = sessao.session?.user.id;
  if (!profileId) return;
  const { error } = await supabase.from("push_subscriptions").delete().eq("profile_id", profileId);
  if (error) throw dbError("desligar os avisos dos outros aparelhos", error);
}

export type PushPreferenceRow = { category: PushCategory; enabled: boolean };

/** Só as linhas gravadas. Categoria sem linha vale o padrão do contrato (ver `PUSH_CATEGORIES`). */
export async function listMyPushPreferences(): Promise<PushPreferenceRow[]> {
  const { data, error } = await supabase.from("push_preferences").select("category,enabled");
  if (error) throw dbError("ler suas preferências de aviso", error);
  return (data ?? []).flatMap((row) =>
    isCategory(row.category) ? [{ category: row.category, enabled: row.enabled === true }] : [],
  );
}

/**
 * `select` depois do upsert pelo mesmo motivo de `markNotificationRead`: sem
 * ele, um UPDATE recusado pela RLS volta 204 e a tela mostraria o interruptor
 * mudado com o banco intacto.
 */
export async function setPushPreference(profileId: string, category: PushCategory, enabled: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("push_preferences")
    .upsert({ profile_id: profileId, category, enabled }, { onConflict: "profile_id,category" })
    .select("category");
  if (error) throw dbError("salvar preferência de aviso", error);
  if (!data?.length) {
    throw dbError("salvar preferência de aviso", {
      code: "42501",
      message: "nenhuma linha gravada (RLS)",
    });
  }
}

/** Grava o aviso de teste. O banco limita a um a cada 30 s e devolve a frase em pt-BR. */
export async function sendTestPush(): Promise<void> {
  const { error } = await supabase.rpc("send_test_push");
  if (error) throw dbError("enviar aviso de teste", error);
}

/**
 * Categoria de um `kind`, perguntada ao banco — `push_category` é a única fonte
 * da regra, e copiá-la aqui faria o aviso local do Electron divergir do push.
 * Resposta fora do conjunto conhecido cai em `outros`, que vem desligado.
 */
export async function pushCategory(kind: string): Promise<PushCategory> {
  const { data, error } = await supabase.rpc("push_category", { p_kind: kind });
  if (error) throw dbError("classificar aviso", error);
  return isCategory(data) ? data : "outros";
}
