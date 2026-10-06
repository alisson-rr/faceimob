import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { MetaPageCredential } from '../_shared/metaPageTokens.ts'
import { metaGet, metaGetAll } from '../_shared/metaGraph.ts'

type Settings = { leads_paused: boolean; meta_leads_started_at: string | null; meta_leads_last_sync_at: string | null }
type GraphLead = { id?: unknown; created_time?: unknown }
type GraphForm = { id?: unknown; leads?: { data?: GraphLead[] } }
type Lead = { id: string; pageId: string; formId: string; createdAt: number }

async function settings(svc: SupabaseClient): Promise<Settings> {
  const { data, error } = await svc.from('automation_settings')
    .select('leads_paused,meta_leads_started_at,meta_leads_last_sync_at').eq('id', true).single()
  if (error || !data) throw new Error('Não consegui ler a configuração da recuperação de leads.')
  return data as Settings
}

function graphId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('A Meta devolveu um identificador de lead, formulário ou página inválido.')
  return value
}

function timestamp(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) throw new Error('A data da recuperação de leads é inválida.')
  return parsed
}

async function existingIds(svc: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  // Também limita o tamanho da URL do PostgREST nas primeiras recuperações.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await svc.from('leads').select('external_id').in('external_id', ids.slice(offset, offset + 100))
    if (error || !Array.isArray(data)) throw new Error('Não consegui conferir os leads já gravados.')
    for (const row of data) found.add(row.external_id)
  }
  return found
}

/** Recuperação por API: o webhook existente continua sendo o único ingestador. */
export async function recuperarLeadsMeta(
  svc: SupabaseClient,
  credentials: MetaPageCredential[],
  appSecret: string | null,
  webhookUrl: string,
) {
  const started = new Date().toISOString()
  const initial = await settings(svc)
  const result = { ok: true, pending: false, disabled: false, paused: false, paginas: 0, formularios: 0, encontrados: 0, importados: 0 }
  if (!initial.meta_leads_started_at) return { ...result, disabled: true }
  if (initial.leads_paused) return { ...result, paused: true }
  if (!credentials.length || !appSecret) throw new Error('Faltam credenciais para recuperar os leads da Meta.')

  const activation = timestamp(initial.meta_leads_started_at)
  // ponytail: sobreposição de 5 min cobre entregas atrasadas; ampliar se a Meta atrasar mais.
  const since = Math.floor(Math.max(activation, initial.meta_leads_last_sync_at ? timestamp(initial.meta_leads_last_sync_at) - 300_000 : activation) / 1000) - 1
  const filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }])
  const candidates = new Map<string, Lead>()
  for (const credential of credentials) {
    const pageId = graphId(credential.pageId ?? (await metaGet<{ id?: unknown }>('me', { fields: 'id' }, credential.token)).id)
    const forms = await metaGetAll<GraphForm>(`${pageId}/leadgen_forms`, {
      fields: `id,leads.limit(1).filtering(${filtering}){id,created_time}`, limit: '100',
    }, credential.token)
    result.paginas++
    for (const form of forms) {
      const formId = graphId(form.id)
      result.formularios++
      if (form.leads === undefined) continue
      if (!Array.isArray(form.leads.data)) throw new Error('A Meta devolveu um formulário com uma lista de leads inválida.')
      if (!form.leads.data.length) continue
      for (const sampled of form.leads.data) { graphId(sampled.id); timestamp(sampled.created_time) }
      const leads = await metaGetAll<GraphLead>(`${formId}/leads`, { fields: 'id,created_time', filtering, limit: '100' }, credential.token)
      for (const lead of leads) {
        const id = graphId(lead.id)
        const createdAt = timestamp(lead.created_time)
        if (createdAt < activation || createdAt <= since * 1000) continue
        candidates.set(id, { id, createdAt, pageId, formId })
      }
    }
  }
  result.encontrados = candidates.size
  const found = await existingIds(svc, [...candidates.keys()])
  const missing = [...candidates.values()].filter(lead => !found.has(lead.id)).sort((a, b) => a.createdAt - b.createdAt)
  // ponytail: no máximo 20 por rodada, em lotes de 10; ampliar se a fila crescer.
  result.pending = missing.length > 20
  const importing = missing.slice(0, 20)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  for (let offset = 0; offset < importing.length; offset += 10) {
    const current = await settings(svc)
    if (current.leads_paused) return { ...result, paused: true, pending: true }
    if (current.meta_leads_started_at !== initial.meta_leads_started_at) return { ...result, disabled: !current.meta_leads_started_at, pending: true }
    const batch = importing.slice(offset, offset + 10)
    const body = JSON.stringify({ entry: batch.map(lead => ({ id: lead.pageId, changes: [{ field: 'leadgen', value: {
      page_id: lead.pageId, form_id: lead.formId, leadgen_id: lead.id,
    } }] })) })
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const signature = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    try {
      const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${signature}` }, body, signal: AbortSignal.timeout(90_000) })
      await response.body?.cancel()
    } catch {
      // Um timeout pode acontecer depois da gravação: o banco decide, não o HTTP.
    }
    const confirmed = await existingIds(svc, batch.map(lead => lead.id))
    result.importados += batch.filter(lead => confirmed.has(lead.id)).length
    if (batch.some(lead => !confirmed.has(lead.id))) return { ...result, ok: false, pending: true }
  }
  if (!result.pending) {
    const { error } = await svc.from('automation_settings').update({ meta_leads_last_sync_at: started })
      .eq('id', true).eq('leads_paused', false).eq('meta_leads_started_at', initial.meta_leads_started_at)
      .or(`meta_leads_last_sync_at.is.null,meta_leads_last_sync_at.lt.${started}`)
    if (error) throw new Error('Não consegui gravar a última recuperação de leads.')
  }
  return result
}
