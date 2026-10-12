import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/** Uma campanha na janela: gasto e o que aconteceu com os leads dela (0267). */
export type QualidadeCampanha = {
  campaign_id: string | null;
  campanha: string;
  nomes_distintos: number;
  formularios: number;
  leads: number;
  atendidos: number;
  qualificados: number;
  em_analise: number;
  aprovadas: number;
  vendas: number;
  gasto: number;
  cpl: number | null;
  custo_qualificado: number | null;
  custo_analise: number | null;
};

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/* `qualidade_por_campanha` nasceu na 0267, depois do último `supabase gen types`. */
const db = supabase as unknown as {
  rpc(nome: "qualidade_por_campanha", args: { p_dias: number }): Resultado<QualidadeCampanha[]>;
};

export async function listQualidadePorCampanha(dias: number): Promise<QualidadeCampanha[]> {
  const { data, error } = await db.rpc("qualidade_por_campanha", { p_dias: dias });
  if (error) throw dbError("qualidade_por_campanha", error);
  return (data ?? []).map((c) => ({
    ...c,
    gasto: Number(c.gasto),
    cpl: c.cpl === null ? null : Number(c.cpl),
    custo_qualificado: c.custo_qualificado === null ? null : Number(c.custo_qualificado),
    custo_analise: c.custo_analise === null ? null : Number(c.custo_analise),
  }));
}

/** Percentual inteiro de `parte` sobre `total`, ou `null` sem base. */
export const percentual = (parte: number, total: number): number | null =>
  total > 0 ? Math.round((parte / total) * 100) : null;

/** Campanha cujos leads vêm com mais de um nome ou formulário: atribuição a conferir. */
export const atribuicaoSuspeita = (c: Pick<QualidadeCampanha, "nomes_distintos" | "formularios">): boolean =>
  c.nomes_distintos > 1 || c.formularios > 1;
