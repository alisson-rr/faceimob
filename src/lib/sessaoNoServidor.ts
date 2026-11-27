import type { Session } from "@supabase/supabase-js";

type AuthParaChecar = {
  getSession: () => Promise<{ data: { session: Session | null } }>;
  refreshSession: () => Promise<{ data: { session: Session | null } }>;
};

/**
 * A tela pode guardar o login de alguém que o servidor já não reconhece
 * (27/11/2026): quando a renovação do token falha, o `supabase-js` passa a
 * mandar as consultas sem usuário, e tudo volta vazio — "Perfil não
 * encontrado", "nenhum turno", "nenhum grupo" — com a pessoa aparentemente
 * logada. Confere o login e tenta renovar uma vez antes de dar como expirado.
 */
export async function sessaoContinuaValida(auth: AuthParaChecar): Promise<boolean> {
  try {
    if ((await auth.getSession()).data.session) return true;
    return Boolean((await auth.refreshSession()).data.session);
  } catch {
    return false;
  }
}
