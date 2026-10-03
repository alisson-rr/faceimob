// Check offline: node supabase/functions/meta-ads-webhook/check-phone.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Executa o handler verdadeiro; retira só imports e substitui os acessos externos.
const source = ts.createSourceFile('index.ts', readFileSync(new URL('./index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const stripped = ts.createPrinter().printFile(ts.factory.updateSourceFile(source, source.statements.filter(s => !ts.isImportDeclaration(s))))
const compiled = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
let handler, inserted, assignments, graphFields
const fieldData = fields => Object.entries(fields).map(([name, value]) => ({ name, values: [value] }))
const db = {
  from(table) {
    assert.ok(['automation_settings', 'leads', 'lead_sources'].includes(table), `I/O inesperado: ${table}`)
    return {
      select() { return this }, eq() { return this }, not() { return this }, update() { return this },
      insert(lead) { assert.equal(table, 'leads'); inserted = lead; return this },
      async maybeSingle() { return { data: table === 'automation_settings' ? { leads_paused: false } : null } },
      async single() { return { data: { ...inserted, id: 'offline-lead' }, error: null } },
      then(resolve) { resolve({ error: null }) },
    }
  },
  async rpc(name) { assert.equal(name, 'assign_lead'); assignments++; return { error: null } },
}
runInNewContext(compiled, {
  exports: {}, Deno: { env: { get: () => 'offline' }, serve: fn => { handler = fn } },
  createClient: () => db, getMetaPageCredentials: async () => graphFields ? [{ pageId: null, token: 'token-offline' }] : [],
  checkMetaSignature: async () => 'valid', tokenForMetaPage: () => graphFields ? 'token-offline' : '',
  metaGet: async path => { assert.equal(path, 'offline'); return { field_data: fieldData(graphFields) } },
  Request, Response, URL, console: { log() {}, warn() {}, error() {} },
  fetch: () => { throw new Error('Check offline não permite rede') },
})

const phone = '(51) 99999-0000'
const aliases = ['phone_number', 'telefone', 'phone', 'whatsapp', 'número_do_whatsapp', 'whatsapp_number']
const cases = [
  ...aliases.map(key => [{ [key]: phone }, phone]),
  [{}, ''],
  [{ phone_number: phone, whatsapp_number: 'outro' }, phone],
  [{ phone_number: '', whatsapp_number: phone }, phone],
]
async function check(fields, expectedName, expectedPhone, fromGraph = false) {
  inserted = null; assignments = 0
  graphFields = fromGraph ? fields : null
  const response = await handler(new Request('https://offline.test', {
    method: 'POST', headers: { 'x-hub-signature-256': 'assinatura-stub' },
    body: JSON.stringify({ entry: [{ changes: [{ field: 'leadgen', value: {
      leadgen_id: 'offline', field_data: fromGraph ? undefined : fieldData(fields),
    } }] }] }),
  }))
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.leads_processed, 1, JSON.stringify(result))
  assert.equal(result.origem_verificada, true)
  assert.equal(inserted.full_name, expectedName)
  assert.equal(inserted.phone, expectedPhone)
  assert.equal(inserted.phone_raw, expectedPhone)
  assert.equal(assignments, 1)
}
for (const [fields, expected] of cases) await check({ nome_completo: 'Pessoa de teste', ...fields }, 'Pessoa de teste', expected)
const names = [
  [{ ' first name ': 'Pessoa' }, 'Pessoa'],
  [{ ' First   Name ': 'Pessoa', ' LAST NAME ': 'de teste' }, 'Pessoa de teste'],
]
for (const fromGraph of [false, true]) {
  for (const [fields, expected] of names) await check(fields, expected, '', fromGraph)
}
console.log(`Meta webhook: ${cases.length} cenários de telefone e ${names.length * 2} de nome passaram, sem rede nem banco.`)
