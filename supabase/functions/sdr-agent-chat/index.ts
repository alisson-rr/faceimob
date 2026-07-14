// SDR Agent Chat - roteia mensagem para agente (com orquestrador opcional) usando OpenAI
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function callOpenAI(apiKey: string, model: string, messages: any[], temperature = 0.7) {
  const r = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, temperature }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI ${r.status}`);
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: data.usage,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json();
    const { conversation_id, lead_id, contact_id, agent_id, message, channel } = body;
    if (!message) throw new Error('message obrigatório');

    // Ensure conversation
    let convId = conversation_id;
    if (!convId) {
      const { data: created, error: cErr } = await supabase
        .from('sdr_conversations')
        .insert({ lead_id, contact_id, agent_id, channel: channel || 'test' })
        .select('id, agent_id')
        .single();
      if (cErr) throw cErr;
      convId = created.id;
    }

    // Load conversation + agent
    const { data: conv } = await supabase
      .from('sdr_conversations').select('*').eq('id', convId).single();

    // Pick agent: explicit → orchestrator → default active
    let chosenAgentId = agent_id || conv?.agent_id;
    if (!chosenAgentId) {
      const { data: orch } = await supabase
        .from('sdr_agents')
        .select('id')
        .eq('is_orchestrator', true).eq('active', true).limit(1).maybeSingle();
      chosenAgentId = orch?.id;
    }
    if (!chosenAgentId) {
      const { data: any1 } = await supabase
        .from('sdr_agents').select('id').eq('active', true).limit(1).maybeSingle();
      chosenAgentId = any1?.id;
    }
    if (!chosenAgentId) throw new Error('Nenhum agente SDR configurado');

    const { data: agent } = await supabase
      .from('sdr_agents').select('*').eq('id', chosenAgentId).single();

    // Save inbound
    await supabase.from('sdr_messages').insert({
      conversation_id: convId, role: 'user', content: message,
    });

    // Build history
    const { data: history } = await supabase
      .from('sdr_messages').select('role, content')
      .eq('conversation_id', convId).order('created_at', { ascending: true });

    const messages: any[] = [
      { role: 'system', content: agent.system_prompt || 'Você é um SDR especializado em qualificação de leads imobiliários. Faça perguntas objetivas sobre renda, urgência, tipo de imóvel desejado e localização. Seja cordial e breve.' },
      ...(history || []).map((m: any) => ({ role: m.role, content: m.content })),
    ];

    const { text, usage } = await callOpenAI(apiKey, agent.model || 'gpt-4o-mini', messages, Number(agent.temperature ?? 0.7));

    // If orchestrator, try to detect handoff target agent (naive: mentions "@AgentName")
    let handoffAgent: any = null;
    if (agent.is_orchestrator) {
      const { data: agents } = await supabase.from('sdr_agents').select('id,name').eq('active', true).eq('is_orchestrator', false);
      handoffAgent = (agents || []).find((a: any) => text.toLowerCase().includes('@' + a.name.toLowerCase()));
      if (handoffAgent) {
        await supabase.from('sdr_conversations').update({ agent_id: handoffAgent.id }).eq('id', convId);
      }
    }

    await supabase.from('sdr_messages').insert({
      conversation_id: convId, role: 'assistant', content: text,
      agent_id: chosenAgentId,
      tokens_in: usage?.prompt_tokens, tokens_out: usage?.completion_tokens,
    });

    return new Response(JSON.stringify({
      conversation_id: convId,
      agent: { id: agent.id, name: agent.name, is_orchestrator: agent.is_orchestrator },
      handoff_to: handoffAgent,
      reply: text,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('sdr-agent-chat error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
