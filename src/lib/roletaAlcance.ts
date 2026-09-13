/**
 * Quem liga e desliga corretor numa roleta, na tela de Automação de Leads.
 *
 * Espelha a policy `distribution_group_members_write` (0141) sem copiar a
 * hierarquia: `is_admin()` (admin ou sócio) grava em qualquer roleta; o diretor
 * só na que `auth_distribution_group_ids()` já devolve para ele. O conjunto vem
 * do banco — a tela só pergunta se o grupo está nele. A outra metade da policy
 * (pessoa em `auth_visible_profiles()`) já chega recortada: a lista de
 * corretores sai de `profiles`, cuja RLS é esse mesmo predicado.
 */
export type AcessoRoleta = {
  /** `isAdmin` do AuthContext: admin ou sócio, como `is_admin()`. */
  livre: boolean;
  diretor: boolean;
  /** `auth_distribution_group_ids()` de quem olha. */
  alcance: ReadonlySet<string>;
};

/** Recusa da RLS ao gravar filiação, dita com a regra em vez do genérico. */
export const RECUSA_FILIACAO =
  "Fora do seu alcance: o diretor só ajusta corretores da própria equipe nas roletas que ela já atende. O resto é com o administrador.";

/** Admin e sócio operam todas as roletas; os demais veem só as do alcance. */
export function roletasNaTela<G extends { id: string }>(acesso: Pick<AcessoRoleta, "livre" | "alcance">, grupos: G[]): G[] {
  return acesso.livre ? grupos : grupos.filter((g) => acesso.alcance.has(g.id));
}

/** `null` libera; senão, o motivo curto que acompanha o controle desabilitado. */
export function bloqueioFiliacao(acesso: AcessoRoleta, grupoId: string): string | null {
  if (acesso.livre) return null;
  if (!acesso.diretor) return "Só administrador, sócio ou diretor ajustam os corretores da roleta.";
  if (!acesso.alcance.has(grupoId)) return "Roleta fora do seu alcance: só o administrador inclui sua equipe nela.";
  return null;
}
