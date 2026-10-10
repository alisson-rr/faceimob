import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/** Candidato a corretor aprovado pela Luna (0264). */
export type StatusCandidato = "disponivel" | "em_entrevista" | "selecionado" | "descartado";
export type ZonaCandidato = "norte" | "sul" | "outra";

export type Candidato = {
  id: string;
  nome: string;
  telefone: string | null;
  zona: ZonaCandidato;
  respostas: Record<string, unknown>;
  resumo: string | null;
  score: number | null;
  status: StatusCandidato;
  responsavel_id: string | null;
  pego_em: string | null;
  status_em: string | null;
  created_at: string;
  responsavel: { full_name: string | null } | null;
};

export type PainelCandidatos = {
  hoje: number;
  semana: number;
  mes: number;
  por_status: Partial<Record<StatusCandidato, number>>;
  por_gestor: Array<{ nome: string | null; em_entrevista: number; selecionado: number; descartado: number }>;
};

export const ROTULO_STATUS: Record<StatusCandidato, string> = {
  disponivel: "Disponível",
  em_entrevista: "Em entrevista",
  selecionado: "Selecionado",
  descartado: "Descartado",
};

export const ROTULO_ZONA: Record<ZonaCandidato, string> = {
  norte: "Zona Norte",
  sul: "Zona Sul",
  outra: "Sem zona",
};

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/*
 * `candidatos` e as RPCs nasceram na 0264, depois do último `supabase gen
 * types`: a forma vem declarada aqui até a próxima geração do `types.ts`, que
 * não se edita à mão. Quem filtra o que cada um vê é a RLS (gestor: os
 * disponíveis e os que pegou; admin/sócio: todos).
 */
const db = supabase as unknown as {
  from(tabela: "candidatos"): {
    select(colunas: string): {
      order(coluna: "created_at", opcoes: { ascending: boolean }): {
        limit(n: number): Resultado<Candidato[]>;
      };
    };
  };
  rpc(nome: "candidato_pegar" | "candidato_devolver", args: { p_id: string }): Resultado<unknown>;
  rpc(nome: "candidato_mudar_status", args: { p_id: string; p_status: StatusCandidato }): Resultado<unknown>;
  rpc(nome: "candidatos_painel"): Resultado<PainelCandidatos>;
};

/** Até 500 mais recentes: o volume é de dezenas por semana. */
export async function listCandidatos(): Promise<Candidato[]> {
  const { data, error } = await db.from("candidatos")
    .select("id, nome, telefone, zona, respostas, resumo, score, status, responsavel_id, pego_em, status_em, created_at, responsavel:profiles!candidatos_responsavel_id_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw dbError("candidatos", error);
  return data ?? [];
}

export async function pegarCandidato(id: string): Promise<void> {
  const { error } = await db.rpc("candidato_pegar", { p_id: id });
  if (error) throw dbError("candidato_pegar", error);
}

export async function mudarStatusCandidato(id: string, status: StatusCandidato): Promise<void> {
  const { error } = await db.rpc("candidato_mudar_status", { p_id: id, p_status: status });
  if (error) throw dbError("candidato_mudar_status", error);
}

export async function devolverCandidato(id: string): Promise<void> {
  const { error } = await db.rpc("candidato_devolver", { p_id: id });
  if (error) throw dbError("candidato_devolver", error);
}

export async function painelCandidatos(): Promise<PainelCandidatos> {
  const { data, error } = await db.rpc("candidatos_painel");
  if (error) throw dbError("candidatos_painel", error);
  return data ?? { hoje: 0, semana: 0, mes: 0, por_status: {}, por_gestor: [] };
}

/** Respostas da entrevista em pares legíveis, sem valores vazios. */
export function respostasDoCandidato(respostas: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(respostas ?? {})
    .filter((par): par is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof par[1]))
    .map(([campo, valor]): [string, string] => [campo, String(valor)])
    .filter(([, valor]) => valor.trim() !== "" && valor.trim() !== "?");
}
