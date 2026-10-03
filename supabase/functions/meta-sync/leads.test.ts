// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { metaGet, metaGetAll } from '../_shared/metaGraph.ts'
import { recuperarLeadsMeta } from './leads.ts'

vi.mock('../_shared/metaGraph.ts', () => ({ metaGet: vi.fn(), metaGetAll: vi.fn() }))

const NOW = '2026-10-02T15:10:00.000Z'
const START = '2026-10-02T15:00:00.500Z'
const PAGE = { pageId: '10000', name: null, token: 'token-offline' }
const SECRET = 'segredo-offline'
const CALLBACK = 'https://offline.test/functions/v1/meta-ads-webhook'
const lead = (id = '20001', created_time = '2026-10-02T15:01:00+0000') => ({ id, created_time })

function harness(overrides: Record<string, unknown> = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('crypto', webcrypto)
  const config = { leads_paused: false, meta_leads_started_at: START as string | null, meta_leads_last_sync_at: null as string | null, ...overrides }
  const existing = new Set<string>()
  const updates: Array<{ values: Record<string, string>; guards: Record<string, unknown>; condition: string }> = []
  const db = {
    from(table: string) {
      const guards: Record<string, unknown> = {}
      let values: Record<string, string> = {}
      return {
        select() { return this },
        eq(key: string, value: unknown) { guards[key] = value; return this },
        async single() { expect(table).toBe('automation_settings'); return { data: { ...config }, error: null } },
        async in(_key: string, ids: string[]) { expect(table).toBe('leads'); return { data: ids.filter(id => existing.has(id)).map(external_id => ({ external_id })), error: null } },
        update(next: Record<string, string>) { values = next; return this },
        async or(condition: string) {
          updates.push({ values, guards, condition })
          if (!config.leads_paused && guards.meta_leads_started_at === config.meta_leads_started_at
            && (!config.meta_leads_last_sync_at || config.meta_leads_last_sync_at < values.meta_leads_last_sync_at)) {
            config.meta_leads_last_sync_at = values.meta_leads_last_sync_at
          }
          return { error: null }
        },
      }
    },
  }
  const requests: RequestInit[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(CALLBACK)
    requests.push(init)
    const body = String(init.body)
    expect(new Headers(init.headers).get('x-hub-signature-256')).toBe(`sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`)
    const payload = JSON.parse(body)
    for (const entry of payload.entry) for (const change of entry.changes) existing.add(change.value.leadgen_id)
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return { config, existing, updates, requests, fetch, svc: db as unknown as SupabaseClient }
}

function graph(leads: Array<{ id: string; created_time: string }> = [lead()]) {
  vi.mocked(metaGetAll).mockImplementation(async path => path.endsWith('/leadgen_forms')
    ? [{ id: '30001', leads: { data: [leads[0]] } }, { id: '30002' }, { id: '30003', leads: { data: [] } }]
    : leads)
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })

describe('recuperação de leads da Meta', () => {
  it.each([
    [{ meta_leads_started_at: null }, 'disabled'],
    [{ leads_paused: true }, 'paused'],
  ])('desligada/pausada não consulta a Graph', async (config, flag) => {
    const h = harness(config)
    const result = await recuperarLeadsMeta(h.svc, [], null, CALLBACK)
    expect(result).toMatchObject({ ok: true, [flag]: true })
    expect(metaGetAll).not.toHaveBeenCalled()
    expect(metaGet).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })

  it('usa corte de ativação, todos os formulários, dedup e envelope assinado sem dados pessoais', async () => {
    const h = harness()
    h.existing.add('20001')
    const rows = [lead('19999', '2026-10-02T14:59:59Z'), lead('20000', '2026-10-02T15:00:00Z'), lead(), lead('20002')]
    graph(rows)
    vi.mocked(metaGet).mockResolvedValue({ id: PAGE.pageId })
    const result = await recuperarLeadsMeta(h.svc, [{ ...PAGE, pageId: null }], SECRET, CALLBACK)
    const filter = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(Date.parse(START) / 1000) - 1 }])
    expect(metaGet).toHaveBeenCalledWith('me', { fields: 'id' }, PAGE.token)
    expect(metaGetAll).toHaveBeenCalledWith('10000/leadgen_forms', { fields: `id,leads.limit(1).filtering(${filter}){id,created_time}`, limit: '100' }, PAGE.token)
    expect(metaGetAll).toHaveBeenCalledWith('30001/leads', { fields: 'id,created_time', filtering: filter, limit: '100' }, PAGE.token)
    expect(metaGetAll).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ ok: true, pending: false, encontrados: 2, importados: 1, formularios: 3 })
    expect(JSON.parse(String(h.requests[0].body))).toEqual({ entry: [{ id: '10000', changes: [{ field: 'leadgen', value: { page_id: '10000', form_id: '30001', leadgen_id: '20002' } }] }] })
    expect(h.config.meta_leads_last_sync_at).toBe(NOW)
    expect(h.updates[0].guards).toMatchObject({ meta_leads_started_at: START, leads_paused: false })
    expect(h.updates[0].condition).toBe(`meta_leads_last_sync_at.is.null,meta_leads_last_sync_at.lt.${NOW}`)
  })

  it('inclui o lead criado exatamente no segundo da ativação sem puxar o anterior', async () => {
    const activation = '2026-10-02T15:00:00.000Z'
    const h = harness({ meta_leads_started_at: activation })
    graph([lead('19999', '2026-10-02T14:59:59Z'), lead('20001', activation)])
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: true, encontrados: 1, importados: 1 })
    expect(h.existing.has('19999')).toBe(false)
    expect(h.existing.has('20001')).toBe(true)
  })

  it('sobrepõe 5 minutos e tenta novamente sem avançar o cursor em um 200 sem gravação', async () => {
    const previous = '2026-10-02T15:08:00.000Z'
    const h = harness({ meta_leads_last_sync_at: previous })
    graph([lead('20001', '2026-10-02T15:06:00Z')])
    h.fetch.mockImplementationOnce(async () => new Response('{"success":true,"leads_processed":0}', { status: 200 }))
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: false, pending: true, importados: 0 })
    expect(h.config.meta_leads_last_sync_at).toBe(previous)
    expect(h.updates).toHaveLength(0)
    expect(JSON.parse(vi.mocked(metaGetAll).mock.calls[1][1].filtering)[0].value).toBe(Math.floor(Date.parse(previous) / 1000) - 301)
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: true, importados: 1 })
    expect(h.config.meta_leads_last_sync_at).toBe(NOW)
  })

  it('confirma corrida ou timeout pelo banco, mesmo se a resposta HTTP falha', async () => {
    const h = harness()
    graph()
    h.fetch.mockImplementationOnce(async () => { h.existing.add('20001'); throw new Error('timeout offline') })
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: true, importados: 1 })
    expect(h.updates).toHaveLength(1)
  })

  it('importa até 20 em lotes de 10 e termina a fila no ciclo seguinte', async () => {
    const h = harness()
    const rows = Array.from({ length: 21 }, (_, index) => lead(String(20001 + index)))
    graph(rows)
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: true, pending: true, importados: 20 })
    expect(h.requests.map(request => JSON.parse(String(request.body)).entry.length)).toEqual([10, 10])
    expect(h.updates).toHaveLength(0)
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: true, pending: false, importados: 1 })
    expect(h.updates).toHaveLength(1)
  })

  it('respeita pausa entre descoberta e importação', async () => {
    const h = harness()
    graph()
    vi.mocked(metaGetAll).mockImplementationOnce(async () => { h.config.leads_paused = true; return [{ id: '30001', leads: { data: [lead()] } }] })
    expect(await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).toMatchObject({ ok: true, paused: true, pending: true, importados: 0 })
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })

  it.each([lead('invalido'), lead('20001', 'invalida')])('recusa id/data inválidos sem gravar cursor', async row => {
    const h = harness()
    graph([row])
    await expect(recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)).rejects.toThrow()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.updates).toHaveLength(0)
  })

  it('não regrede cursor mais recente nem avança depois de trocar ativação', async () => {
    const h = harness()
    graph()
    const send = h.fetch.getMockImplementation()!
    h.fetch.mockImplementationOnce(async (...args) => {
      const response = await send(...args)
      h.config.meta_leads_started_at = '2026-10-02T15:09:00.000Z'
      h.config.meta_leads_last_sync_at = '2026-10-02T15:11:00.000Z'
      return response
    })
    await recuperarLeadsMeta(h.svc, [PAGE], SECRET, CALLBACK)
    expect(h.config.meta_leads_last_sync_at).toBe('2026-10-02T15:11:00.000Z')
  })
})

it('handler reserva modo leads à service role e rejeita modo inválido antes da Graph', async () => {
  const source = ts.createSourceFile('index.ts', readFileSync(new URL('./index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const stripped = ts.createPrinter().printFile(ts.factory.updateSourceFile(source, source.statements.filter(node => !ts.isImportDeclaration(node))))
  const compiled = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  let handler: (request: Request) => Promise<Response>
  const recover = vi.fn(async () => ({ ok: true }))
  const from = vi.fn(() => { throw new Error('Não deve consultar contas de anúncios') })
  runInNewContext(compiled, {
    exports: {}, Request, Response, URL,
    Deno: { env: { get: () => 'https://offline.supabase.co' }, serve: (fn: typeof handler) => { handler = fn } },
    requireServiceRole: async (req: Request) => req.headers.get('authorization') === 'Bearer offline-service' ? null : new Response('sem serviço', { status: 401 }),
    requireUserPermission: async () => ({ denied: null, userId: 'offline-user' }),
    serviceClient: () => ({ from }), getMetaPageCredentials: async () => [PAGE], getSecret: async () => SECRET,
    recuperarLeadsMeta: recover,
  })
  for (const [authorization, modo, status] of [['Bearer offline-service', 'leads', 200], ['Bearer offline-user', 'leads', 403], ['Bearer offline-service', 'invalido', 422]] as const) {
    recover.mockClear()
    const response = await handler!(new Request('https://offline.test', { method: 'POST', headers: { authorization }, body: JSON.stringify({ modo }) }))
    expect(response.status).toBe(status)
    expect(recover).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
  }
  expect(from).not.toHaveBeenCalled()
  expect(metaGetAll).not.toHaveBeenCalled()
})
