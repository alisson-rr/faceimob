import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

// As duas RPCs são da 0179 e ainda não estão no `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

export type NegocioDoCpf = {
  deal_id: string;
  codigo: string | null;
  cliente: string | null;
  /** "distrato" (0205): já contabilizado em mês anterior, não é retomado pelo corretor. */
  situacao: "ativo" | "encerrado" | "distrato";
  status2: string | null;
  corretor: string | null;
  gerente: string | null;
  /** Último comentário do histórico e quando foi feito (0205). */
  ultimo_comentario: string | null;
  ultimo_comentario_em: string | null;
};

const SITUACOES = ["ativo", "encerrado", "distrato"] as const;

export const cpfDigitos = (cpf: string | null | undefined): string => (cpf ?? "").replace(/\D/g, "");

/** Os CPFs do formulário que valem batida: 11 dígitos, sem repetir. */
export const cpfsParaBatida = (form: { cpf?: string | null; cpf2?: string | null }): string[] =>
  [...new Set([cpfDigitos(form.cpf), cpfDigitos(form.cpf2)].filter((cpf) => cpf.length === 11))];

const texto = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** Linha da RPC validada na fronteira: o banco é a fonte, mas o tipo não valida nada. */
export function lerNegocioDoCpf(row: unknown): NegocioDoCpf | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const situacao = SITUACOES.find((s) => s === r.situacao);
  if (typeof r.deal_id !== "string" || !situacao) return null;
  return {
    deal_id: r.deal_id,
    codigo: texto(r.codigo),
    cliente: texto(r.cliente),
    situacao,
    status2: texto(r.status2),
    corretor: texto(r.corretor),
    gerente: texto(r.gerente),
    ultimo_comentario: texto(r.ultimo_comentario),
    ultimo_comentario_em: texto(r.ultimo_comentario_em),
  };
}

/** Batida de CPF (0179): o negócio que já tem algum dos CPFs, o ativo primeiro. */
export async function negocioDoCpf(cpfs: string[]): Promise<NegocioDoCpf | null> {
  const achados: NegocioDoCpf[] = [];
  for (const cpf of cpfs) {
    const { data, error } = await untyped.rpc("negocio_do_cpf", { p_cpf: cpf });
    if (error) throw dbError("negocio_do_cpf", error);
    const negocio = lerNegocioDoCpf(Array.isArray(data) ? data[0] : data);
    if (negocio) achados.push(negocio);
  }
  return achados.find((n) => n.situacao === "ativo")
    ?? achados.find((n) => n.situacao === "distrato")
    ?? achados[0] ?? null;
}

/** O banco exige um comentário: sem um escrito, fica registrado o motivo padrão. */
export const comentarioDaRetomada = (comentario: string): string =>
  comentario.trim() || "Negociação retomada pela batida de CPF.";

/** Retoma o negócio em OFF ou QUEDA achado na batida: tudo vem junto para o novo corretor. */
export async function assumirNegocioDoCpf(dealId: string, comentario: string): Promise<void> {
  const { error } = await untyped.rpc("assumir_negocio_do_cpf", {
    p_deal_id: dealId,
    p_comentario: comentarioDaRetomada(comentario),
  });
  if (error) throw dbError("assumir_negocio_do_cpf", error);
}
