// Dispara template WhatsApp Cloud API para uma lista de remarketing
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireSecret } from '../_shared/secrets.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Só revela/configura integrações depois de autenticar e autorizar o papel.
    const token = await requireSecret('META_WHATSAPP_ACCESS_TOKEN');
    const phoneId = await requireSecret('META_WHATSAPP_PHONE_NUMBER_ID');

    const { list_id, test_phone } = await req.json();
    if (!list_id) throw new Error('list_id obrigatório');

    const { data: list, error: lErr } = await supabase
      .from('remarketing_lists').select('*').eq('id', list_id).single();
    if (lErr) throw lErr;

    // Trava de concorrência: dois cliques em "Disparar" não podem rodar o
    // mesmo lote duas vezes. O update condicional só passa para UMA chamada.
    if (!test_phone) {
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
    }

    if (!list.template_id) throw new Error('Configure um template aprovado na lista');
    const { data: templateRow, error: templateErr } = await supabase
      .from('whatsapp_templates').select('name,language,approved').eq('id', list.template_id).single();
    if (templateErr) throw templateErr;
    if (!templateRow.approved) throw new Error('O template ainda não está marcado como aprovado');
    const template = templateRow.name;
    const lang = templateRow.language || 'pt_BR';

    if (test_phone) {
      const res = await sendTemplate(phoneId, token, test_phone, template, lang, ['Teste']);
      return new Response(JSON.stringify({ test: true, ...res }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: contacts } = await supabase
      .from('remarketing_contacts').select('*')
      .eq('list_id', list_id).eq('status', 'pending').limit(500);

    let sent = 0, failed = 0;
    for (const c of (contacts || [])) {
      const phone = (c.phone || '').replace(/\D/g, '');
      if (!phone) { failed++; continue; }
      const to = phone.startsWith('55') ? phone : '55' + phone;
      const params = [c.full_name || 'Cliente', c.extra?.campaign || ''];
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

    await supabase.from('remarketing_lists').update({ status: failed ? 'failed' : 'done' }).eq('id', list_id);

    return new Response(JSON.stringify({ sent, failed, total: contacts?.length || 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    console.error('sdr-whatsapp-broadcast error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
