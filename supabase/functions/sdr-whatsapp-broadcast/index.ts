// Saída de WhatsApp autenticada: disparo de template para lista de remarketing,
// resposta do operador humano dentro do CRM e testes de credencial da Meta.
//
// As três coisas vivem aqui porque compartilham a MESMA porta: sessão do
// usuário → papel admin/marketing/sdr → só então o cofre é tocado. Uma function
// nova por ação repetiria essa porta três vezes, e é ela que impede a chave
// publicável do bundle de fazer a WABA da empresa mandar mensagem.
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSecret } from '../_shared/secrets.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Quantos contatos um clique em "Disparar" processa. Acima disso a edge
 *  function encosta no teto de tempo; o que sobra volta no próximo clique e a
 *  resposta diz quantos ficaram (`remaining`). */
const BATCH = 500;

/** Teto da resposta digitada pelo operador. A Cloud API corta em 4096; recusar
 *  aqui evita mandar um texto que chega truncado ao cliente. */
const MAX_REPLY = 4000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Credencial ausente é 503 com `code`, nunca 500 e nunca 2xx.
 *
 * Um botão que falha em silêncio por falta de chave é pior que um botão
 * desabilitado com o motivo escrito: a tela lê este `code` para dizer o que
 * cadastrar, e o `error` já vem pronto em pt-BR para quem só ler o toast.
 */
const missingCredential = (name: string) =>
  json({
    code: 'missing_credential',
    credential: name,
    error: `Credencial ausente: ${name}. Cadastre em Admin · Integrações — as functions passam a usar o valor sem redeploy.`,
  }, 503);

/**
 * Resposta do operador humano, pelo CRM.
 *
 * Três travas, todas necessárias:
 *  · A conversa precisa estar em `human`. Em `active` o robô ainda responde e
 *    duas vozes escreveriam para o mesmo cliente; em `qualified`/`handed_off` o
 *    atendimento já saiu do SDR.
 *  · O telefone sai do LEAD da conversa, nunca do corpo da requisição — senão
 *    um autenticado escolheria para qual número a WABA da empresa manda texto.
 *  · A mensagem só é gravada DEPOIS de a Meta aceitar. Gravar antes deixaria o
 *    histórico afirmando que o cliente recebeu algo que nunca saiu.
 */
async function humanReply(
  supabase: SupabaseClient,
  conversationId: unknown,
  text: unknown,
  userId: string,
) {
  if (typeof conversationId !== 'string' || !conversationId.trim()) {
    return json({ error: 'conversation_id obrigatório' }, 400);
  }
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return json({ error: 'Escreva a mensagem antes de enviar.' }, 400);
  if (body.length > MAX_REPLY) {
    return json({ error: `Mensagem longa demais (máx. ${MAX_REPLY} caracteres).` }, 400);
  }

  const { data: conv, error: convErr } = await supabase
    .from('sdr_conversations')
    .select('id, status, lead_id, leads(phone_raw, phone)')
    .eq('id', conversationId)
    .maybeSingle();
  if (convErr) return json({ error: `sdr_conversations: ${convErr.message}` }, 500);
  if (!conv) return json({ error: 'Conversa não encontrada.' }, 404);
  if (conv.status !== 'human') {
    return json({
      code: 'conversation_not_human',
      error: 'Assuma a conversa antes de responder: enquanto ela estiver com o robô, as duas respostas sairiam para o mesmo cliente.',
    }, 409);
  }

  const lead = conv.leads as { phone_raw?: string | null; phone?: string | null } | null;
  const digits = String(lead?.phone_raw || lead?.phone || '').replace(/\D/g, '');
  if (!digits) {
    return json({ error: 'O lead desta conversa não tem telefone gravado — não há para onde enviar.' }, 422);
  }
  const to = digits.startsWith('55') ? digits : `55${digits}`;

  // O cofre só é tocado depois de o pedido estar validado — e a ausência de
  // credencial é dita por escrito, nunca convertida num sucesso silencioso.
  const token = await getSecret('META_WHATSAPP_ACCESS_TOKEN');
  const phoneId = await getSecret('META_WHATSAPP_PHONE_NUMBER_ID');
  if (!token) return missingCredential('META_WHATSAPP_ACCESS_TOKEN');
  if (!phoneId) return missingCredential('META_WHATSAPP_PHONE_NUMBER_ID');

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalhe = String(data?.error?.message ?? '').slice(0, 240);
    return json({
      ok: false,
      error: res.status === 401 || res.status === 403
        ? 'A Meta recusou o token do WhatsApp. Substitua a credencial em Admin · Integrações.'
        // Fora da janela de 24 h a Cloud API só aceita template; dizer isso
        // evita o operador reescrever a mesma frase cinco vezes.
        : `A Meta recusou a mensagem (${res.status}). ${detalhe || 'Se a última mensagem do cliente tem mais de 24 h, a Meta só aceita template — dispare um pela aba Remarketing.'}`,
    }, 502);
  }

  const providerId = data?.messages?.[0]?.id ?? null;
  // `broker` é o autor do enum `message_author` (0001) para o humano: separa a
  // fala do operador da do robô no histórico e na aba Conversas.
  //
  // Sem `agent_id`: a resposta do operador não tem agente, e mandar a chave com
  // `null` só criaria dependência da migration 0082 para gravar o que já é o
  // default da coluna. Com ela no payload, um banco sem a coluna devolvia
  // PGRST204 DEPOIS de a Meta ter aceitado a mensagem — o cliente recebia, o
  // trigger `sdr_messages_touch` não rodava e o selo "parada há X h" continuava
  // na lista logo após o operador responder.
  const { error: insErr } = await supabase.from('sdr_messages').insert({
    conversation_id: conversationId,
    author: 'broker',
    body,
    provider_message_id: providerId,
  });
  if (insErr) {
    // A mensagem SAIU: dizer "falhou" faria o operador mandar de novo. O
    // desfecho honesto é sucesso com o aviso de que o histórico ficou incompleto.
    console.error('sdr-whatsapp-broadcast: mensagem enviada mas não gravada —', insErr.message, 'por', userId);
    return json({
      ok: true,
      persisted: false,
      warning: 'A mensagem foi entregue ao WhatsApp, mas não consegui gravá-la no histórico da conversa.',
    });
  }
  return json({ ok: true, persisted: true, provider_message_id: providerId });
}

/**
 * Apelidos aceitos para cada placeholder do template. `whatsapp_templates.
 * variables` guarda os NOMES na ordem em que a Meta espera ({{1}}, {{2}}...),
 * e é essa lista que decide quantos parâmetros vão no disparo — mandar dois
 * fixos, como antes, quebrava todo template com um placeholder só, e o erro só
 * aparecia em `remarketing_contacts.last_error`.
 *
 * Mesma tabela de apelidos de `src/components/sdr/templateVars.ts`, que é quem
 * avisa o operador na tela. Mudou aqui, muda lá.
 */
const VAR_ALIASES: Record<string, string[]> = {
  nome: ['nome', 'name', 'cliente', 'contato', '1'],
  campanha: ['campanha', 'campaign', 'origem', '2'],
};

function templateParams(variables: string[] | null | undefined, values: Record<string, string>): string[] {
  return (variables ?? []).map((raw) => {
    const key = String(raw).trim().toLowerCase();
    for (const [canonical, aliases] of Object.entries(VAR_ALIASES)) {
      if (aliases.includes(key)) return values[canonical]?.trim() || '-';
    }
    return values[key]?.trim() || '-';
  });
}

async function sendTemplate(phoneNumberId: string, token: string, to: string, template: string, lang: string, params: string[]) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const body: {
    messaging_product: string;
    to: string;
    type: string;
    template: {
      name: string;
      language: { code: string };
      components?: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>;
    };
  } = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
    },
  };
  if (params.length > 0) {
    body.template.components = [{
      type: 'body',
      parameters: params.map(p => ({ type: 'text', text: p })),
    }];
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Disparo em massa para clientes reais não é para qualquer autenticado:
    // exige o mesmo papel que a RLS de remarketing_lists exige para escrever.
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
    );
    const { data: authData, error: authErr } = await authClient.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: roles } = await supabase
      .from('user_roles').select('role').eq('profile_id', authData.user.id);
    const allowed = (roles || []).some((role: { role: string }) => ['admin', 'marketing', 'sdr'].includes(role.role));
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Papel sem permissão para disparo em massa' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // O corpo é lido ANTES do cofre: `probe_page_token` testa uma credencial
    // diferente e não pode morrer porque o token do WhatsApp ainda não existe.
    const { list_id, test_phone, action, conversation_id, text } = await req.json().catch(() => ({})) as {
      list_id?: string; test_phone?: string; action?: string; conversation_id?: string; text?: string;
    };

    // "Testar conexão" do token da PÁGINA (meta/page_access_token), que o
    // meta-ads-webhook usa para completar o lead pela Graph API. Leitura pura de
    // /me: não publica nada e não manda mensagem. Sem isso o slot era gravado
    // às cegas e o primeiro sinal de token errado era um lead entrando sem
    // nome de formulário nem campanha.
    if (action === 'probe_page_token') {
      const pageToken = await getSecret('META_PAGE_ACCESS_TOKEN');
      if (!pageToken) return missingCredential('META_PAGE_ACCESS_TOKEN');
      const res = await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name`,
        { headers: { Authorization: `Bearer ${pageToken}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return json({ ok: true, name: data.name ?? null, id: data.id ?? null });
      }
      return json({
        ok: false,
        error: res.status === 401 || res.status === 403 || res.status === 400
          ? 'A Meta recusou o token da página. Gere outro no Graph API Explorer (com a Página selecionada) e substitua no cofre.'
          : `A Meta respondeu ${res.status}: ${String(data?.error?.message ?? '').slice(0, 200)}`,
      }, 502);
    }

    // Resposta do operador que assumiu a conversa, escrita de dentro do CRM.
    // O histórico e a janela de 24 h da Meta já vivem aqui; obrigar a falar
    // "pelo aparelho" deixava metade do atendimento fora do sistema.
    // Vem ANTES da resolução das chaves do WhatsApp porque valida o pedido
    // primeiro: responder numa conversa que ainda é do robô é erro do
    // chamador, e ele precisa ouvir isso mesmo num ambiente sem credencial.
    if (action === 'human_reply') {
      return await humanReply(supabase, conversation_id, text, authData.user.id);
    }

    // Só revela/configura integrações depois de autenticar e autorizar o papel.
    const token = await getSecret('META_WHATSAPP_ACCESS_TOKEN');
    const phoneId = await getSecret('META_WHATSAPP_PHONE_NUMBER_ID');
    // 503 com `code` em vez do 500 genérico: a tela precisa distinguir "falta
    // credencial" (o admin resolve em Integrações, sem redeploy) de "a Meta
    // recusou" e de "o banco falhou". Antes as três viravam o mesmo toast
    // vermelho e o operador clicava de novo achando que era instabilidade.
    if (!token) return missingCredential('META_WHATSAPP_ACCESS_TOKEN');
    if (!phoneId) return missingCredential('META_WHATSAPP_PHONE_NUMBER_ID');

    // "Testar conexão" da tela de Integrações: leitura pura do número emissor,
    // que prova token E phone number id sem mandar mensagem para ninguém. Sem
    // isso, o primeiro sinal de credencial errada era um disparo real falhando.
    if (action === 'probe') {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${phoneId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return new Response(JSON.stringify({
          ok: true, phone: data.display_phone_number ?? null, name: data.verified_name ?? null,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        ok: false,
        error: res.status === 401 || res.status === 403
          ? 'A Meta recusou o token do WhatsApp (ou ele não tem acesso a este número). Gere outro e substitua no cofre.'
          : `A Meta respondeu ${res.status}: ${String(data?.error?.message ?? '').slice(0, 200)}`,
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!list_id) throw new Error('list_id obrigatório');

    const { data: list, error: lErr } = await supabase
      .from('remarketing_lists').select('*').eq('id', list_id).single();
    if (lErr) throw lErr;

    // Validações que lançam vêm ANTES da trava: gravar 'running' e só depois
    // recusar o template deixava a lista presa nesse status para sempre.
    if (!list.template_id) throw new Error('Configure um template aprovado na lista');
    const { data: templateRow, error: templateErr } = await supabase
      .from('whatsapp_templates').select('name,language,approved,active,variables').eq('id', list.template_id).single();
    if (templateErr) throw templateErr;
    if (!templateRow.approved) throw new Error('O template ainda não está marcado como aprovado');
    if (!templateRow.active) throw new Error('O template está inativo — reative-o na aba WhatsApp antes de disparar');
    const template = templateRow.name;
    const lang = templateRow.language || 'pt_BR';
    const variables = templateRow.variables as string[] | null;

    if (test_phone) {
      const to = String(test_phone).replace(/\D/g, '');
      if (!to) throw new Error('Telefone de teste inválido');
      const res = await sendTemplate(
        phoneId, token, to.startsWith('55') ? to : '55' + to, template, lang,
        templateParams(variables, { nome: 'Teste', campanha: list.name }),
      );
      return new Response(JSON.stringify({ test: true, ...res }), {
        status: res.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Trava de concorrência: dois cliques em "Disparar" não podem rodar o
    // mesmo lote duas vezes. O update condicional só passa para UMA chamada.
    if (list.status === 'running') {
      return new Response(JSON.stringify({ error: 'Disparo já em andamento para esta lista' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: lock, error: lockErr } = await supabase
      .from('remarketing_lists')
      .update({ status: 'running' })
      .eq('id', list_id)
      .neq('status', 'running')
      .select('id');
    if (lockErr) throw lockErr;
    if (!lock || lock.length === 0) {
      return new Response(JSON.stringify({ error: 'Disparo já em andamento para esta lista' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const { data: contacts } = await supabase
        .from('remarketing_contacts').select('*')
        .eq('list_id', list_id).eq('status', 'pending').limit(BATCH);

      let sent = 0, failed = 0;
      for (const c of (contacts || [])) {
        const phone = (c.phone || '').replace(/\D/g, '');
        if (!phone) { failed++; continue; }
        const to = phone.startsWith('55') ? phone : '55' + phone;
        const params = templateParams(variables, {
          nome: c.full_name || 'Cliente',
          campanha: c.extra?.campaign || list.name,
        });
        const { ok, data } = await sendTemplate(phoneId, token, to, template, lang, params);
        if (ok) {
          sent++;
          await supabase.from('remarketing_contacts').update({
            status: 'sent', sent_at: new Date().toISOString(), last_error: null,
          }).eq('id', c.id);
        } else {
          failed++;
          await supabase.from('remarketing_contacts').update({
            status: 'failed', last_error: JSON.stringify(data).slice(0, 500),
          }).eq('id', c.id);
        }
        await new Promise(r => setTimeout(r, 250)); // rate limit
      }

      // O que sobrou. Lote de 500 por chamada: marcar 'done' com fila pendente
      // era a tela dizendo que a lista inteira saiu.
      const { count: remaining } = await supabase
        .from('remarketing_contacts').select('id', { count: 'exact', head: true })
        .eq('list_id', list_id).eq('status', 'pending');
      const pending = remaining ?? 0;

      await supabase.from('remarketing_lists')
        .update({ status: failed ? 'failed' : pending > 0 ? 'draft' : 'done' })
        .eq('id', list_id);

      return new Response(JSON.stringify({
        sent, failed, total: contacts?.length || 0, remaining: pending,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (e) {
      // Qualquer estouro depois da trava (rede da Meta, banco) solta a lista:
      // 'failed' deixa o operador disparar de novo para os contatos pendentes.
      await supabase.from('remarketing_lists').update({ status: 'failed' }).eq('id', list_id);
      throw e;
    }
  } catch (e: unknown) {
    console.error('sdr-whatsapp-broadcast error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
