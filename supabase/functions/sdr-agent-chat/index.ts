// SDR Agent Chat — playground interno de conversa com o agente.
// A lógica do turno (histórico, OpenAI, persistência, tag de qualificação) é a
// mesma do webhook de WhatsApp: vive em ../_shared/sdrAgent.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runSdrAgentTurn } from '../_shared/sdrAgent.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const { conversation_id, lead_id, agent_id, message } = body ?? {};
    if (typeof message !== 'string' || !message.trim()) {
      return new Response(JSON.stringify({ error: 'message obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (message.length > 4000) {
      return new Response(JSON.stringify({ error: 'mensagem longa demais (máx. 4000)' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const turn = await runSdrAgentTurn(supabase, {
      conversationId: conversation_id ?? null,
      leadId: lead_id ?? null,
      agentId: agent_id ?? null,
      message: message.trim(),
    });

    return new Response(JSON.stringify({
      conversation_id: turn.conversationId,
      agent: turn.agent,
      handoff_to: turn.handoffAgent,
      qualified: turn.qualified,
      reply: turn.reply,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('sdr-agent-chat error:', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
