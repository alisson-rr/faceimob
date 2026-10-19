import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";

/** Uma linha de `equipes_por_diretoria` (0291): um corretor numa equipe de uma diretoria. */
export type LinhaDaDiretoria = {
  diretor_id: string | null;
  diretor_nome: string;
  equipe_id: string;
  equipe_nome: string;
  gerente_nome: string | null;
  corretor_id: string;
  corretor_nome: string | null;
  leads: number;
  visitas: number;
  agil: number;
  negocio: number;
  vendas: number;
  vgv: number;
  off: number;
};

export type Numeros = Pick<LinhaDaDiretoria, "leads" | "visitas" | "agil" | "negocio" | "vendas" | "vgv" | "off">;
export type CorretorDaEquipe = Numeros & { id: string; nome: string };
export type EquipeDaDiretoria = { id: string; nome: string; gerente: string | null; corretores: CorretorDaEquipe[]; total: Numeros };
export type Diretoria = { id: string | null; nome: string; equipes: EquipeDaDiretoria[]; total: Numeros; corretores: number };

const untyped = supabase as unknown as SupabaseClient;

/** `mes` no formato do banco (`AAAA-MM-01`); `null` = mês vigente da operação. */
export async function carregarEquipesPorDiretoria(mes: string | null): Promise<LinhaDaDiretoria[]> {
  const { data, error } = await untyped.rpc("equipes_por_diretoria", { p_mes: mes });
  if (error) throw dbError("equipes_por_diretoria", error);
  // `numeric` chega como texto do PostgREST: a fronteira converte.
  return ((data ?? []) as Record<string, unknown>[]).map((linha) => ({
    ...(linha as unknown as LinhaDaDiretoria),
    leads: Number(linha.leads ?? 0),
    visitas: Number(linha.visitas ?? 0),
    agil: Number(linha.agil ?? 0),
    negocio: Number(linha.negocio ?? 0),
    vendas: Number(linha.vendas ?? 0),
    vgv: Number(linha.vgv ?? 0),
    off: Number(linha.off ?? 0),
  }));
}

const ZERO: Numeros = { leads: 0, visitas: 0, agil: 0, negocio: 0, vendas: 0, vgv: 0, off: 0 };
const somar = (a: Numeros, b: Numeros): Numeros => ({
  leads: a.leads + b.leads, visitas: a.visitas + b.visitas, agil: a.agil + b.agil,
  negocio: a.negocio + b.negocio, vendas: a.vendas + b.vendas, vgv: a.vgv + b.vgv, off: a.off + b.off,
});

/** Ordem da tabela: quem vende mais primeiro; empate pelo VGV, pela Ágil e pelo nome. */
const porDesempenho = (a: CorretorDaEquipe, b: CorretorDaEquipe) =>
  b.vendas - a.vendas || b.vgv - a.vgv || b.agil - a.agil || a.nome.localeCompare(b.nome, "pt-BR");

/**
 * Diretoria → equipes → corretores, com o total de cada nível. Diretorias e
 * equipes em ordem alfabética; "Sem diretoria" por último.
 */
export function agruparPorDiretoria(linhas: LinhaDaDiretoria[]): Diretoria[] {
  const diretorias = new Map<string, { id: string | null; nome: string; equipes: Map<string, EquipeDaDiretoria> }>();
  for (const l of linhas) {
    const chave = l.diretor_id ?? "sem";
    const dir = diretorias.get(chave) ?? { id: l.diretor_id, nome: l.diretor_nome, equipes: new Map() };
    const equipe = dir.equipes.get(l.equipe_id)
      ?? { id: l.equipe_id, nome: l.equipe_nome, gerente: l.gerente_nome, corretores: [], total: ZERO };
    const numeros: Numeros = { leads: l.leads, visitas: l.visitas, agil: l.agil, negocio: l.negocio, vendas: l.vendas, vgv: l.vgv, off: l.off };
    equipe.corretores.push({ id: l.corretor_id, nome: l.corretor_nome ?? "—", ...numeros });
    equipe.total = somar(equipe.total, numeros);
    dir.equipes.set(l.equipe_id, equipe);
    diretorias.set(chave, dir);
  }
  return [...diretorias.values()]
    .map((dir) => {
      const equipes = [...dir.equipes.values()]
        .map((e) => ({ ...e, corretores: [...e.corretores].sort(porDesempenho) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      return {
        id: dir.id,
        nome: dir.nome,
        equipes,
        total: equipes.reduce((t, e) => somar(t, e.total), ZERO),
        corretores: new Set(equipes.flatMap((e) => e.corretores.map((c) => c.id))).size,
      };
    })
    .sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
}
