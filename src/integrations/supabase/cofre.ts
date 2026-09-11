/**
 * Cofre de credenciais da operação (migration 0105).
 *
 * Guarda os logins da empresa que hoje vivem em papel e em conversa de
 * WhatsApp: e-mail, pipeline, painel de construtora — e a senha de acesso ao
 * sistema que o administrador define para um colaborador.
 *
 * DUAS OPERAÇÕES, DE PROPÓSITO. `listar` devolve rótulo, login e link e NENHUM
 * segredo: abrir a aba não faz senha nenhuma trafegar para o browser.
 * `revelar` traz UM valor por chamada e deixa linha em `credential_reveal_log`
 * na mesma transação — auditoria que o caminho de sucesso pode pular não é
 * auditoria.
 *
 * A senha que a pessoa JÁ usa não existe para ninguém: o Supabase Auth guarda
 * hash. `definirSenhaDeAcesso` é o outro caminho — define uma senha NOVA,
 * aplica no Auth e grava no cofre na mesma chamada.
 */
import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

export type CredencialCofre = {
  id: string;
  label: string;
  login: string;
  link: string | null;
  /** Preenchido = senha de acesso ao sistema daquela pessoa. */
  profile_id: string | null;
  profile_name: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

export type RevelacaoCofre = {
  credential_label: string;
  actor_email: string | null;
  created_at: string;
};

export type PessoaComAcesso = {
  id: string;
  full_name: string;
  email: string | null;
};

export async function listarCredenciais(): Promise<CredencialCofre[]> {
  const { data, error } = await supabase.rpc("list_operation_credentials");
  if (error) throw dbError("listar o cofre da operação", error);
  return data ?? [];
}

/** `id` ausente insere; presente edita. Linha de pessoa o banco recusa editar
 *  por aqui: senha de sistema muda por `definirSenhaDeAcesso`, que troca o Auth
 *  e o cofre juntos. */
export async function salvarCredencial(entrada: {
  id?: string | null;
  label: string;
  login: string;
  secret: string;
  link?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("set_operation_credential", {
    p_label: entrada.label,
    p_login: entrada.login,
    p_secret: entrada.secret,
    p_link: entrada.link?.trim() ? entrada.link.trim() : null,
    p_id: entrada.id ?? null,
  });
  if (error) throw dbError("salvar credencial no cofre", error);
  return data;
}

export async function revelarCredencial(id: string): Promise<string> {
  const { data, error } = await supabase.rpc("reveal_operation_credential", { p_id: id });
  if (error) throw dbError("revelar credencial do cofre", error);
  return data ?? "";
}

/** `false` = não havia linha. A tela distingue isso de uma recusa por
 *  permissão, que chega como 42501. */
export async function apagarCredencial(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("delete_operation_credential", { p_id: id });
  if (error) throw dbError("apagar credencial do cofre", error);
  return Boolean(data);
}

/** Quem revelou o quê, e quando. Só admin/sócio lê (RLS da 0105). */
export async function listarRevelacoes(limit = 10): Promise<RevelacaoCofre[]> {
  const { data, error } = await supabase
    .from("credential_reveal_log")
    .select("credential_label,actor_email,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw dbError("ler quem revelou credenciais", error);
  return data ?? [];
}

/** Pessoas para o seletor de "definir senha". A RLS de `profiles` já recorta
 *  por `auth_visible_profiles()`; para admin e sócio isso é a casa inteira. */
export async function listarPessoasComAcesso(): Promise<PessoaComAcesso[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .eq("status", "active")
    .order("full_name");
  if (error) throw dbError("listar colaboradores", error);
  return data ?? [];
}

export const SENHA_MIN = 8;
export const SENHA_MAX = 72;

/**
 * Define uma senha NOVA para o colaborador.
 *
 * A edge function aplica no Auth e grava no cofre na mesma chamada. Quando o
 * cofre recusa, a senha do Auth já mudou: a resposta vem com
 * `guardadaNoCofre: false` e a tela mostra o valor uma última vez em vez de
 * fingir que nada aconteceu — inventar um erro faria o admin repetir com outro
 * valor e ninguém saberia qual está valendo.
 */
export async function definirSenhaDeAcesso(
  profileId: string,
  senha: string,
): Promise<{ guardadaNoCofre: boolean }> {
  const { data, error } = await supabase.functions.invoke<{
    success?: boolean;
    stored_in_vault?: boolean;
    error?: string;
  }>("provision-broker-user", { body: { profile_id: profileId, password: senha } });

  // A mensagem útil vem no CORPO da resposta, não em `error.message`.
  const corpo = data ?? (error ? await corpoDoErro(error) : null);
  if (corpo?.error) throw new Error(corpo.error);
  if (error) throw error;
  if (!corpo?.success) throw new Error("Não foi possível definir a senha.");

  return { guardadaNoCofre: corpo.stored_in_vault !== false };
}

/** O SDK transforma 4xx em `error` e esconde o corpo em `error.context`; sem
 *  abrir esse corpo, a recusa por senha curta chegaria à tela como um
 *  "Edge Function returned a non-2xx status code" genérico. */
async function corpoDoErro(error: unknown) {
  const contexto = (error as { context?: Response }).context;
  try {
    return await contexto?.clone().json() as
      { success?: boolean; stored_in_vault?: boolean; error?: string } | undefined;
  } catch {
    return undefined;
  }
}
