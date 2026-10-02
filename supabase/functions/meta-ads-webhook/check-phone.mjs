// Check offline: node supabase/functions/meta-ads-webhook/check-phone.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Executa o handler verdadeiro; retira só imports e substitui os acessos externos.
const source = ts.createSourceFile('index.ts', readFileSync(new URL('./index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
const stripped = ts.createPrinter().printFile(ts.factory.updateSourceFile(source, source.statements.filter(s => !ts.isImportDeclaration(s))))
const compiled = ts.transpileModule(stripped, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
let handler, inserted, assignments
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
  createClient: () => db, getMetaPageCredentials: async () => [],
  checkMetaSignature: async () => 'valid', tokenForMetaPage: () => '',
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
for (const [fields, expected] of cases) {
  inserted = null; assignments = 0
  const response = await handler(new Request('https://offline.test', {
    method: 'POST', headers: { 'x-hub-signature-256': 'assinatura-stub' },
    body: JSON.stringify({ entry: [{ changes: [{ field: 'leadgen', value: {
      leadgen_id: 'offline', field_data: Object.entries({ nome_completo: 'Pessoa de teste', ...fields }).map(([name, value]) => ({ name, values: [value] })),
    } }] }] }),
  }))
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.leads_processed, 1, JSON.stringify(result))
  assert.equal(result.origem_verificada, true)
  assert.equal(inserted.full_name, 'Pessoa de teste')
  assert.equal(inserted.phone, expected)
  assert.equal(inserted.phone_raw, expected)
  assert.equal(assignments, 1)
}
console.log(`Meta webhook: ${cases.length} cenários de telefone passaram, sem rede nem banco.`)
