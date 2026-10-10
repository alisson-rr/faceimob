import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";
import { functionErrorMessage } from "@/lib/functionError";

type Resultado<T> = PromiseLike<{ data: T | null; error: { message?: string; code?: string } | null }>;

/*
 * `sdr_agents.brief` e `.collect_fields` nasceram na 0261, depois do último
 * `supabase gen types`: a forma vem declarada aqui até a próxima geração do
 * `types.ts`, que não se edita à mão.
 */
const db = supabase as unknown as {
  from(tabela: "sdr_agents"): {
    update(linha: { brief: string | null; collect_fields: string[] }): {
      eq(coluna: "id", valor: string): { select(colunas: "id"): Resultado<Array<{ id: string }>> };
    };
  };
};

/** "Uma resposta por linha" da tela → lista limpa, sem repetição, até 30. */
export function camposDoTexto(texto: string): string[] {
  const vistos = new Set<string>();
  return texto.split("\n")
    .map((linha) => linha.replace(/^[-*•\d.)\s]+/, "").replace(/[[\]|:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60))
    .filter((campo) => {
      const chave = campo.toLowerCase();
      if (!campo || vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    })
    .slice(0, 30);
}

export async function salvarResumoDoAgente(id: string, brief: string | null, campos: string[]): Promise<void> {
  const { data, error } = await db.from("sdr_agents")
    .update({ brief: brief?.trim() || null, collect_fields: campos }).eq("id", id).select("id");
  if (error) throw dbError("sdr_agents", error);
  if (!data?.length) throw new Error("Sem permissão para alterar o agente.");
}

/** A IA escreve o prompt a partir do resumo; nada é salvo aqui. */
export async function gerarPromptDoAgente(nome: string, resumo: string, campos: string[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ prompt?: string }>("sdr-agent-chat", {
    body: { action: "gerar_prompt", nome, resumo, campos },
  });
  if (error) throw new Error(await functionErrorMessage(error, "A IA não conseguiu gerar o prompt."));
  if (!data?.prompt) throw new Error("A IA não devolveu o prompt. Tente de novo.");
  return data.prompt;
}

/** O que o SDR IA apurou do lead: a conversa mais recente com nota, resumo ou respostas. */
export type RespostasDoSdr = {
  agente: string | null;
  score: number | null;
  resumo: string | null;
  respostas: Array<[string, string]>;
};

export async function respostasDoSdr(leadId: string): Promise<RespostasDoSdr | null> {
  const { data, error } = await supabase
    .from("sdr_conversations")
    .select("score, summary, collected, started_at, sdr_agents(name)")
    .eq("lead_id", leadId)
    .order("started_at", { ascending: false })
    .limit(5);
  if (error) throw dbError("sdr_conversations", error);
  for (const conversa of data ?? []) {
    const coletado = conversa.collected && typeof conversa.collected === "object" && !Array.isArray(conversa.collected)
      ? Object.entries(conversa.collected)
          .filter((par): par is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof par[1]))
          .map(([campo, valor]): [string, string] => [campo, String(valor)])
      : [];
    if (conversa.score === null && !conversa.summary && coletado.length === 0) continue;
    return {
      agente: conversa.sdr_agents?.name ?? null,
      score: conversa.score,
      resumo: conversa.summary,
      respostas: coletado,
    };
  }
  return null;
}
