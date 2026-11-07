/**
 * Teste manual do LeadConfirmado (0322) na aba "Eventos de teste" da Meta.
 *
 * Monta UM evento com dado fictício pelo mesmo `payload.ts` da edge e, só com
 * `--enviar`, manda com `test_event_code` (a Meta mostra na aba de teste e não
 * usa para otimizar). Não lê nem marca nada na fila do banco.
 *
 *   deno run --allow-env --allow-net scripts/meta-capi-teste.ts            # só mostra o payload
 *   deno run --allow-env --allow-net scripts/meta-capi-teste.ts --enviar   # envia ao Test Events
 *   ... --whatsapp   # monta o evento do clique-para-WhatsApp em vez do formulário
 *
 * Lê do ambiente (nunca de arquivo): META_CAPI_ACCESS_TOKEN, META_CAPI_DATASET_ID,
 * META_TEST_EVENT_CODE e, com --whatsapp, META_WHATSAPP_BUSINESS_ACCOUNT_ID.
 */
import { corpoDoLote, eventoParaMeta, LEAD_CONFIRMADO } from "../supabase/functions/meta-crm-events/payload.ts";
import { META_GRAPH } from "../supabase/functions/_shared/metaGraph.ts";

const enviar = Deno.args.includes("--enviar");
const whatsapp = Deno.args.includes("--whatsapp");
const env = (k: string) => Deno.env.get(k)?.trim() || "";

const evento = await eventoParaMeta({
  id: crypto.randomUUID(),
  event_name: LEAD_CONFIRMADO,
  event_time: new Date().toISOString(),
  leadgen_id: whatsapp ? null : "100000000000001",
  phone: "5511900000000",
  email: whatsapp ? null : "teste@exemplo.test",
  ctwa_clid: whatsapp ? "TESTE_CTWA_CLID" : null,
}, { wabaId: env("META_WHATSAPP_BUSINESS_ACCOUNT_ID") || (enviar ? "" : "0") });

if (!evento) {
  console.error("evento não montou (com --whatsapp, defina META_WHATSAPP_BUSINESS_ACCOUNT_ID).");
  Deno.exit(1);
}
console.log(JSON.stringify(evento, null, 2));
if (!enviar) Deno.exit(0);

const [token, conjunto, codigo] = [env("META_CAPI_ACCESS_TOKEN"), env("META_CAPI_DATASET_ID"), env("META_TEST_EVENT_CODE")];
if (!token || !/^[0-9]+$/.test(conjunto) || !codigo) {
  console.error("faltam META_CAPI_ACCESS_TOKEN, META_CAPI_DATASET_ID ou META_TEST_EVENT_CODE no ambiente.");
  Deno.exit(1);
}
const res = await fetch(`${META_GRAPH}/${conjunto}/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: corpoDoLote([evento], token, codigo),
});
console.log(res.status, await res.text());
