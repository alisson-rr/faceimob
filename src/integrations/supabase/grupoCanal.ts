import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/** De onde o grupo recebe leads (0260). */
export type CanalDoGrupo = "formulario" | "whatsapp";
export const CANAIS_DO_GRUPO: Array<{ valor: CanalDoGrupo; rotulo: string }> = [
  { valor: "formulario", rotulo: "Formulário" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
];

export type OpcoesDoGrupo = {
  id: string;
  channels: CanalDoGrupo[];
  deliver_without_checkin: boolean;
};

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/*
 * `distribution_groups.channels` e `.deliver_without_checkin` nasceram na 0260,
 * depois do último `supabase gen types`: a forma vem declarada aqui até a
 * próxima geração do `types.ts`, que não se edita à mão.
 */
const db = supabase as unknown as {
  from(tabela: "distribution_groups"): {
    select(colunas: "id,channels,deliver_without_checkin"): Resultado<Array<{ id: string; channels: string[] | null; deliver_without_checkin: boolean | null }>>;
    update(linha: Partial<Omit<OpcoesDoGrupo, "id">>): {
      eq(coluna: "id", valor: string): { select(colunas: "id"): Resultado<Array<{ id: string }>> };
    };
  };
};

const ehCanal = (valor: string): valor is CanalDoGrupo => valor === "formulario" || valor === "whatsapp";

/** Opções de cada grupo por id. Antes da 0260 (coluna ausente) vale o padrão: os dois canais, com check-in. */
export async function listOpcoesDosGrupos(): Promise<Map<string, OpcoesDoGrupo>> {
  const { data, error } = await db.from("distribution_groups").select("id,channels,deliver_without_checkin");
  if (error) throw dbError("distribution_groups", error);
  return new Map((data ?? []).map((row) => [row.id, {
    id: row.id,
    channels: (row.channels ?? ["formulario", "whatsapp"]).filter(ehCanal),
    deliver_without_checkin: row.deliver_without_checkin ?? false,
  }]));
}

export async function salvarOpcoesDoGrupo(id: string, opcoes: Partial<Omit<OpcoesDoGrupo, "id">>): Promise<void> {
  if (opcoes.channels && opcoes.channels.length === 0) throw new Error("Escolha ao menos um canal: formulário ou WhatsApp.");
  const { data, error } = await db.from("distribution_groups").update(opcoes).eq("id", id).select("id");
  if (error) throw dbError("distribution_groups", error);
  if (!data?.length) throw new Error("Sem permissão para alterar este grupo.");
}
