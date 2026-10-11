import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/*
 * `teams.co_director_id` (Diretor 2) nasceu na 0266, depois do último
 * `supabase gen types`: a forma vem declarada aqui até a próxima geração do
 * `types.ts`, que não se edita à mão.
 */
const db = supabase as unknown as {
  from(tabela: "teams"): {
    select(colunas: "id,co_director_id"): Resultado<Array<{ id: string; co_director_id: string | null }>>;
    update(linha: { co_director_id: string | null }): {
      eq(coluna: "id", valor: string): { select(colunas: "id"): Resultado<Array<{ id: string }>> };
    };
  };
};

/** Diretor 2 de cada equipe que o usuário enxerga, por id da equipe. */
export async function listCoDiretores(): Promise<Map<string, string>> {
  const { data, error } = await db.from("teams").select("id,co_director_id");
  if (error) throw dbError("teams", error);
  return new Map((data ?? []).filter((t) => t.co_director_id).map((t) => [t.id, t.co_director_id as string]));
}

/** Só admin/sócio grava (gatilho da 0266). `null` tira o Diretor 2. */
export async function salvarCoDiretor(teamId: string, coDirectorId: string | null): Promise<void> {
  const { data, error } = await db.from("teams").update({ co_director_id: coDirectorId }).eq("id", teamId).select("id");
  if (error) throw dbError("teams", error);
  if (!data?.length) throw new Error("Sem permissão para alterar a equipe.");
}
