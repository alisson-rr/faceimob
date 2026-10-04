import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// RPC da 0214, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

export type ContagemDoFunil = { leads: number; docs: number; aprovadas: number; vendas: number };

export type NegocioParado = {
  deal_id: string;
  code: string | null;
  cliente: string | null;
  status: string | null;
  desde: string;
  corretor: string | null;
};

export type FunilDeVendas = {
  mes: string;
  /** A diretoria aberta; nulo = a imobiliária inteira. */
  diretor: string | null;
  imob: ContagemDoFunil;
  recorte: ContagemDoFunil | null;
  parados: NegocioParado[];
  diretorias: { id: string; nome: string }[];
  pode_ver_imob: boolean;
};

export async function carregarFunil(mes: string, diretor: string | null): Promise<FunilDeVendas> {
  const { data, error } = await untyped.rpc("funil_de_vendas", { p_mes: mes, p_diretor: diretor });
  if (error) throw error;
  return data as FunilDeVendas;
}

/**
 * As três passagens do funil e o ideal de cada uma (pedido de 04/10/2026):
 * docs = 10% dos leads, aprovadas = 40% das docs, vendas = 50% das aprovadas.
 */
export const PASSAGENS = [
  { de: "leads", para: "docs", rotulo: "Lead → Doc", ideal: 0.1 },
  { de: "docs", para: "aprovadas", rotulo: "Doc → Aprovada", ideal: 0.4 },
  { de: "aprovadas", para: "vendas", rotulo: "Aprovada → Venda", ideal: 0.5 },
] as const satisfies readonly { de: keyof ContagemDoFunil; para: keyof ContagemDoFunil; rotulo: string; ideal: number }[];

/** Taxa da passagem; sem base (0 na camada de cima) não há taxa. */
export const taxa = (c: ContagemDoFunil, de: keyof ContagemDoFunil, para: keyof ContagemDoFunil): number | null =>
  c[de] > 0 ? c[para] / c[de] : null;

export type Leitura = "acima" | "abaixo" | "sem-base";

/** Acima ou abaixo de uma régua (o ideal ou a taxa da imobiliária). Bater a régua conta como acima. */
export const comparar = (valor: number | null, regua: number | null): Leitura =>
  valor == null || regua == null ? "sem-base" : valor >= regua ? "acima" : "abaixo";

export const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** Dias inteiros desde `desde` até `agora`. */
export const diasDesde = (desde: string, agora: Date) =>
  Math.max(0, Math.floor((agora.getTime() - new Date(desde).getTime()) / 86_400_000));
