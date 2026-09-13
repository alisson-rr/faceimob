// SDR Agent Chat — playground interno de conversa com o agente.
// A lógica do turno (histórico, OpenAI, persistência, tag de qualificação) é a
// mesma do webhook de WhatsApp: vive em ../_shared/sdrAgent.ts.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ConversationClosedError, InactiveAgentError, runSdrAgentTurn } from '../_shared/sdrAgent.ts';
import { hasAnyRole, requireUserPermission, serviceClient } from '../_shared/auth.ts';
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A mesma resposta de id inexistente: "sem permissão" confirmaria que o lead existe. */
const naoEncontrada = () => json({ code: 'not_found', error: 'Conversa não encontrada.' }, 404);

/**
 * O usuário enxerga o lead? Quem responde é o RLS, com o JWT dele: a mesma
 * resposta que a tela de leads daria, sem copiar a regra de visibilidade aqui.
 *
 * O lead de teste do Playground que é DELE também vale: ele nasce sem dono, e
 * quem tem `leads.view_queue` desligado deixaria de conseguir continuar a
 * própria simulação.
 *
 * A chave do `apikey` segue a cascata de `_shared/auth.ts`: só o gateway a lê;
 * quem decide o papel no PostgREST é o `Authorization`, que é o do usuário.
 */
async function podeUsarLead(
  req: Request,
  supabase: SupabaseClient,
  leadId: string,
  userId: string,
): Promise<boolean> {
  const doUsuario = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')
      ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
      ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
      ?? '',
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
  const { data: visivel, error } = await doUsuario
    .from('leads').select('id').eq('id', leadId).maybeSingle();
  if (error) throw new Error(`leads (alcance do usuário): ${error.message}`);
  if (visivel) return true;

  const { data: meu, error: meuErr } = await supabase
    .from('leads').select('id')
    .eq('id', leadId)
    .eq('utm_source', PLAYGROUND_SOURCE)
    .eq('raw_payload->>playground_user', userId)
    .maybeSingle();
  if (meuErr) throw new Error(`leads: ${meuErr.message}`);
  return Boolean(meu);
}

/**
 * Papéis que a RLS deixa escrever em `sdr_conversations`/`sdr_messages`
 * (policies `sdr_conversations_write` da 0008). O playground GRAVA conversa:
 * liberá-lo para todo mundo com `menu.sdr` fazia director/manager escreverem
 * pela function o que o banco recusa no acesso direto — e depois não
 * conseguirem reler a própria simulação na aba Conversas. Além disso, cada
 * turno gasta crédito da OpenAI.
 *
 * O sócio NÃO está nesta lista e ainda assim passa: `hasAnyRole` espelha a
 * `has_any_role` do banco, onde pedir 'admin' aceita também 'partner' (0099).
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
    const { allowed, error: rolesErr } = await hasAnyRole(supabase, userId, ...WRITE_ROLES);
    if (rolesErr) {
      console.error('sdr-agent-chat: falha ao ler papéis —', rolesErr);
      return json({ error: 'Não foi possível verificar seu papel.' }, 500);
    }
    if (!allowed) {
      return json({
        code: 'role_forbidden',
        error: 'A simulação grava conversa no banco: só administrador, sócio, marketing e SDR podem usar o '
          + 'Playground. Seu papel consulta o módulo.',
      }, 403);
    }

    const apiKey = await getSecret('OPENAI_API_KEY');
    // Sem a chave da OpenAI nada responde. 503 com `code` distinto para a tela
    // dizer o que falta em vez de mostrar um erro genérico de servidor.
    //
    // O texto é renderizado LITERALMENTE na bolha de erro do Playground, então
    // fala a língua da tela: o rótulo é o do card em Admin · Integrações
    // (`src/lib/integrationCatalog.ts`), não `provider · label` do cofre, e o
    // secret da function — caminho de deploy, que nenhum usuário do CRM
    // alcança — fica no rastro de servidor, não no corpo da resposta.
    if (!apiKey) {
      console.error(
        'sdr-agent-chat: OPENAI_API_KEY ausente — cadastre em private.integration_credentials '
          + "(provider 'openai', label 'api_key') ou no secret OPENAI_API_KEY da function.",
      );
      return json({
        code: 'missing_credential',
        error: 'A IA de SDR ainda não está configurada: falta a chave da OpenAI no cofre. '
          + 'Cadastre em Admin · Integrações, no card “OpenAI — chave de API”.',
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
    const bodyLeadId = asId(lead_id);
    // Id malformado chegava ao PostgREST e voltava 500 com o erro de cast.
    if ([conversationId, bodyLeadId].some((id) => id !== null && !UUID.test(id))) {
      return json({ error: 'conversation_id e lead_id precisam ser uuid' }, 400);
    }

    // Terceira porta: lead e conversa vêm do corpo e o turno roda com service
    // role. Sem isto, quem abre o Playground lia e escrevia na conversa de
    // qualquer lead pelo id. A conversa tem de ser do lead informado, e o lead
    // tem de estar no alcance do usuário.
    let alvo = bodyLeadId;
    if (conversationId) {
      const { data: conv, error: convErr } = await supabase
        .from('sdr_conversations').select('lead_id').eq('id', conversationId).maybeSingle();
      if (convErr) throw new Error(`sdr_conversations: ${convErr.message}`);
      if (!conv || (bodyLeadId && conv.lead_id !== bodyLeadId)) return naoEncontrada();
      alvo = conv.lead_id;
    }
    if (alvo && !(await podeUsarLead(req, supabase, alvo, userId))) return naoEncontrada();

    const leadId = conversationId ? null : (bodyLeadId ?? await playgroundLeadId(supabase, userId));

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
    // Agente desligado no meio da conversa: recusa esperada, não falha do
    // servidor — o operador é quem desmarcou "Ativo".
    if (e instanceof InactiveAgentError) {
      return json({ code: 'agent_inactive', error: e.message }, 409);
    }
    console.error('sdr-agent-chat error:', e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500);
  }
});
