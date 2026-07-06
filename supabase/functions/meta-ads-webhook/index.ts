import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchLeadFromGraph(leadgenId: string, pageAccessToken: string) {
  try {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${pageAccessToken}`
    const res = await fetch(url)
    const json = await res.json()
    console.log('Graph API response for', leadgenId, ':', JSON.stringify(json))
    if (json.error) return null
    const fields: Record<string, string> = {}
    for (const f of json.field_data || []) {
      fields[(f.name || '').toLowerCase()] = f.values?.[0] || ''
    }
    return fields
  } catch (e) {
    console.error('Graph fetch error:', e)
    return null
  }
}

async function fetchFormName(formId: string, pageAccessToken: string): Promise<string | null> {
  try {
    if (!formId || !pageAccessToken) return null
    const url = `https://graph.facebook.com/v19.0/${formId}?fields=name&access_token=${pageAccessToken}`
    const res = await fetch(url)
    const json = await res.json()
    return json?.name || null
  } catch { return null }
}

function pickUtm(fields: Record<string, string>, key: string) {
  return fields[key] || fields[`utm_${key}`] || fields[key.replace('utm_', '')] || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const pageAccessToken = Deno.env.get('META_PAGE_ACCESS_TOKEN') || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Verification (GET)
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')
      const verifyToken = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || 'faceimob_meta_verify'
      if (mode === 'subscribe' && token === verifyToken) {
        return new Response(challenge, { status: 200, headers: corsHeaders })
      }
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    if (req.method === 'POST') {
      const raw = await req.text()
      console.log('Meta webhook POST body:', raw)
      let body: any = {}
      try { body = JSON.parse(raw) } catch {}

      const leads: any[] = []

      if (body.entry) {
        for (const entry of body.entry) {
          for (const change of entry.changes || []) {
            if (change.field !== 'leadgen' || !change.value) continue
            const v = change.value
            let fields: Record<string, string> = {}

            // 1) inline (test tool sometimes)
            if (v.field_data) {
              for (const f of v.field_data) {
                fields[(f.name || '').toLowerCase()] = f.values?.[0] || ''
              }
            }

            // 2) Graph API fetch (real leads)
            if (Object.keys(fields).length === 0 && v.leadgen_id && pageAccessToken) {
              const g = await fetchLeadFromGraph(v.leadgen_id, pageAccessToken)
              if (g) fields = g
            }

            const formName = await fetchFormName(v.form_id, pageAccessToken)

            leads.push({
              name: fields['first_name'] || fields['nome'] || (fields['full_name'] || fields['name'] || '').split(' ')[0] || `Lead Meta ${v.leadgen_id || ''}`.trim(),
              phone: fields['phone_number'] || fields['telefone'] || fields['phone'] || '',
              whatsapp: fields['phone_number'] || fields['whatsapp'] || '',
              email: fields['email'] || '',
              source: 'Meta Ads',
              status: 'new',
              form_name: formName || fields['form_name'] || null,
              form_answers: fields,
              utm_source: pickUtm(fields, 'utm_source') || 'meta',
              utm_medium: pickUtm(fields, 'utm_medium'),
              utm_campaign: pickUtm(fields, 'utm_campaign'),
              utm_content: pickUtm(fields, 'utm_content'),
              utm_term: pickUtm(fields, 'utm_term'),
              tracking: { leadgen_id: v.leadgen_id, form_id: v.form_id, page_id: v.page_id, ad_id: v.ad_id, adset_id: v.adset_id, campaign_id: v.campaign_id },
              notes: `leadgen_id=${v.leadgen_id || ''} form_id=${v.form_id || ''} page_id=${v.page_id || ''}${!pageAccessToken ? ' [SEM META_PAGE_ACCESS_TOKEN — dados não puxados]' : ''}`,
            })
          }
        }
      }

      // Fallback direto (Zapier / POST manual)
      if (leads.length === 0 && (body.name || body.email || body.phone)) {
        leads.push({
          name: body.name || 'Lead Meta Ads',
          phone: body.phone || '',
          whatsapp: body.whatsapp || body.phone || '',
          email: body.email || '',
          source: body.source || 'Meta Ads',
          status: 'new',
          notes: body.notes || '',
        })
      }

      if (leads.length === 0) {
        console.log('No leads parsed from payload')
        return new Response(JSON.stringify({ success: true, message: 'No leads to process' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data: inserted, error } = await supabase.from('leads').insert(leads).select()
      if (error) {
        console.error('Insert error:', error)
        throw new Error(error.message)
      }

      const notifications = (inserted || []).map(l => ({
        title: '🔔 Novo Lead Meta Ads!',
        message: `${l.name} — ${l.phone || l.email || 'sem contato'}`,
        user_id: null,
      }))
      if (notifications.length) {
        await supabase.from('notifications').insert(notifications)
      }

      return new Response(JSON.stringify({ success: true, leads_processed: inserted?.length || 0 }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
