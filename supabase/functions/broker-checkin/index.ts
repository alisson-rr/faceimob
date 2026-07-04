import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function clientIp(req: Request): string | null {
  const h = req.headers;
  const xff = h.get('x-forwarded-for') || h.get('cf-connecting-ip') || h.get('x-real-ip') || '';
  return xff.split(',')[0]?.trim() || null;
}

// BRT window helper
function currentSlot(now = new Date()): { slot: string; canDistribute: boolean } | null {
  // Convert to BRT (UTC-3)
  const brt = new Date(now.getTime() - 3 * 3600 * 1000);
  const h = brt.getUTCHours();
  const m = brt.getUTCMinutes();
  const t = h * 60 + m;
  const inRange = (a: number, b: number) => t >= a && t < b;
  if (inRange(9 * 60, 12 * 60)) return { slot: 'morning', canDistribute: t >= 9 * 60 + 30 };
  if (inRange(12 * 60, 16 * 60)) return { slot: 'afternoon', canDistribute: t >= 13 * 60 + 30 };
  if (inRange(16 * 60, 22 * 60)) return { slot: 'evening', canDistribute: t >= 16 * 60 + 30 };
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const action = body?.action === 'checkout' ? 'checkout' : 'checkin';

    const admin = createClient(supabaseUrl, serviceKey);

    // find broker record for this user
    const { data: broker, error: brokerErr } = await admin
      .from('brokers')
      .select('id, name, active')
      .eq('user_id', user.id)
      .maybeSingle();
    if (brokerErr || !broker) {
      return new Response(JSON.stringify({ error: 'Corretor não encontrado para este usuário.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!broker.active) {
      return new Response(JSON.stringify({ error: 'Corretor inativo.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const slotInfo = currentSlot();
    if (!slotInfo) {
      return new Response(JSON.stringify({ error: 'Fora da janela de check-in. Janelas: 09:00–11:59, 12:00–15:59, 16:00–22:00 (BRT).' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ip = clientIp(req);
    // Date in BRT
    const brt = new Date(Date.now() - 3 * 3600 * 1000);
    const workDate = brt.toISOString().slice(0, 10);

    if (action === 'checkout') {
      const { data, error } = await admin
        .from('broker_checkins')
        .update({ checked_out_at: new Date().toISOString() })
        .eq('broker_id', broker.id)
        .eq('work_date', workDate)
        .eq('slot', slotInfo.slot)
        .is('checked_out_at', null)
        .select()
        .maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, checkin: data }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // check-in: validate IP against allowlist
    if (!ip) {
      return new Response(JSON.stringify({ error: 'Não foi possível identificar seu IP.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: allowed, error: ipErr } = await admin
      .from('allowed_ips')
      .select('id')
      .eq('active', true)
      .eq('ip', ip)
      .maybeSingle();
    if (ipErr) throw ipErr;
    if (!allowed) {
      return new Response(JSON.stringify({ error: `IP ${ip} não autorizado para check-in. Fale com um administrador.` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // upsert checkin (unique broker+date+slot)
    const { data: existing } = await admin
      .from('broker_checkins')
      .select('id, checked_out_at')
      .eq('broker_id', broker.id)
      .eq('work_date', workDate)
      .eq('slot', slotInfo.slot)
      .maybeSingle();

    let row;
    if (existing) {
      const { data, error } = await admin
        .from('broker_checkins')
        .update({ checked_out_at: null, ip, user_id: user.id })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await admin
        .from('broker_checkins')
        .insert({
          broker_id: broker.id, user_id: user.id, slot: slotInfo.slot,
          work_date: workDate, ip,
        })
        .select()
        .single();
      if (error) throw error;
      row = data;
    }

    return new Response(JSON.stringify({
      success: true, checkin: row, slot: slotInfo.slot,
      distribution_active: slotInfo.canDistribute,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('broker-checkin error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
