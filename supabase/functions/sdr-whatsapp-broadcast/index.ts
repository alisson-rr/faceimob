// Dispara template WhatsApp Cloud API para uma lista de remarketing
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function sendTemplate(phoneNumberId: string, token: string, to: string, template: string, lang: string, params: string[]) {
  const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  const body: any = {
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
    const token = Deno.env.get('META_WHATSAPP_ACCESS_TOKEN');
    const phoneId = Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID');
    if (!token || !phoneId) throw new Error('Credenciais WhatsApp não configuradas (META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID)');

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { list_id, test_phone } = await req.json();
    if (!list_id) throw new Error('list_id obrigatório');

    const { data: list, error: lErr } = await supabase
      .from('remarketing_lists').select('*').eq('id', list_id).single();
    if (lErr) throw lErr;

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
    await supabase.from('remarketing_lists').update({ status: 'running' }).eq('id', list_id);
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
  } catch (e: any) {
    console.error('sdr-whatsapp-broadcast error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
