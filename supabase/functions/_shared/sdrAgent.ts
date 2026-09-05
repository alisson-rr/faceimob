import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireSecret } from "./secrets.ts";

/**
 * Um turno do agente de SDR: consulta o modelo com o histórico e grava a
 * conversa. Compartilhado pelo playground (`sdr-agent-chat`) e pelo webhook de
 * mensagens do WhatsApp (`whatsapp-inbound-webhook`) — a qualificação da ata
 * 14/07 é a MESMA lógica nos dois canais.
 *
 * Três garantias que este arquivo passou a dar (auditoria de 02/09/2026):
 *
 *  1. **Nada é gravado antes de o modelo responder.** A mensagem do lead era
 *     inserida ANTES da chamada à OpenAI; uma falha passageira do modelo
 *     deixava a linha gravada, o replay da Meta batia no índice único de
 *     `provider_message_id`, virava `DuplicateMessageError` e o webhook dava
 *     ACK 200 — o lead ficava permanentemente sem resposta e sem retentativa.
 *     Agora a idempotência é checada por consulta ANTES (nem gasta o modelo) e
 *     as duas mensagens só são gravadas depois que a resposta existe — num
 *     INSERT único, para que uma falha na segunda linha não deixe a primeira
 *     commitada e recrie o mesmo beco sem saída.
 *
 *  2. **Teto de turnos.** `sdr_agents.max_turns` existia e ninguém lia: uma
 *     conversa que nunca emitisse a tag rodava sem limite. Ao atingir o teto o
 *     agente para de responder e o lead volta para a roleta com motivo
 *     `exhausted` — que NÃO carimba o funil como qualificado (migration 0064).
 *
 *  3. **Delegação por regra, não por texto.** A delegação por `@NomeDoAgente`
 *     saiu: dependia de o modelo escrever um nome exato, casava por substring
 *     (dois agentes com nome em prefixo casavam os dois) e falhava em silêncio.
 *     Sobra `handoff_to_agent_id`, configurado na aba Agentes, sem ciclo
 *     (trigger da 0064).
 *
 * Qualificação: o prompt instrui o modelo a encerrar com [QUALIFICADO] e a
 * pontuar a conversa. O chamador decide o que fazer com o desfecho.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/**
 * Modelo usado quando o agente não tem um gravado. É o mesmo default da coluna
 * `sdr_agents.model` (migration 0040) e a primeira opção do seletor da tela:
 * o banco nascia com 'claude-sonnet-5', nome que a OpenAI não conhece, e toda
 * resposta da IA morria em erro. Mudou aqui, muda lá.
 */
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/** Teto de segurança quando o agente não tem `max_turns` (coluna tem default 12). */
const FALLBACK_MAX_TURNS = 12;

const QUALIFY_INSTRUCTION =
  "\n\nQuando você concluir a qualificação do lead (interesse, renda aproximada e urgência coletados), " +
  "termine a sua resposta com a tag [QUALIFICADO] numa linha própria. " +
  "Se o lead demonstrar claramente que não tem interesse, termine com a tag [DESQUALIFICADO]." +
  "\n\nEm TODA resposta, acrescente também, em linhas próprias e ao final:" +
  "\n[SCORE:n] — n de 0 a 100, o quanto este lead está pronto para comprar." +
  "\n[RESUMO: uma frase com o que você já apurou (renda, região, prazo, tipo de imóvel).]" +
  "\nEssas tags são removidas antes de a mensagem chegar ao lead — não as comente.";

/** Mensagem que o lead recebe quando o agente atinge o teto de turnos. */
const EXHAUSTED_REPLY =
  "Obrigado pelas informações! Vou passar seu atendimento para um consultor da equipe, " +
  "que continua a conversa com você por aqui.";

/**
 * Grava em `sdr_messages` mesmo se o banco AINDA não tiver a coluna `agent_id`.
 *
 * A coluna nasce na migration 0082, e function e migration sobem por caminhos
 * diferentes: se o deploy chegar antes, o PostgREST recusa o lote inteiro com
 * `PGRST204` ("column not found in schema cache"). O estrago não seria
 * degradado — a recusa acontece DEPOIS da chamada à OpenAI, então o turno é
 * cobrado, o lead fica sem resposta e, como nada foi gravado, a checagem de
 * idempotência não vê a mensagem e o replay da Meta reprocessa e cobra de novo.
 *
 * O PostgREST barra a tentativa antes do banco: nada é escrito, então repetir
 * sem a chave é seguro. E `agent_id` tem de estar nos DOIS objetos do lote ou
 * em nenhum — lote heterogêneo é recusado com PGRST102 ("All object keys must
 * match"); por isso a chave é removida de todas as linhas, não só de uma.
 */
async function insertMessages(supabase: SupabaseClient, rows: Record<string, unknown>[]) {
  const { error } = await supabase.from("sdr_messages").insert(rows);
  if (error?.code !== "PGRST204") return error;
  console.warn(
    "sdrAgent: banco sem sdr_messages.agent_id (migration 0082 não aplicada) — " +
      "o turno é gravado sem a autoria do agente.",
  );
  const { error: semAgente } = await supabase
    .from("sdr_messages")
    .insert(rows.map(({ agent_id: _ignorado, ...resto }) => resto));
  return semAgente;
}

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

/** Tags de controle que o agente escreve e o lead nunca pode ler. */
const TAGS = /\[(DES)?QUALIFICADO\]|\[SCORE:[^\]]*\]|\[RESUMO:[^\]]*\]/gi;

function parseTags(text: string) {
  const score = /\[SCORE:\s*(\d{1,3})\s*\]/i.exec(text);
  const summary = /\[RESUMO:\s*([^\]]{1,600})\]/i.exec(text);
  return {
    qualified: /\[QUALIFICADO\]/i.test(text),
    disqualified: /\[DESQUALIFICADO\]/i.test(text),
    // O CHECK da coluna recusa fora de 0-100 e derrubaria o turno inteiro.
    score: score ? Math.min(100, Math.max(0, Number(score[1]))) : null,
    summary: summary ? summary[1].trim() : null,
    reply: text.replace(TAGS, "").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

export type AgentTurnResult = {
  conversationId: string;
  reply: string;
  qualified: boolean;
  disqualified: boolean;
  /** Teto de `max_turns` atingido: o lead já foi devolvido à roleta por aqui. */
  exhausted: boolean;
  score: number | null;
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
    /**
     * Ao atingir o teto de turnos, devolve o lead à roleta (`sdr_handoff`).
     * O playground passa `false`: o lead de teste é `discarded` e mandá-lo para
     * a fila colocaria uma simulação na mão de um corretor de verdade.
     */
    handoffOnExhaust?: boolean;
  },
): Promise<AgentTurnResult> {
  const apiKey = await requireSecret("OPENAI_API_KEY");

  // Replay do webhook: a mensagem já foi processada. Checar ANTES de qualquer
  // gravação e antes de gastar o modelo — o índice único continua sendo a
  // garantia final contra duas entregas simultâneas.
  if (input.providerMessageId) {
    const { data: seen, error } = await supabase
      .from("sdr_messages").select("id")
      .eq("provider_message_id", input.providerMessageId).maybeSingle();
    if (error) throw new Error(`sdr_messages: ${error.message}`);
    if (seen) throw new DuplicateMessageError();
  }

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

  // Conversa assumida por humano ou já encerrada: o robô não fala por cima.
  if (conv.status !== "active") throw new ConversationClosedError(conv.status);

  // Agente: explícito → o da conversa → orquestrador → qualquer ativo.
  // O explícito precisa estar ATIVO: o seletor do playground mandava id de
  // agente desligado e o switch "Ativo" da aba Agentes não valia nada aqui.
  let chosenAgentId: string | null = null;
  if (input.agentId) {
    const { data: picked } = await supabase
      .from("sdr_agents").select("id").eq("id", input.agentId).eq("active", true).maybeSingle();
    if (!picked) throw new Error("Agente escolhido não existe ou está inativo.");
    chosenAgentId = picked.id;
  }
  chosenAgentId ??= conv.agent_id;
  if (!chosenAgentId) {
    const { data: orch } = await supabase
      .from("sdr_agents").select("id")
      .eq("is_orchestrator", true).eq("active", true).limit(1).maybeSingle();
    chosenAgentId = orch?.id ?? null;
  }
  if (!chosenAgentId) {
    const { data: any1 } = await supabase
      .from("sdr_agents").select("id").eq("active", true).limit(1).maybeSingle();
    chosenAgentId = any1?.id ?? null;
  }
  if (!chosenAgentId) throw new Error("Nenhum agente SDR configurado");

  const { data: agent, error: agentErr } = await supabase
    .from("sdr_agents").select("*").eq("id", chosenAgentId).single();
  if (agentErr) throw new Error(`sdr_agents: ${agentErr.message}`);

  const { data: history, error: histErr } = await supabase
    .from("sdr_messages").select("author, body")
    .eq("conversation_id", convId).order("created_at", { ascending: true });
  if (histErr) throw new Error(`sdr_messages: ${histErr.message}`);

  const past = history || [];
  const turnsUsed = past.filter((m) => m.author === "agent").length;
  const maxTurns = Number(agent.max_turns ?? FALLBACK_MAX_TURNS) || FALLBACK_MAX_TURNS;

  // Teto atingido: guarda a mensagem do lead (é conteúdo real dele), avisa que
  // a conversa vai para um humano e devolve o lead à roleta.
  if (turnsUsed >= maxTurns) {
    // As duas linhas com as MESMAS chaves: o PostgREST recusa lote heterogêneo
    // ("All object keys must match"). `insertMessages` cuida do banco que ainda
    // não tem a coluna `agent_id` (0082).
    const teto = await insertMessages(supabase, [
      {
        conversation_id: convId,
        author: "lead",
        body: input.message,
        provider_message_id: input.providerMessageId ?? null,
        agent_id: null,
      },
      {
        conversation_id: convId,
        author: "system",
        body: `[teto de ${maxTurns} respostas atingido] ${EXHAUSTED_REPLY}`,
        provider_message_id: null,
        agent_id: agent.id,
      },
    ]);
    if (teto) {
      if (teto.code === "23505") throw new DuplicateMessageError();
      throw new Error(`sdr_messages(teto): ${teto.message}`);
    }
    if (input.handoffOnExhaust !== false) {
      const { error } = await supabase.rpc("sdr_handoff", {
        p_conversation_id: convId, p_reason: "exhausted",
      });
      if (error) console.error(`sdrAgent: handoff por esgotamento falhou — ${error.message}`);
    }
    return {
      conversationId: convId,
      reply: EXHAUSTED_REPLY,
      qualified: false,
      disqualified: false,
      exhausted: true,
      score: conv.score ?? null,
      agent: { id: agent.id, name: agent.name, is_orchestrator: agent.is_orchestrator },
      handoffAgent: null,
    };
  }

  const systemPrompt =
    (agent.system_prompt ||
      "Você é um SDR especializado em qualificação de leads imobiliários. Faça perguntas objetivas sobre renda, urgência, tipo de imóvel desejado e localização. Seja cordial e breve.") +
    QUALIFY_INSTRUCTION;

  const messages = [
    { role: "system", content: systemPrompt },
    ...past.map((m) => ({
      role: m.author === "lead" ? "user" : m.author === "system" ? "system" : "assistant",
      content: m.body,
    })),
    // A mensagem do turno entra só no payload; a gravação vem depois da
    // resposta, para que uma falha do modelo não deixe rastro sem retentativa.
    { role: "user", content: input.message },
  ];

  const { text, usage } = await callOpenAI(
    apiKey, agent.model || DEFAULT_OPENAI_MODEL, messages, Number(agent.temperature ?? 0.7),
  );

  const { qualified: qualifiedTag, disqualified, score, summary, reply } = parseTags(text);

  // Agora sim: a mensagem do lead e a resposta, NUM INSERT SÓ. Em duas
  // gravações separadas, uma falha na segunda deixava a linha do lead commitada
  // — o replay da Meta batia no índice único de `provider_message_id`, virava
  // `DuplicateMessageError`, o webhook dava ACK 200 e a conversa ficava para
  // sempre sem resposta e sem retentativa. Ou entram as duas, ou não entra
  // nenhuma e o replay reprocessa. As chaves têm de ser IDÊNTICAS nos dois
  // objetos: o PostgREST recusa lote heterogêneo ("All object keys must match").
  const inErr = await insertMessages(supabase, [
    {
      conversation_id: convId,
      author: "lead",
      body: input.message,
      provider_message_id: input.providerMessageId ?? null,
      tokens_in: null,
      tokens_out: null,
      agent_id: null,
    },
    {
      conversation_id: convId,
      author: "agent",
      body: reply,
      provider_message_id: null,
      tokens_in: usage?.prompt_tokens ?? null,
      tokens_out: usage?.completion_tokens ?? null,
      // Quem respondeu ESTE turno. `sdr_conversations.agent_id` é sobrescrito
      // no handoff e passa a apontar só para o último da cadeia; sem gravar
      // aqui (coluna da 0082), a passagem pelo orquestrador some do histórico
      // e a aba Conversas não tem como mostrar por onde o lead andou.
      agent_id: agent.id,
    },
  ]);
  if (inErr) {
    if (inErr.code === "23505") throw new DuplicateMessageError();
    throw new Error(`sdr_messages: ${inErr.message}`);
  }

  // Delegação: só a regra fixa da tela. A conversa CONTINUA com o agente alvo,
  // então o turno não conta como qualificado — quem devolve o lead à roleta é o
  // último agente da cadeia.
  let handoffAgent: { id: string; name: string } | null = null;
  if (qualifiedTag && !disqualified && agent.handoff_to_agent_id) {
    const { data: target } = await supabase
      .from("sdr_agents").select("id,name")
      .eq("id", agent.handoff_to_agent_id).eq("active", true).maybeSingle();
    handoffAgent = target ?? null;
  }

  // Score, resumo e destino num UPDATE só: cada turno atualiza o que a aba
  // Conversas mostra (antes o badge de score era sempre "—" fora da semente).
  const patch: Record<string, unknown> = {};
  if (score !== null) patch.score = score;
  if (summary) patch.summary = summary;
  if (handoffAgent) patch.agent_id = handoffAgent.id;
  if (disqualified) patch.status = "disqualified";
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase
      .from("sdr_conversations").update(patch).eq("id", convId).eq("status", "active");
    if (error) console.error(`sdrAgent: falha ao atualizar conversa ${convId} — ${error.message}`);
  }

  return {
    conversationId: convId,
    reply,
    qualified: qualifiedTag && !handoffAgent,
    disqualified,
    exhausted: false,
    score,
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

/** A conversa não está mais com o robô (assumida por humano ou encerrada). */
export class ConversationClosedError extends Error {
  constructor(public readonly status: string) {
    super(
      status === "human"
        ? "Esta conversa foi assumida por um operador — o robô não responde mais nela."
        : `Esta conversa está ${status} e não aceita novas respostas do agente.`,
    );
    this.name = "ConversationClosedError";
  }
}
