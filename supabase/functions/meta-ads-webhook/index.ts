import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getSecret } from '../_shared/secrets.ts'
import { requireServiceRole } from '../_shared/auth.ts'
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

      let body: MetaPayload = {}
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as MetaPayload
      } catch {
        console.warn('meta-ads-webhook: payload JSON inválido')
      }

      // ---------------------------------------------------------------------
      // Duas entradas, duas provas de origem — e nenhuma delas é "nenhuma".
      //
      // 1. Payload da Meta (`entry[].changes[]`): a prova é a assinatura
      //    X-Hub-Signature-256. Sem `META_APP_SECRET` cadastrado NÃO existe o
      //    que conferir, e a versão anterior aceitava assim mesmo — mesmo
      //    buraco que o `whatsapp-inbound-webhook` fechou nesta sprint. Agora
      //    recusa nos dois casos (inválida e sem segredo): sem o app secret o
      //    webhook nem chega a ser registrado no painel da Meta, então nada
      //    legítimo se perde.
      //
      // 2. POST direto (Zapier/Make/N8N): não existe assinatura da Meta para
      //    conferir, e a checagem acima recusaria o integrador no instante em
      //    que o app secret fosse cadastrado. Por isso o contrato é separado:
      //    o lead continua sendo aceito — é uma entrada pública, como um
      //    formulário do site — mas SEM prova de origem ele não aciona a IA.
      //    `maybeStartSdr` manda template de WhatsApp para o número que veio
      //    no CORPO da requisição e abre conversa que gasta crédito da OpenAI
      //    a cada resposta: com a URL pública, isso é amplificação. Sem prova,
      //    o lead é gravado e vai para a roleta, onde um humano o atende.
      // ---------------------------------------------------------------------
      let origemProvada = false
      if (Array.isArray(body.entry)) {
        const sig = await checkMetaSignature(raw, req.headers.get('x-hub-signature-256'))
        if (sig !== 'valid') {
          console.error(`meta-ads-webhook: payload da Meta sem assinatura válida (${sig}) — POST recusado`)
          return new Response(JSON.stringify({
            error: sig === 'unconfigured' ? 'Webhook não configurado.' : 'Assinatura inválida.',
            detail: sig === 'unconfigured'
              ? 'Cadastre meta/app_secret em Admin → Integrações para validar a assinatura da Meta.'
              : 'O corpo não confere com o X-Hub-Signature-256 deste app.',
          }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        origemProvada = true
      } else {
        // A chave de serviço é a prova que as NOSSAS integrações (e a suíte
        // E2E) têm; ela nunca vai para integrador de terceiro. A `Response` de
        // recusa é descartada de propósito: aqui ela só responde "provou?".
        origemProvada = (await requireServiceRole(req, corsHeaders)) === null
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
          // O corretor que receber este lead precisa saber por que a IA não
          // falou com ele antes.
          notes: [
            textValue(body.notes),
            origemProvada ? '' : '[origem não verificada: POST sem assinatura da Meta nem chave de serviço]',
          ].filter(Boolean).join(' '),
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
          const sdr = await maybeStartSdr(supabase, row, origemProvada)
          if (!sdr) {
            // Falha aqui não perde o lead: ele fica 'queued' e o cron
            // `assign_queued_leads` (0013) tenta de novo na próxima varredura.
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
        // Diz ao integrador por que a IA não entrou, em vez de sumir em silêncio.
        origem_verificada: origemProvada,
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
 * Apelidos aceitos para cada placeholder do template — mesma tabela de
 * `sdr-whatsapp-broadcast` e de `src/components/sdr/templateVars.ts`. É
 * `whatsapp_templates.variables` que decide QUANTOS parâmetros vão no envio:
 * as boas-vindas mandavam sempre 1 e o broadcast sempre 2, então o mesmo
 * template quebrava num dos dois caminhos. Mudou aqui, muda lá.
 */
const VAR_ALIASES: Record<string, string[]> = {
  nome: ['nome', 'name', 'cliente', 'contato', '1'],
  campanha: ['campanha', 'campaign', 'origem', '2'],
}

function templateParams(variables: string[] | null | undefined, values: Record<string, string>): string[] {
  return (variables ?? []).map((raw) => {
    const key = String(raw).trim().toLowerCase()
    for (const [canonical, aliases] of Object.entries(VAR_ALIASES)) {
      if (aliases.includes(key)) return values[canonical]?.trim() || '-'
    }
    return values[key]?.trim() || '-'
  })
}

/**
 * Se a origem do lead tem agente SDR configurado, abre a conversa e dispara o
 * template de boas-vindas. Devolve true quando o lead entrou no SDR (e portanto
 * não deve ir para a roleta agora).
 *
 * A origem casa por `form_id` (Meta Lead Ads) ou, sem form_id, pelo `code` da
 * origem igual ao `utm_source` do lead — é o `source` que o Zapier/POST manual
 * manda. Sem a segunda regra o campo de código da aba Origens não filtrava nada.
 *
 * **Só entra na IA quem provou a origem** (`origemProvada`). O `code` é um slug
 * legível que a própria aba Origens gera, então um POST anônimo com
 * `{name, phone, source}` faria a WABA do cliente mandar template para um número
 * escolhido por quem chamou e abriria conversa que gasta crédito da OpenAI. Sem
 * prova, o lead fica ligado à origem (relatório por canal) e vai para a roleta.
 *
 * **Lead sem telefone volta para a roleta.** A versão anterior abria a conversa
 * e devolvia true mesmo sem número: nada era enviado, o `whatsapp-inbound-webhook`
 * casa a resposta POR TELEFONE, e o lead ficava sem robô e fora da fila de todo
 * corretor. Buraco silencioso — melhor um humano atendendo.
 */
async function maybeStartSdr(
  supabase: SupabaseClient,
  lead: {
    id: string; form_id: string | null; utm_source?: string | null;
    phone?: string | null; phone_raw?: string | null; full_name?: string | null;
  },
  origemProvada: boolean,
): Promise<boolean> {
  const utmSource = (lead.utm_source || '').trim().toLowerCase()
  if (!lead.form_id && !utmSource) return false

  const bySource = supabase
    .from('lead_sources')
    .select('id, label, sdr_agent_id, welcome_template_id')
    .eq('active', true)
    .not('sdr_agent_id', 'is', null)
  // `code` é slug minúsculo e único; igualdade exata evita uma origem roubar
  // lead de outra por substring ('portal' vs 'portal_zap').
  const { data: source, error: sourceErr } = await (lead.form_id
    ? bySource.eq('form_id', lead.form_id)
    : bySource.eq('code', utmSource)
  ).maybeSingle()
  // Falha de leitura (rede, RLS, duas origens no mesmo código) não pode ser
  // indistinguível de "não há origem": o lead segue para a roleta — melhor um
  // humano do que ninguém —, mas com rastro de POR QUE não entrou na IA.
  if (sourceErr) {
    console.error('SDR intake: falha ao consultar lead_sources para o lead', lead.id, '—', sourceErr.message)
    return false
  }
  if (!source) return false

  // Liga o lead à origem — é daqui que sai o relatório por canal, e vale mesmo
  // quando o lead acaba indo para a roleta.
  const { error: linkErr } = await supabase.from('leads').update({ source_id: source.id }).eq('id', lead.id)
  if (linkErr) console.error('SDR intake: falha ao vincular o lead', lead.id, 'à origem —', linkErr.message)

  if (!origemProvada) {
    console.warn('SDR intake: lead', lead.id, 'casou com origem de IA, mas o POST não provou origem — segue para a roleta')
    return false
  }

  const to = normalizePhone(lead.phone_raw || lead.phone)
  if (!to) {
    console.log('SDR intake: lead', lead.id, 'sem telefone — segue para a roleta')
    return false
  }

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
      .select('id, name, language, body, approved, active, variables')
      .eq('id', source.welcome_template_id)
      .maybeSingle()
    if (tpl?.active) {
      // Template não aprovado na Meta é recusado pela Graph API fora da janela
      // de 24 h. O broadcast já conferia; aqui não — e o operador só descobria
      // pelo silêncio. Agora fica registrado o motivo na própria conversa.
      let delivered = false
      let motivo = ''
      if (!tpl.approved) {
        motivo = 'não está marcado como aprovado na Meta'
      } else {
        try {
          const res = await sendWhatsAppTemplate(
            to, tpl.name, tpl.language || 'pt_BR',
            templateParams(tpl.variables as string[] | null, {
              nome: lead.full_name || 'Cliente',
              campanha: source.label || '',
            }),
          )
          delivered = res.ok
          if (!res.ok) {
            motivo = 'a Meta recusou o envio'
            console.error('SDR intake: envio do template falhou para conversa', conv.id)
          }
        } catch (e) {
          motivo = 'falta credencial do WhatsApp no cofre'
          console.error('SDR intake: WhatsApp indisponível —', e instanceof Error ? e.message : String(e))
        }
      }
      const { error: msgErr } = await supabase.from('sdr_messages').insert({
        conversation_id: conv.id,
        author: 'system',
        template_id: tpl.id,
        body: delivered
          ? `[template ${tpl.name} enviado] ${tpl.body}`
          : `[template ${tpl.name} NÃO enviado: ${motivo}] ${tpl.body}`,
      })
      if (msgErr) console.error('SDR intake: falha ao registrar boas-vindas —', msgErr.message)
    }
  }

  console.log('SDR intake: lead', lead.id, 'em qualificação na conversa', conv.id)
  return true
}
