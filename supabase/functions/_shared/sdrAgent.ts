import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSecret } from "./secrets.ts";

/**
 * Um turno do agente de SDR: grava a mensagem do lead, consulta o modelo com o
 * histórico e grava a resposta. Compartilhado pelo playground (`sdr-agent-chat`)
 * e pelo webhook de mensagens do WhatsApp (`whatsapp-inbound-webhook`) — a
 * qualificação da ata 14/07 é a MESMA lógica nos dois canais.
 *
 * Qualificação: o prompt instrui o modelo a encerrar com a tag [QUALIFICADO]
 * quando tiver coletado o suficiente. O chamador decide o que fazer (o webhook
 * chama `sdr_handoff`, o playground só exibe).
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const QUALIFY_INSTRUCTION =
  "\n\nQuando você concluir a qualificação do lead (interesse, renda aproximada e urgência coletados), " +
  "termine a sua resposta com a tag [QUALIFICADO] numa linha própria. " +
  "Se o lead demonstrar claramente que não tem interesse, termine com a tag [DESQUALIFICADO].";

async function callOpenAI(apiKey: string, model: string, messages: unknown[], temperature: number) {
  const r = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI ${r.status}`);
  return {
    text: (data.choices?.[0]?.message?.content ?? "") as string,
    usage: data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined,
  };
}

export type AgentTurnResult = {
  conversationId: string;
  reply: string;
  qualified: boolean;
  disqualified: boolean;
  agent: { id: string; name: string; is_orchestrator: boolean };
  handoffAgent: { id: string; name: string } | null;
};

export async function runSdrAgentTurn(
  supabase: SupabaseClient,
  input: {
    conversationId?: string | null;
    leadId?: string | null;
    agentId?: string | null;
    message: string;
    providerMessageId?: string | null;
  },
): Promise<AgentTurnResult> {
  const apiKey = await requireSecret("OPENAI_API_KEY");

  // Garante a conversa.
  let convId = input.conversationId ?? null;
  if (!convId && input.leadId) {
    const { data: created, error } = await supabase
      .from("sdr_conversations")
      .insert({ lead_id: input.leadId, agent_id: input.agentId ?? null })
      .select("id")
      .single();
    if (error) throw new Error(`sdr_conversations: ${error.message}`);
    convId = created.id;
  }
  if (!convId) throw new Error("conversation_id ou lead_id obrigatório");

  const { data: conv, error: convErr } = await supabase
    .from("sdr_conversations").select("*").eq("id", convId).single();
  if (convErr) throw new Error(`sdr_conversations: ${convErr.message}`);

  // Agente: explícito → o da conversa → orquestrador → qualquer ativo.
  let chosenAgentId = input.agentId || conv.agent_id;
  if (!chosenAgentId) {
    const { data: orch } = await supabase
      .from("sdr_agents").select("id")
      .eq("is_orchestrator", true).eq("active", true).limit(1).maybeSingle();
    chosenAgentId = orch?.id;
  }
  if (!chosenAgentId) {
    const { data: any1 } = await supabase
      .from("sdr_agents").select("id").eq("active", true).limit(1).maybeSingle();
    chosenAgentId = any1?.id;
  }
  if (!chosenAgentId) throw new Error("Nenhum agente SDR configurado");

  const { data: agent, error: agentErr } = await supabase
    .from("sdr_agents").select("*").eq("id", chosenAgentId).single();
  if (agentErr) throw new Error(`sdr_agents: ${agentErr.message}`);

  // Mensagem do lead. provider_message_id tem índice único: replay do webhook
  // não duplica (23505 = já processada).
  const { error: inErr } = await supabase.from("sdr_messages").insert({
    conversation_id: convId,
    author: "lead",
    body: input.message,
    provider_message_id: input.providerMessageId ?? null,
  });
  if (inErr) {
    if (inErr.code === "23505") {
      throw new DuplicateMessageError();
    }
    throw new Error(`sdr_messages: ${inErr.message}`);
  }

  const { data: history, error: histErr } = await supabase
    .from("sdr_messages").select("author, body")
    .eq("conversation_id", convId).order("created_at", { ascending: true });
  if (histErr) throw new Error(`sdr_messages: ${histErr.message}`);

  const systemPrompt =
    (agent.system_prompt ||
      "Você é um SDR especializado em qualificação de leads imobiliários. Faça perguntas objetivas sobre renda, urgência, tipo de imóvel desejado e localização. Seja cordial e breve.") +
    QUALIFY_INSTRUCTION;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(history || []).map((m) => ({
      role: m.author === "lead" ? "user" : m.author === "system" ? "system" : "assistant",
      content: m.body,
    })),
  ];

  const { text, usage } = await callOpenAI(
    apiKey, agent.model || "gpt-4o-mini", messages, Number(agent.temperature ?? 0.7),
  );

  const qualified = /\[QUALIFICADO\]/i.test(text);
  const disqualified = /\[DESQUALIFICADO\]/i.test(text);
  const reply = text.replace(/\[(DES)?QUALIFICADO\]/gi, "").trim();

  // Orquestrador pode delegar mencionando @NomeDoAgente.
  let handoffAgent: { id: string; name: string } | null = null;
  if (agent.is_orchestrator) {
    const { data: agents } = await supabase
      .from("sdr_agents").select("id,name").eq("active", true).eq("is_orchestrator", false);
    handoffAgent = (agents || []).find((a) =>
      text.toLowerCase().includes("@" + a.name.toLowerCase())) ?? null;
    if (handoffAgent) {
      const { error } = await supabase
        .from("sdr_conversations").update({ agent_id: handoffAgent.id }).eq("id", convId);
      if (error) console.error(`sdrAgent: falha ao delegar conversa ${convId}`);
    }
  }

  const { error: outErr } = await supabase.from("sdr_messages").insert({
    conversation_id: convId,
    author: "agent",
    body: reply,
    tokens_in: usage?.prompt_tokens,
    tokens_out: usage?.completion_tokens,
  });
  if (outErr) throw new Error(`sdr_messages(agent): ${outErr.message}`);

  if (disqualified) {
    const { error } = await supabase
      .from("sdr_conversations")
      .update({ status: "disqualified" })
      .eq("id", convId)
      .eq("status", "active");
    if (error) console.error(`sdrAgent: falha ao desqualificar conversa ${convId}`);
  }

  return {
    conversationId: convId,
    reply,
    qualified,
    disqualified,
    agent: { id: agent.id, name: agent.name, is_orchestrator: agent.is_orchestrator },
    handoffAgent,
  };
}

/** Replay de webhook: a mensagem já foi processada antes. */
export class DuplicateMessageError extends Error {
  constructor() {
    super("mensagem já processada");
    this.name = "DuplicateMessageError";
  }
}
