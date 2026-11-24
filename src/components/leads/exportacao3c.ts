import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { periodoDoMes } from "./listaDeLigacao";

/**
 * Exportação 3C (0360): o mailing que a 3C sobe no agente de voz, com as
 * colunas exatas que ela pede — identificador (em branco), telefone (DDD +
 * número), nome e lead_id. O `lead_id` é o que deixa a 3C registrar a ligação
 * no lead certo. Quem entra e o formato do telefone são decididos no banco.
 */
export type Linha3c = { leadId: string; nome: string; telefone: string };

export const CABECALHO_3C = ["identificador", "telefone", "nome", "lead_id"] as const;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Linhas da RPC validadas na fronteira; sem lead_id ou telefone não serve à 3C. */
export function lerLinhas3c(data: unknown): Linha3c[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const leadId = typeof r.lead_id === "string" ? r.lead_id : "";
    const telefone = typeof r.telefone === "string" ? r.telefone.replace(/\D/g, "") : "";
    const nome = typeof r.nome === "string" ? r.nome.trim() : "";
    if (!uuid.test(leadId) || !/^\d{10,11}$/.test(telefone)) return [];
    return [{ leadId, nome, telefone }];
  });
}

/** Campo de CSV: aspas quando precisa, e sem virar fórmula se abrirem no Excel. */
export function campoCsv(valor: string): string {
  let v = valor.replace(/[\r\n]+/g, " ");
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  return /[",;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function montarCsv3c(linhas: Linha3c[]): string {
  const corpo = linhas.map((l) => ["", l.telefone, l.nome, l.leadId].map(campoCsv).join(","));
  return [CABECALHO_3C.join(","), ...corpo].join("\r\n") + "\r\n";
}

/** "2026-01" e "2026-06" → de 01/01 até o fim de junho. */
export function periodoDe(deMes: string, ateMes: string): { inicio: string; fim: string } | null {
  const de = periodoDoMes(deMes);
  const ate = periodoDoMes(ateMes);
  if (!de || !ate || ate.fim <= de.inicio) return null;
  return { inicio: de.inicio, fim: ate.fim };
}

// RPC da 0360, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

export async function buscarExportacao3c(deMes: string, ateMes: string): Promise<Linha3c[]> {
  const periodo = periodoDe(deMes, ateMes);
  if (!periodo) throw new Error("Escolha um período válido: o mês final não pode vir antes do inicial.");
  const { data, error } = await untyped.rpc("exportacao_3c", { p_inicio: periodo.inicio, p_fim: periodo.fim });
  if (error) throw dbError("exportacao_3c", error);
  return lerLinhas3c(data);
}

export function baixarCsv3c(linhas: Linha3c[], deMes: string, ateMes: string): void {
  const url = URL.createObjectURL(new Blob([montarCsv3c(linhas)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `3c_${deMes}_a_${ateMes}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
