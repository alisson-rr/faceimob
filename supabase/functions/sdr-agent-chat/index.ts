// SDR Agent Chat — playground interno de conversa com o agente.
// A lógica do turno (histórico, OpenAI, persistência, tag de qualificação) é a
// mesma do webhook de WhatsApp: vive em ../_shared/sdrAgent.ts.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ConversationClosedError, runSdrAgentTurn } from '../_shared/sdrAgent.ts';
import { requireUserPermission, serviceClient } from '../_shared/auth.ts';
import { getSecret } from '../_shared/secrets.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Marca do lead de teste em `leads.utm_source`. A tela de leads pode filtrá-lo por aqui. */
const PLAYGROUND_SOURCE = 'sdr_playground';

/**
 * Papéis que a RLS deixa escrever em `sdr_conversations`/`sdr_messages`
 * (policies `sdr_conversations_write` da 0008). O playground GRAVA conversa:
 * liberá-lo para todo mundo com `menu.sdr` fazia director/manager/partner
 * escreverem pela function o que o banco recusa no acesso direto — e depois não
 * conseguirem reler a própria simulação na aba Conversas. Além disso, cada
 * turno gasta crédito da OpenAI.
 */
const WRITE_ROLES = ['admin', 'marketing', 'sdr'];

/**
 * O Playground não escolhe lead e `sdr_conversations.lead_id` é NOT NULL, então
 * toda simulação pendura num lead de teste. Ele é POR USUÁRIO: com um lead
 * compartilhado, duas pessoas simulando ao mesmo tempo escreviam no mesmo lead
 * e uma via a conversa da outra. Nasce 'discarded': fora do
 * `assign_queued_leads` (só varre 'queued') e das listas ativas — nunca cai na
 * roleta de um corretor.
 */
async function playgroundLeadId(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data: found, error: findErr } = await supabase
    .from('leads').select('id')
    .eq('utm_source', PLAYGROUND_SOURCE)
    .eq('raw_payload->>playground_user', userId)
    .limit(1).maybeSingle();
  if (findErr) throw new Error(`leads: ${findErr.message}`);
  if (found) return found.id;

  // ponytail: duas primeiras mensagens simultâneas do mesmo usuário podem criar
  // dois leads de teste; é inofensivo, e o lookup acima passa a achar o primeiro.
  const { data: created, error } = await supabase
    .from('leads')
    .insert({
      full_name: 'Lead de teste do Playground SDR',
      utm_source: PLAYGROUND_SOURCE,
      status: 'discarded',
      notes: 'Criado automaticamente pelo Playground do SDR IA. Não é um lead real.',
      raw_payload: { playground_user: userId },
    })
    .select('id')
    .single();
  if (error) throw new Error(`leads: ${error.message}`);
  return created.id;
}

/**
 * "Testar chave da OpenAI": uma chamada barata a /v1/models só para saber se a
 * credencial gravada no cofre é aceita. Sem isso, o primeiro sinal de chave
 * errada era um turno de conversa falhando com erro de terceiro.
 * Nunca devolve o valor da chave — só o veredito.
 */
async function probeOpenAI(apiKey: string) {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const models = Array.isArray(data?.data) ? data.data.length : 0;
    return json({ ok: true, models });
  }
  const body = await res.json().catch(() => ({}));
  return json({
    ok: false,
    status: res.status,
    error: res.status === 401
      ? 'A OpenAI recusou a chave gravada (401). Gere outra e substitua em Admin · Integrações.'
      : `A OpenAI respondeu ${res.status}: ${String(body?.error?.message ?? '').slice(0, 200)}`,
  }, 502);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Antes de qualquer coisa: quem está falando. A function roda com service
    // role e gasta a chave da OpenAI a cada turno — sem esta porta, a chave
    // publicável do bundle bastava para queimar crédito e ler conversa de lead
    // (achado S01). `menu.sdr` é a mesma permissão que abre a tela do SDR.
    const { denied, userId } = await requireUserPermission(req, 'menu.sdr', corsHeaders);
    if (denied) return denied;

    const supabase = serviceClient();

    const body = await req.json().catch(() => ({}));
    const { action, conversation_id, lead_id, agent_id, message } = body ?? {};

    // Existe credencial da OpenAI? Só o veredito booleano, nunca o valor — e
    // ANTES da porta de papel, de propósito: director/manager/partner abrem o
    // módulo e precisam saber que a IA não responde. Sem este sinal a tela só
    // descobria a falta depois de o operador digitar e enviar, e até lá o
    // switch "Ativo" da aba Agentes fazia parecer que o agente estava
    // trabalhando. Não chama a OpenAI (isso é o `probe`), então é barato o
    // bastante para rodar na abertura da tela.
    if (action === 'status') {
      return json({ configured: !!(await getSecret('OPENAI_API_KEY')) });
    }

    // Segunda porta: gravar conversa é dos papéis que a RLS aceita.
    const { data: roles, error: rolesErr } = await supabase
      .from('user_roles').select('role').eq('profile_id', userId);
    if (rolesErr) {
      console.error('sdr-agent-chat: falha ao ler papéis —', rolesErr.message);
      return json({ error: 'Não foi possível verificar seu papel.' }, 500);
    }
    if (!(roles || []).some((r: { role: string }) => WRITE_ROLES.includes(r.role))) {
      return json({
        code: 'role_forbidden',
        error: 'A simulação grava conversa no banco: só admin, marketing e SDR podem usar o Playground. '
          + 'Seu papel consulta o módulo.',
      }, 403);
    }

    const apiKey = await getSecret('OPENAI_API_KEY');
    // Sem a chave da OpenAI nada responde. 503 com `code` distinto para a tela
    // dizer o que falta em vez de mostrar um erro genérico de servidor.
    if (!apiKey) {
      return json({
        code: 'missing_credential',
        error: 'A IA ainda não está configurada: falta a chave da OpenAI. '
          + 'Cadastre em Admin · Integrações (OpenAI · api_key) ou no secret OPENAI_API_KEY da function.',
      }, 503);
    }

    if (action === 'probe') return await probeOpenAI(apiKey);

    if (typeof message !== 'string' || !message.trim()) {
      return json({ error: 'message obrigatório' }, 400);
    }
    if (message.length > 4000) {
      return json({ error: 'mensagem longa demais (máx. 4000)' }, 400);
    }
    const asId = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const conversationId = asId(conversation_id);
    const leadId = conversationId ? null : (asId(lead_id) ?? await playgroundLeadId(supabase, userId));

    const turn = await runSdrAgentTurn(supabase, {
      conversationId,
      leadId,
      agentId: asId(agent_id),
      message: message.trim(),
      // Simulação não devolve lead à roleta: o lead de teste é 'discarded' e
      // mandá-lo para a fila colocaria uma conversa de mentira na mão de um
      // corretor de verdade.
      handoffOnExhaust: false,
    });

    return json({
      conversation_id: turn.conversationId,
      agent: turn.agent,
      handoff_to: turn.handoffAgent,
      qualified: turn.qualified,
      exhausted: turn.exhausted,
      score: turn.score,
      reply: turn.reply,
    });
  } catch (e) {
    if (e instanceof ConversationClosedError) {
      return json({ code: 'conversation_closed', error: e.message }, 409);
    }
    console.error('sdr-agent-chat error:', e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
