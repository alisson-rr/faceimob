import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function slugify(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
}

function friendlyPassword(name: string) {
  const first = slugify(name).split('.')[0] || 'user';
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  const n = String(Math.floor(1000 + Math.random() * 9000));
  return `${cap}@${n}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // caller must be admin
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userData.user.id);
    const isAdmin = (roles || []).some((r: any) => r.role === 'admin');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Somente administradores podem provisionar acessos.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { broker_id, email: bodyEmail, reset } = await req.json();
    if (!broker_id) throw new Error('broker_id obrigatório');

    const { data: broker, error: brErr } = await admin
      .from('brokers').select('id, name, email, user_id, login_email').eq('id', broker_id).maybeSingle();
    if (brErr || !broker) throw new Error('Corretor não encontrado');

    const email = (bodyEmail || broker.login_email || broker.email || `${slugify(broker.name)}@faceimob.com.br`).toLowerCase();
    const password = friendlyPassword(broker.name);

    // If broker already has a user_id, reset password (if requested) and return
    if (broker.user_id && !reset) {
      return new Response(JSON.stringify({ error: 'Este corretor já possui acesso. Use "Redefinir senha".', email }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let userId = broker.user_id as string | null;

    if (userId) {
      // reset password on existing user
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password, email });
      if (updErr) throw updErr;
    } else {
      // try find existing auth user by email
      const { data: list } = await admin.auth.admin.listUsers();
      const existing = list?.users?.find((u: any) => u.email?.toLowerCase() === email);
      if (existing) {
        userId = existing.id;
        const { error: updErr } = await admin.auth.admin.updateUserById(existing.id, { password });
        if (updErr) throw updErr;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true,
          user_metadata: { name: broker.name, broker_id: broker.id },
        });
        if (cErr) throw cErr;
        userId = created.user?.id ?? null;
      }
    }

    if (!userId) throw new Error('Falha ao criar usuário');

    await admin.from('brokers').update({
      user_id: userId, login_email: email, login_provisioned_at: new Date().toISOString(),
      login_email_confirmed: true,
    }).eq('id', broker.id);

    return new Response(JSON.stringify({ success: true, email, password, user_id: userId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('provision-broker-user error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
