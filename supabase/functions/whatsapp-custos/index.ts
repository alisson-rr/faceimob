import { requireUserPermission } from "../_shared/auth.ts";
import { getSecret } from "../_shared/secrets.ts";
import { MetaApiError, metaGet } from "../_shared/metaGraph.ts";
import { custoDoModeloPorDia, custoPorDia, idDoModelo } from "./custo.ts";

/**
 * Custo do WhatsApp (pedido de 07/11/2026): quanto a Meta cobrou por dia, para
 * comparar com os avisos de lead novo que o CRM mandou. Só leitura.
 *
 * Porta: `settings.integrations`, a mesma da tela de Integrações e da RPC
 * `whatsapp_avisos_por_dia`. Token e conta vêm do cofre; nada disso volta na
 * resposta nem no log.
 *
 * 200 {moeda, dias:[{dia, mensagens, cobradas, custo}]} · 409 sem conta ou
 * token cadastrado · 502 falha da Meta (com a frase).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DIAS_PERMITIDOS = [7, 30, 90] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const gate = await requireUserPermission(req, "settings.integrations", corsHeaders);
  if (gate.denied) return gate.denied;

  const corpo = await req.json().catch(() => null) as { dias?: unknown } | null;
  const dias = DIAS_PERMITIDOS.find((d) => d === corpo?.dias) ?? 30;

  const [token, conta, modelo] = await Promise.all([
    getSecret("META_WHATSAPP_ACCESS_TOKEN"),
    getSecret("META_WHATSAPP_BUSINESS_ACCOUNT_ID"),
    getSecret("META_WHATSAPP_NOTIFY_TEMPLATE"),
  ]);
  if (!conta || !/^\d+$/.test(conta.trim())) {
    return json({
      error: "Cadastre a conta do WhatsApp Business em Integrações (Meta — conta do WhatsApp Business) para ver o custo.",
    }, 409);
  }
  if (!token) return json({ error: "Token do WhatsApp não cadastrado em Integrações." }, 409);

  // Janela em dias inteiros: a Meta agrupa por dia a partir do `start`.
  const fim = Math.floor(Date.now() / 1000);
  const inicio = fim - dias * 86400;
  const campos =
    `currency,pricing_analytics.start(${inicio}).end(${fim}).granularity(DAILY)` +
    `.dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;

  try {
    const resposta = await metaGet<{ currency?: string }>(conta.trim(), { fields: campos }, token);
    const moeda = resposta.currency ?? null;

    // 09/11/2026: o custo é só do modelo do aviso (Integrações › modelo de
    // WhatsApp). Sem modelo cadastrado ou sem as métricas por modelo ligadas na
    // conta, cai para a categoria utilidade e a tela avisa a diferença.
    const nome = modelo?.trim();
    if (nome) {
      try {
        const modelos = await metaGet(`${conta.trim()}/message_templates`, { name: nome, fields: "id,name,language" }, token);
        const id = idDoModelo(modelos, nome);
        if (id) {
          const porModelo = await metaGet(`${conta.trim()}/template_analytics`, {
            start: String(inicio), end: String(fim), granularity: "DAILY",
            template_ids: JSON.stringify([id]),
            metric_types: JSON.stringify(["SENT", "DELIVERED", "READ", "COST"]),
          }, token);
          return json({ moeda, fonte: "modelo", modelo: nome, dias: custoDoModeloPorDia(porModelo) });
        }
      } catch (e) {
        console.warn("whatsapp-custos: métricas do modelo indisponíveis, usando a categoria", e instanceof MetaApiError ? e.status : "rede");
      }
    }
    return json({ moeda, fonte: "categoria", modelo: nome ?? null, dias: custoPorDia(resposta) });
  } catch (e) {
    const frase = e instanceof MetaApiError ? e.message : "Não consegui ler o custo na Meta.";
    console.error("whatsapp-custos: falha na Meta", e instanceof MetaApiError ? e.status : "rede");
    return json({ error: frase }, 502);
  }
});
