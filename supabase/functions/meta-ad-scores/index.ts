import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserPermission, serviceClient } from "../_shared/auth.ts";
import { descreverFalhaMeta } from "../_shared/metaErros.ts";
import { actId, MetaApiError, metaGetAll, metaToken } from "../_shared/metaAds.ts";
import type { Canal } from "../_shared/metaInsights.ts";
import { chatJson } from "../_shared/openai.ts";
import {
  aplicarAvaliacoes, type Avaliacao, DIAS_PERMITIDOS, type Dias, type LinhaInsight, montarPedidoIA,
  periodoDaAnalise, prepararAnuncios, PROMPT_NOTA, TETO_TOKENS_IA, validarSaidaIA,
} from "./nota.ts";

/**
 * Nota por anúncio (F2.1): lê os anúncios da conta na Meta, calcula as
 * métricas e a amostra mínima no código (nota.ts) e faz UMA chamada de IA com
 * os 40 de maior gasto. O resultado fica em `meta_ai_runs` e a tela lê de lá.
 *
 * Porta: `marketing.meta_manage`, aqui (requireUserPermission) e de novo no
 * banco (`meta_ai_run_start`, com o cliente do usuário). A conta vem do banco,
 * nunca do corpo: o act_ é o de `meta_ad_accounts`.
 *
 * Custo previsível: a RPC reaproveita a análise igual de até 10 min (ou a que
 * ainda roda há menos de 5), e aí nenhuma chamada nova é feita. Sem anúncio
 * para julgar, não há chamada de IA.
 *
 * Falha da Meta ou da IA: a execução fica "falhou" com a frase, e a tela
 * mostra isso junto da última análise boa. Nada de nota inventada.
 *
 * 200 {ok:true, run_id, reused} · 409 sem token · 422 corpo inválido ·
 * 502 {ok:false, run_id, error}. Nenhuma URL nem token no log.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SEM_TOKEN =
  "Token da Marketing API não cadastrado. Cole o token de usuário de sistema (ads_read e ads_management) no campo " +
  "'Meta — token da Marketing API', em Admin → Meta Ads, e analise de novo.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pedido = { account_id: string; dias: Dias };
type Uso = { model: string | null; tokensIn: number; tokensOut: number };

function lerPedido(body: unknown): Pedido | null {
  const b = body as { account_id?: unknown; dias?: unknown } | null;
  const dias = DIAS_PERMITIDOS.find((d) => d === b?.dias);
  if (typeof b?.account_id !== "string" || !UUID.test(b.account_id) || !dias) return null;
  return { account_id: b.account_id, dias };
}

/** Cliente com o JWT de quem chamou: `auth.uid()` e `has_permission` na RPC são do usuário. */
function clienteDoUsuario(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
}

async function encerrar(
  db: SupabaseClient,
  runId: string,
  fim: { status: "ok" | "falhou"; result?: unknown; erro?: string } & Uso,
): Promise<boolean> {
  const { error } = await db.rpc("meta_ai_run_finish", {
    p_run_id: runId,
    p_status: fim.status,
    p_result: fim.result ?? null,
    p_error: fim.erro ?? null,
    p_model: fim.model,
    p_tokens_in: fim.tokensIn,
    p_tokens_out: fim.tokensOut,
  });
  if (error) console.error("meta-ad-scores: meta_ai_run_finish recusou", error.code);
  return !error;
}

/** `uso` é preenchido assim que a IA responde: se a validação reprovar, o custo fica registrado mesmo assim. */
async function analisar(db: SupabaseClient, pedido: Pedido, token: string, uso: Uso) {
  const { data: conta, error } = await db
    .from("meta_ad_accounts").select("act_id, timezone_name").eq("id", pedido.account_id).single();
  if (error || !conta) throw new Error("Não consegui ler a conta de anúncios no banco.");

  const periodo = periodoDaAnalise(pedido.dias, new Date(), conta.timezone_name || "America/Sao_Paulo");
  const act = actId(conta.act_id);

  const [linhas, ads, campanhas] = await Promise.all([
    metaGetAll<LinhaInsight>(`${act}/insights`, {
      level: "ad",
      time_range: JSON.stringify({ since: periodo.inicio, until: periodo.fim }),
      fields: "ad_id,ad_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,actions",
      limit: "500",
    }, token),
    metaGetAll<{ id?: string; effective_status?: string }>(`${act}/ads`, { fields: "id,effective_status", limit: "500" }, token),
    db.from("ad_campaigns").select("external_id, meta_channel").eq("meta_account_id", pedido.account_id),
  ]);
  if (campanhas.error) throw new Error("Não consegui ler o canal das campanhas no banco.");

  // O canal gravado pela sincronização (canalDaCampanha), o mesmo que o painel mostra.
  const canais = new Map<string, Canal>();
  for (const c of (campanhas.data ?? []) as { external_id: string; meta_channel: Canal | null }[]) {
    if (c.meta_channel) canais.set(c.external_id, c.meta_channel);
  }
  const prep = prepararAnuncios(linhas, canais);

  let avaliacoes: Avaliacao[] = [];
  if (prep.paraIA.length > 0) {
    const ia = await chatJson<unknown>({ system: PROMPT_NOTA, user: montarPedidoIA(periodo, prep), maxTokens: TETO_TOKENS_IA });
    Object.assign(uso, { model: ia.model, tokensIn: ia.tokensIn, tokensOut: ia.tokensOut });
    avaliacoes = validarSaidaIA(ia.data, new Set(prep.paraIA.map((a) => a.ad_id)));
  }

  const status = new Map(ads.map((a) => [a.id ?? "", a.effective_status ?? null]));
  const anuncios = aplicarAvaliacoes(prep.anuncios, avaliacoes)
    .map((a) => ({ ...a, status: status.get(a.ad_id) ?? null }));
  return { periodo, medias: prep.medias, anuncios };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const gate = await requireUserPermission(req, "marketing.meta_manage", corsHeaders);
  if (gate.denied) return gate.denied;

  const pedido = lerPedido(await req.json().catch(() => null));
  if (!pedido) {
    return json({ ok: false, error: "Pedido inválido: envie {account_id, dias} com dias 7, 14, 30 ou 60." }, 422);
  }

  const { data, error } = await clienteDoUsuario(req).rpc("meta_ai_run_start", {
    p_kind: "nota_anuncios",
    p_account_id: pedido.account_id,
    p_trigger: "manual",
    p_params: { dias: pedido.dias },
  });
  if (error) {
    console.error("meta-ad-scores: meta_ai_run_start recusou", error.code);
    return json({ ok: false, error: error.message }, error.code === "42501" ? 403 : 400);
  }
  const run = (Array.isArray(data) ? data[0] : data) as { run_id?: string; reused?: boolean } | null;
  if (!run?.run_id) return json({ ok: false, error: "A análise não foi aberta no banco." }, 500);
  if (run.reused) return json({ ok: true, run_id: run.run_id, reused: true });

  const db = serviceClient();
  const uso: Uso = { model: null, tokensIn: 0, tokensOut: 0 };
  try {
    const token = await metaToken();
    if (!token) {
      await encerrar(db, run.run_id, { status: "falhou", erro: SEM_TOKEN, ...uso });
      return json({ ok: false, run_id: run.run_id, error: SEM_TOKEN }, 409);
    }
    const result = await analisar(db, pedido, token, uso);
    if (!(await encerrar(db, run.run_id, { status: "ok", result, ...uso }))) {
      throw new Error("A análise terminou, mas não consegui gravar o resultado. Tente de novo.");
    }
    return json({ ok: true, run_id: run.run_id, reused: false });
  } catch (e) {
    const erro = descreverFalhaMeta(e);
    console.error(
      "meta-ad-scores: análise falhou",
      e instanceof MetaApiError ? `meta status=${e.status} code=${e.code ?? "-"}` : "ia, banco ou validação",
    );
    await encerrar(db, run.run_id, { status: "falhou", erro, ...uso });
    return json({ ok: false, run_id: run.run_id, error: erro }, 502);
  }
});
