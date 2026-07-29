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
    const url = `https://graph.facebook.com/v19.0/${formId}?fields=name,status&access_token=${pageAccessToken}`
    const res = await fetch(url)
    const json = await res.json()
    console.log('Graph form response for', formId, ':', JSON.stringify(json))
    if (json?.error) return null
    return json?.name || null
  } catch (e) {
    console.error('fetchFormName error:', e)
    return null
  }
}

async function fetchAdName(adId: string, pageAccessToken: string): Promise<string | null> {
  try {
    if (!adId || !pageAccessToken) return null
    const url = `https://graph.facebook.com/v19.0/${adId}?fields=name,campaign{name},adset{name}&access_token=${pageAccessToken}`
    const res = await fetch(url)
    const json = await res.json()
    console.log('Graph ad response for', adId, ':', JSON.stringify(json))
    if (json?.error) return null
    return json?.campaign?.name || json?.adset?.name || json?.name || null
  } catch (e) {
    console.error('fetchAdName error:', e)
    return null
  }
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

      // ⏸️ Pausa global: se ativado no admin, ignora todos os leads recebidos.
      const { data: settings } = await supabase
        .from('automation_settings')
        .select('leads_paused')
        .eq('id', true)
        .maybeSingle()
      if (settings?.leads_paused) {
        console.log('Leads paused — ignoring incoming payload')
        return new Response(JSON.stringify({ success: true, paused: true, leads_processed: 0 }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

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

            // 2) Graph API fetch (real leads) — SEMPRE tenta se tiver token,
            // pois muitas vezes o inline vem vazio ou incompleto
            if (v.leadgen_id && pageAccessToken) {
              const g = await fetchLeadFromGraph(v.leadgen_id, pageAccessToken)
              if (g && Object.keys(g).length > 0) fields = { ...g, ...fields }
            }

            let formName = await fetchFormName(v.form_id, pageAccessToken)
            if (!formName && v.ad_id) {
              formName = await fetchAdName(v.ad_id, pageAccessToken)
            }
            // if still no name, look up the group's saved form name for this form_id
            if (!formName && v.form_id) {
              const { data: gf } = await supabase
                .from('distribution_group_forms')
                .select('form_name')
                .eq('form_id', String(v.form_id))
                .not('form_name', 'is', null)
                .maybeSingle()
              if (gf?.form_name) formName = gf.form_name as string
            }
            console.log('Parsed lead — form_name:', formName, 'fields:', JSON.stringify(fields))

            const firstName = fields['first_name'] || fields['primeiro_nome'] || ''
            const lastName = fields['last_name'] || fields['sobrenome'] || ''
            const composed = [firstName, lastName].filter(Boolean).join(' ').trim()
            const fullName = fields['full_name'] || fields['nome_completo'] || fields['nome_e_sobrenome'] || fields['name'] || fields['nome'] || composed || ''
            const fallbackName = fields['email']?.split('@')[0] || fields['phone_number'] || `Lead ${v.leadgen_id || ''}`.trim()

            leads.push({
              full_name: fullName || firstName || fallbackName,
              phone: fields['phone_number'] || fields['telefone'] || fields['phone'] || '',
              phone_raw: fields['phone_number'] || fields['whatsapp'] || '',
              email: fields['email'] || null,
              status: 'queued',
              funnel_stage: 'new',
              form_id: v.form_id ? String(v.form_id) : null,
              external_id: v.leadgen_id ? String(v.leadgen_id) : null,
              campaign_id: v.campaign_id ? String(v.campaign_id) : null,
              adset_id: v.adset_id ? String(v.adset_id) : null,
              ad_id: v.ad_id ? String(v.ad_id) : null,
              utm_source: pickUtm(fields, 'utm_source') || 'meta',
              utm_medium: pickUtm(fields, 'utm_medium'),
              utm_campaign: pickUtm(fields, 'utm_campaign'),
              utm_content: pickUtm(fields, 'utm_content'),
              utm_term: pickUtm(fields, 'utm_term'),
              raw_payload: { fields, leadgen_id: v.leadgen_id, form_id: v.form_id, page_id: v.page_id, ad_id: v.ad_id, adset_id: v.adset_id, campaign_id: v.campaign_id, form_name: formName },
              notes: `leadgen_id=${v.leadgen_id || ''} form_id=${v.form_id || ''} form_name=${formName || '—'} page_id=${v.page_id || ''}${!pageAccessToken ? ' [SEM META_PAGE_ACCESS_TOKEN]' : ''}`,
            })
          }
        }
      }

      // Fallback direto (Zapier / POST manual)
      if (leads.length === 0 && (body.name || body.email || body.phone)) {
        leads.push({
          full_name: body.name || 'Lead Meta Ads',
          phone: body.phone || '',
          phone_raw: body.whatsapp || body.phone || '',
          email: body.email || null,
          status: 'queued',
          funnel_stage: 'new',
          utm_source: body.source || 'meta',
          raw_payload: body,
          notes: body.notes || '',
        })
      }

      if (leads.length === 0) {
        console.log('No leads parsed from payload')
        return new Response(JSON.stringify({ success: true, message: 'No leads to process' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Insert leads one-by-one so a single bad row cannot fail the whole batch (Meta would retry -> duplicates)
      const insertedRows: any[] = []
      const errors: any[] = []
      for (const lead of leads) {
        try {
          const { data: row, error: leadErr } = await supabase.from('leads').insert(lead).select().single()
          if (leadErr) {
            console.error('Lead insert error:', leadErr, 'payload:', JSON.stringify(lead))
            errors.push({ message: leadErr.message, lead })
            continue
          }
          insertedRows.push(row)
          const { error: assignErr } = await supabase.rpc('assign_lead', { p_lead_id: row.id })
          if (assignErr) console.error('Lead assignment error:', assignErr)
        } catch (e) {
          console.error('Lead insert threw:', e)
          errors.push({ message: e instanceof Error ? e.message : String(e), lead })
        }
      }

      // Always ACK 200 so Meta does not retry (retries cause duplicate leads/notifications)
      return new Response(JSON.stringify({
        success: true,
        leads_processed: insertedRows.length,
        errors: errors.length ? errors : undefined,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  } catch (error) {
    console.error('Webhook error:', error)
    // Return 200 so Meta does not retry indefinitely and pile up duplicates; error is logged for us.
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
