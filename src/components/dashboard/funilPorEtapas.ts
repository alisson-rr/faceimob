import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// RPC da 0353, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

export type ItemDaEtapa = { rotulo: string; n: number };

export type FunilPorEtapas = {
  mes: string;
  diretor: string | null;
  leads: number;
  documentos: { producao: ItemDaEtapa[]; legado: ItemDaEtapa[] };
  envios: { total: number; do_mes: number; outros_meses: number };
  aprovados: { total: number; itens: ItemDaEtapa[] };
  vendas: { total: number; itens: ItemDaEtapa[] };
  diretorias: { id: string; nome: string }[];
  pode_ver_imob: boolean;
};

export async function carregarFunilPorEtapas(mes: string, diretor: string | null): Promise<FunilPorEtapas> {
  const { data, error } = await untyped.rpc("funil_por_etapas", { p_mes: mes, p_diretor: diretor });
  if (error) throw error;
  return data as FunilPorEtapas;
}

export const somaDos = (itens: ItemDaEtapa[]) => itens.reduce((t, i) => t + i.n, 0);

/**
 * A régua do funil (pedido de 21/11/2026): envios do mês = 10% dos leads,
 * aprovados = 40% dos envios, vendas = 50% dos aprovados. Documentos não têm
 * meta: vêm de um mês para o outro.
 */
export type Etapa = {
  chave: "leads" | "documentos" | "envios" | "aprovados" | "vendas";
  nome: string;
  total: number;
  /** Fração frente à base da etapa; nulo sem base ou sem meta definida. */
  taxa: number | null;
  meta: number | null;
  base: string | null;
  /** Quanto a meta pedia em número; nulo sem meta. */
  esperado: number | null;
};

const fracao = (a: number, b: number) => (b > 0 ? a / b : null);

export function etapasDoFunil(f: FunilPorEtapas): Etapa[] {
  const docs = somaDos(f.documentos.producao) + somaDos(f.documentos.legado);
  return [
    { chave: "leads", nome: "Leads do mês", total: f.leads, taxa: f.leads > 0 ? 1 : null, meta: null, base: null, esperado: null },
    { chave: "documentos", nome: "Documentos", total: docs, taxa: null, meta: null, base: null, esperado: null },
    { chave: "envios", nome: "Envios p/ análise", total: f.envios.total, taxa: fracao(f.envios.total, f.leads),
      meta: 0.1, base: "leads", esperado: Math.round(f.leads * 0.1) },
    { chave: "aprovados", nome: "Aprovados", total: f.aprovados.total, taxa: fracao(f.aprovados.total, f.envios.total),
      meta: 0.4, base: "envios do mês", esperado: Math.round(f.envios.total * 0.4) },
    { chave: "vendas", nome: "Negócios + Vendas", total: f.vendas.total, taxa: fracao(f.vendas.total, f.aprovados.total),
      meta: 0.5, base: "aprovados", esperado: Math.round(f.aprovados.total * 0.5) },
  ];
}

export const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
