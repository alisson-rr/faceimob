// SDR Agent Chat — playground interno de conversa com o agente.
// A lógica do turno (histórico, OpenAI, persistência, tag de qualificação) é a
// mesma do webhook de WhatsApp: vive em ../_shared/sdrAgent.ts.
import { runSdrAgentTurn } from '../_shared/sdrAgent.ts';
import { requireUserPermission, serviceClient } from '../_shared/auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Antes de qualquer coisa: quem está falando. A function roda com service
    // role e gasta a chave da OpenAI a cada turno — sem esta porta, a chave
    // publicável do bundle bastava para queimar crédito e ler conversa de lead
    // (achado S01). `menu.sdr` é a mesma permissão que abre a tela do SDR.
    const { denied } = await requireUserPermission(req, 'menu.sdr', corsHeaders);
    if (denied) return denied;

    const supabase = serviceClient();

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
