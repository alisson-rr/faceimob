import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Recados e Dica de Ouro — o mural que a operação publica.
 *
 * NÃO há tabela nova: `important_notices` e `gold_tips` existem desde a
 * migration 0011 e já são escritas pela tela de Gamificação
 * (`GamificationAdmin`). Este módulo é só a leitura tipada, num lugar só, para
 * o Painel do Pipeline não repetir a consulta solta que vivia dentro do
 * componente.
 */

export type Recado = {
  id: string;
  title: string;
  body: string;
  severity: string;
};

export type DicaDeOuro = {
  id: string;
  title: string;
  body: string;
};

export type MuralDoDia = { recados: Recado[]; dicas: DicaDeOuro[] };

export const recadosKeys = {
  mural: ["recados", "mural"] as const,
};

/**
 * O que está vigente AGORA.
 *
 * A vigência é filtrada na consulta e não só pela RLS de propósito:
 * `important_notices_select` (0011) libera a tabela inteira para `is_admin()`,
 * então sem este recorte o administrador leria recado inativo e expirado — o
 * Painel dele mostraria um mural diferente do que a equipe vê, que é
 * exatamente o que um mural não pode fazer.
 */
export async function loadMuralDoDia(): Promise<MuralDoDia> {
  const agora = new Date().toISOString();

  const [avisos, dicas] = await Promise.all([
    supabase
      .from("important_notices")
      .select("id,title,body,severity")
      .eq("active", true)
      .lte("starts_at", agora)
      .or(`ends_at.is.null,ends_at.gt.${agora}`)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("gold_tips")
      .select("id,title,body")
      .eq("active", true)
      .order("sort_order")
      .order("created_at", { ascending: false })
      .limit(3),
  ]);

  if (avisos.error) throw dbError("important_notices", avisos.error);
  if (dicas.error) throw dbError("gold_tips", dicas.error);

  return {
    recados: (avisos.data ?? []) as Recado[],
    dicas: (dicas.data ?? []) as DicaDeOuro[],
  };
}
