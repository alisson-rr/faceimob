import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSecret } from '../_shared/secrets.ts'
import { checkMetaSignature, normalizePhone, sendWhatsAppTemplate } from '../_shared/meta.ts'

type SupabaseClient = ReturnType<typeof createClient>
type MetaField = { name?: string; values?: unknown[] }
type MetaLeadValue = {
  field_data?: MetaField[]
  leadgen_id?: string | number
  form_id?: string | number
  page_id?: string | number
  ad_id?: string | number
  adset_id?: string | number
  campaign_id?: string | number
}
type MetaPayload = {
  entry?: Array<{ changes?: Array<{ field?: string; value?: MetaLeadValue }> }>
  name?: unknown
  email?: unknown
  phone?: unknown
  whatsapp?: unknown
  source?: unknown
  notes?: unknown
}
type IncomingLead = {
  full_name: string
  phone: string
  phone_raw: string
  email: string | null
  status: 'queued'
  funnel_stage: 'new'
  form_id?: string | null
  external_id?: string | null
  campaign_id?: string | null
  adset_id?: string | null
  ad_id?: string | null
  utm_source: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  raw_payload: unknown
  notes: string
}

const textValue = (value: unknown) => typeof value === 'string' ? value : ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function fetchLeadFromGraph(leadgenId: string, pageAccessToken: string) {
  try {
    const url = `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${pageAccessToken}`
    const res = await fetch(url)
    const json = await res.json()
    if (json.error) {
      console.error('Graph API error for leadgen', leadgenId, json.error?.code)
      return null
    }
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
    if (json?.error) return null
    return json?.name || null
  } catch {
    return null
  }
}

async function fetchAdName(adId: string, pageAccessToken: string): Promise<string | null> {
  try {
    if (!adId || !pageAccessToken) return null
    const url = `https://graph.facebook.com/v19.0/${adId}?fields=name,campaign{name},adset{name}&access_token=${pageAccessToken}`
    const res = await fetch(url)
    const json = await res.json()
    if (json?.error) return null
    return json?.campaign?.name || json?.adset?.name || json?.name || null
  } catch {
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
    // Cofre primeiro, secret da function como fallback (ver _shared/secrets.ts).
    const pageAccessToken = (await getSecret('META_PAGE_ACCESS_TOKEN')) || ''
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Verification (GET). Sem token cadastrado o handshake é recusado — o
    // fallback hardcoded que existia aqui era um valor público no repositório.
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const mode = url.searchParams.get('hub.mode')
      const token = url.searchParams.get('hub.verify_token')
      const challenge = url.searchParams.get('hub.challenge')
      const verifyToken = await getSecret('META_WEBHOOK_VERIFY_TOKEN')
      if (verifyToken && mode === 'subscribe' && token === verifyToken) {
        return new Response(challenge, { status: 200, headers: corsHeaders })
      }
      return new Response('Forbidden', { status: 403, headers: corsHeaders })
    }

    if (req.method === 'POST') {
      const raw = await req.text()

      // Assinatura X-Hub-Signature-256. Com META_APP_SECRET cadastrado, POST
      // sem assinatura válida é recusado; sem o segredo (homologação ainda sem
      // credencial), aceita e avisa no log.
      const sig = await checkMetaSignature(raw, req.headers.get('x-hub-signature-256'))
      if (sig === 'invalid') {
        console.error('meta-ads-webhook: assinatura inválida — POST recusado')
        return new Response('Invalid signature', { status: 401, headers: corsHeaders })
      }
      if (sig === 'unconfigured') {
        console.warn('meta-ads-webhook: META_APP_SECRET não cadastrado — aceitando POST sem verificação de origem')
      }

      let body: MetaPayload = {}
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as MetaPayload
      } catch {
        console.warn('meta-ads-webhook: payload JSON inválido')
      }

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

      const leads: IncomingLead[] = []

      if (body.entry) {
        for (const entry of body.entry) {
          for (const change of entry.changes || []) {
            if (change.field !== 'leadgen' || !change.value) continue
            const v = change.value
            let fields: Record<string, string> = {}

            // 1) inline (test tool sometimes)
            if (v.field_data) {
              for (const f of v.field_data) {
                fields[(f.name || '').toLowerCase()] = String(f.values?.[0] ?? '')
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
            // Sem PII no log: só identificadores técnicos.
            console.log('Parsed lead — leadgen_id:', v.leadgen_id, 'form_id:', v.form_id, 'fields_count:', Object.keys(fields).length)

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
          full_name: textValue(body.name) || 'Lead Meta Ads',
          phone: textValue(body.phone),
          phone_raw: textValue(body.whatsapp) || textValue(body.phone),
          email: textValue(body.email) || null,
          status: 'queued',
          funnel_stage: 'new',
          utm_source: textValue(body.source) || 'meta',
          raw_payload: body,
          notes: textValue(body.notes),
        })
      }

      if (leads.length === 0) {
        console.log('No leads parsed from payload')
        return new Response(JSON.stringify({ success: true, message: 'No leads to process' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Insert leads one-by-one so a single bad row cannot fail the whole batch (Meta would retry -> duplicates)
      const insertedRows: Array<{ id: string; form_id: string | null }> = []
      const errors: Array<{ message: string }> = []
      for (const lead of leads) {
        try {
          const { data: row, error: leadErr } = await supabase.from('leads').insert(lead).select().single()
          if (leadErr) {
            console.error('Lead insert error:', leadErr.message)
            errors.push({ message: leadErr.message })
            continue
          }
          insertedRows.push(row)

          // Ata 14/07 (00:32-00:33): origem com agente SDR NÃO cai na roleta —
          // a IA qualifica primeiro e o sdr_handoff devolve à fila depois.
          const sdr = await maybeStartSdr(supabase, row)
          if (!sdr) {
            const { error: assignErr } = await supabase.rpc('assign_lead', { p_lead_id: row.id })
            if (assignErr) console.error('Lead assignment error:', assignErr.message)
          }
        } catch (e) {
          console.error('Lead insert threw:', e instanceof Error ? e.message : String(e))
          errors.push({ message: e instanceof Error ? e.message : String(e) })
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

/**
 * Se a origem do lead (por form_id) tem agente SDR configurado, abre a conversa
 * e dispara o template de boas-vindas. Devolve true quando o lead entrou no SDR
 * (e portanto não deve ir para a roleta agora).
 */
async function maybeStartSdr(
  supabase: SupabaseClient,
  lead: { id: string; form_id: string | null; phone?: string | null; phone_raw?: string | null; full_name?: string | null },
): Promise<boolean> {
  if (!lead.form_id) return false

  const { data: source } = await supabase
    .from('lead_sources')
    .select('id, sdr_agent_id, welcome_template_id')
    .eq('form_id', lead.form_id)
    .eq('active', true)
    .not('sdr_agent_id', 'is', null)
    .maybeSingle()
  if (!source) return false

  // Liga o lead à origem (relatórios por origem) e abre a conversa.
  await supabase.from('leads').update({ source_id: source.id }).eq('id', lead.id)

  const { data: conv, error: convErr } = await supabase
    .from('sdr_conversations')
    .insert({ lead_id: lead.id, agent_id: source.sdr_agent_id })
    .select('id')
    .single()
  if (convErr) {
    console.error('SDR intake: falha ao abrir conversa —', convErr.message)
    return false // sem conversa o lead segue para a roleta; melhor atender do que sumir
  }

  // Template de boas-vindas. Sem credencial do WhatsApp o envio falha, mas a
  // conversa fica aberta e registrada — nada se perde.
  if (source.welcome_template_id) {
    const { data: tpl } = await supabase
      .from('whatsapp_templates')
      .select('id, name, language, body, approved, active')
      .eq('id', source.welcome_template_id)
      .maybeSingle()
    const to = normalizePhone(lead.phone_raw || lead.phone)
    if (tpl?.active && to) {
      let delivered = false
      try {
        const res = await sendWhatsAppTemplate(to, tpl.name, tpl.language || 'pt_BR', [lead.full_name || 'Cliente'])
        delivered = res.ok
        if (!res.ok) console.error('SDR intake: envio do template falhou para conversa', conv.id)
      } catch (e) {
        console.error('SDR intake: WhatsApp indisponível —', e instanceof Error ? e.message : String(e))
      }
      const { error: msgErr } = await supabase.from('sdr_messages').insert({
        conversation_id: conv.id,
        author: 'system',
        template_id: tpl.id,
        body: delivered
          ? `[template ${tpl.name} enviado] ${tpl.body}`
          : `[template ${tpl.name} pendente de envio] ${tpl.body}`,
      })
      if (msgErr) console.error('SDR intake: falha ao registrar boas-vindas —', msgErr.message)
    }
  }

  console.log('SDR intake: lead', lead.id, 'em qualificação na conversa', conv.id)
  return true
}
