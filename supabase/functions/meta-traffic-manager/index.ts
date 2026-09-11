import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole, requireUserPermission, serviceClient } from "../_shared/auth.ts";
import { chatJson } from "../_shared/openai.ts";
import { getSecret } from "../_shared/secrets.ts";
import {
  type AcaoGestor, type CampanhaDoGestor, type ContaDoGestor, type MetricaDaCampanha, montarPedidoGestor,
  periodosDoGestor, PROMPT_GESTOR, TETO_TOKENS_GESTOR, validarGestor,
} from "./validar.ts";

/**
 * Gestor de tráfego IA (F2.2): lê os números da conta no banco, faz UMA
 * chamada de IA (nota 0-100, até 3 alertas, até 3 ações), valida a resposta
 * (validar.ts) e põe cada ação válida na fila como PROPOSTA de 24 h. Nada
 * executa daqui: não há chamada à Meta nesta function. Quem executa é o
 * meta-campaign-action, depois de uma pessoa aprovar, com a mesma permissão e
 * o mesmo executor da ação manual.
 *
 * Portas:
 *   - service role (cron da 0119): todas as contas ligadas, ou a do corpo;
 *   - navegador: `marketing.meta_manage` aqui e de novo no banco
 *     (`meta_ai_run_start` com o cliente do usuário), uma conta por vez.
 *
 * Custo previsível: o cron é uma execução por conta e dia (índice único); o
 * manual reaproveita a execução ok de até 10 min, e aí nenhuma IA é paga.
 * Sem chave da OpenAI, ou sem entrega no período, a execução fica "falhou"
 * com a frase — nunca uma nota inventada.
 *
 * Corpo {account_id?: uuid} · 200 {ok, runs:[{account_id, run_id, status,
 * reused, propostas, descartadas, erro?}]} · 403/422 recusa do banco no
 * manual · 422 corpo inválido. Nada do prompt, da resposta nem de chave no log.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEM_CHAVE =
  "Chave da OpenAI ausente: cadastre-a em Admin → Integrações (OpenAI — chave de API). Nenhuma análise foi feita.";

type Status = "rodando" | "ok" | "falhou";
type Run = {
  account_id: string;
  run_id: string | null;
  status: Status;
  reused: boolean;
  propostas: number;
  descartadas: number;
  erro?: string;
};
type Uso = { model: string | null; tokensIn: number; tokensOut: number };

const mensagem = (e: unknown) => (e instanceof Error ? e.message : "Falha sem mensagem.").slice(0, 400);

/** Corpo {account_id?}. O navegador precisa dizer a conta; só o cron roda todas. */
function lerPedido(body: unknown, servico: boolean): { account_id: string | null } | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.account_id === undefined || b.account_id === null) return servico ? { account_id: null } : null;
  return typeof b.account_id === "string" && UUID.test(b.account_id) ? { account_id: b.account_id } : null;
}

/** Cliente com o JWT de quem chamou: `has_permission` e `auth.uid()` na RPC são do usuário. */
function clienteDoUsuario(req: Request): SupabaseClient {
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
  if (error) console.error("meta-traffic-manager: meta_ai_run_finish recusou", error.code ?? "-");
  return !error;
}

/**
 * Põe a ação na fila (meta_action_propose: as mesmas travas da ação manual e
 * só em campanha da conta analisada). Proposta igual já aberta continua
 * valendo e é a que aparece. null = o banco recusou.
 */
async function propor(db: SupabaseClient, runId: string, a: AcaoGestor): Promise<{ id: string; nova: boolean } | null> {
  const { data, error } = await db.rpc("meta_action_propose", {
    p_ai_run_id: runId,
    p_campaign_id: a.campaign_id,
    p_acao: a.acao,
    p_verba_nova: a.verba_nova ?? null,
    p_motivo: a.motivo,
  });
  if (error) {
    console.error("meta-traffic-manager: meta_action_propose recusou", error.code ?? "-");
    return null;
  }
  if (typeof data === "string") return { id: data, nova: true };
  const { data: aberta } = await db
    .from("meta_actions").select("id")
    .eq("campaign_id", a.campaign_id).eq("acao", a.acao).eq("status", "proposta")
    .maybeSingle();
  return aberta ? { id: (aberta as { id: string }).id, nova: false } : null;
}

/** `uso` é preenchido assim que a IA responde: se a validação reprovar, o custo fica registrado mesmo assim. */
async function analisar(db: SupabaseClient, contaId: string, runId: string, uso: Uso) {
  const { data: conta, error } = await db
    .from("meta_ad_accounts")
    .select("name, timezone_name, balance_state, is_prepay, prepay_available, last_sync_ok_at")
    .eq("id", contaId)
    .single();
  if (error || !conta) throw new Error("Não consegui ler a conta de anúncios no banco.");

  const { atual, anterior } = periodosDoGestor(new Date(), conta.timezone_name || "America/Sao_Paulo");
  const [mAtual, mAnterior, campanhas] = await Promise.all([
    db.rpc("meta_metricas", { p_from: atual.inicio, p_to: atual.fim }),
    db.rpc("meta_metricas", { p_from: anterior.inicio, p_to: anterior.fim }),
    db.from("ad_campaigns")
      .select("id, external_id, name, status, daily_budget, meta_budget_level, meta_channel")
      .eq("meta_account_id", contaId),
  ]);
  if (mAtual.error || mAnterior.error) throw new Error("Não consegui ler os números da Meta no banco.");
  if (campanhas.error) throw new Error("Não consegui ler as campanhas da conta no banco.");

  // meta_metricas devolve todas as contas: fica só a analisada.
  const daConta = (linhas: unknown) =>
    ((linhas ?? []) as (MetricaDaCampanha & { account_id: string | null })[]).filter((m) => m.account_id === contaId);
  const pedido = montarPedidoGestor({
    conta: conta as ContaDoGestor,
    atual,
    anterior,
    campanhas: (campanhas.data ?? []) as CampanhaDoGestor[],
    metricas: daConta(mAtual.data),
    metricasAnterior: daConta(mAnterior.data),
  });

  const ia = await chatJson<unknown>({ system: PROMPT_GESTOR, user: pedido.user, maxTokens: TETO_TOKENS_GESTOR });
  Object.assign(uso, { model: ia.model, tokensIn: ia.tokensIn, tokensOut: ia.tokensOut });
  const v = validarGestor(ia.data, pedido.enviadas);

  const acoes = [];
  let propostas = 0;
  let descartadas = v.descartadas;
  for (const a of v.acoes) {
    const fila = await propor(db, runId, a);
    if (!fila) {
      descartadas++;
      continue;
    }
    if (fila.nova) propostas++;
    acoes.push({
      action_id: fila.id,
      acao: a.acao,
      campaign_external_id: a.campaign_external_id,
      campaign_name: a.campaign_name,
      ...(a.verba_nova !== undefined ? { verba_nova: a.verba_nova } : {}),
      motivo: a.motivo,
    });
  }

  return {
    result: {
      nota: v.nota,
      resumo: v.resumo,
      alertas: v.alertas,
      acoes,
      periodo: atual,
      periodo_anterior: anterior,
      dados_ate: (conta as ContaDoGestor).last_sync_ok_at,
      descartadas,
    },
    propostas,
    descartadas,
  };
}

/** Uma conta: abre (ou reaproveita) a execução, analisa e encerra. Nunca lança. */
async function rodarConta(db: SupabaseClient, contaId: string, usuario: Request | null): Promise<{ run: Run; http: number }> {
  const run: Run = { account_id: contaId, run_id: null, status: "falhou", reused: false, propostas: 0, descartadas: 0 };

  const { data, error } = await (usuario ? clienteDoUsuario(usuario) : db).rpc("meta_ai_run_start", {
    p_kind: "gestor",
    p_account_id: contaId,
    p_trigger: usuario ? "manual" : "cron",
    p_params: {},
  });
  if (error) {
    console.error("meta-traffic-manager: meta_ai_run_start recusou", error.code ?? "-");
    const http = error.code === "42501" ? 403 : error.code === "22023" ? 422 : 500;
    return { run: { ...run, erro: error.message }, http };
  }
  const aberta = (Array.isArray(data) ? data[0] : data) as { run_id?: string; reused?: boolean } | null;
  if (!aberta?.run_id) return { run: { ...run, erro: "A análise não foi aberta no banco." }, http: 500 };
  const runId = aberta.run_id;

  if (aberta.reused) {
    // Nenhuma chamada de IA: devolve a situação da execução reaproveitada.
    const { data: linha } = await db.from("meta_ai_runs").select("status, error").eq("id", runId).maybeSingle();
    const r = linha as { status: Status; error: string | null } | null;
    return {
      run: { ...run, run_id: runId, reused: true, status: r?.status ?? "rodando", ...(r?.error ? { erro: r.error } : {}) },
      http: 200,
    };
  }

  const uso: Uso = { model: null, tokensIn: 0, tokensOut: 0 };
  try {
    // "Sem chave" é decidido aqui, e não na dispatch: o SQL não enxerga a
    // chave que mora só no secret da function.
    if (!(await getSecret("OPENAI_API_KEY"))) throw new Error(SEM_CHAVE);
    const r = await analisar(db, contaId, runId, uso);
    if (!(await encerrar(db, runId, { status: "ok", result: r.result, ...uso }))) {
      throw new Error("A análise terminou, mas não consegui gravar o resultado. Tente de novo.");
    }
    return { run: { ...run, run_id: runId, status: "ok", propostas: r.propostas, descartadas: r.descartadas }, http: 200 };
  } catch (e) {
    const erro = mensagem(e);
    console.error("meta-traffic-manager: análise falhou");
    await encerrar(db, runId, { status: "falhou", erro, ...uso });
    return { run: { ...run, run_id: runId, erro }, http: 200 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const servico = (await requireServiceRole(req, corsHeaders)) === null;
  if (!servico) {
    const gate = await requireUserPermission(req, "marketing.meta_manage", corsHeaders);
    if (gate.denied) return gate.denied;
  }

  const pedido = lerPedido(await req.json().catch(() => null), servico);
  if (!pedido) return json({ ok: false, error: "Pedido inválido: envie {account_id} com o id da conta de anúncios." }, 422);

  const db = serviceClient();
  let contas = pedido.account_id ? [pedido.account_id] : [];
  if (!pedido.account_id) {
    const { data, error } = await db.from("meta_ad_accounts").select("id").eq("enabled", true);
    if (error) {
      console.error("meta-traffic-manager: leitura das contas falhou", error.code ?? "-");
      return json({ ok: false, error: "Não consegui listar as contas de anúncios." }, 500);
    }
    contas = ((data ?? []) as { id: string }[]).map((c) => c.id);
  }

  // Em paralelo: uma chamada de IA por conta, e o tempo total é o da mais lenta.
  const feitos = await Promise.all(contas.map((id) => rodarConta(db, id, servico ? null : req)));
  const runs = feitos.map((f) => f.run);
  const recusa = servico ? undefined : feitos.find((f) => f.http !== 200);
  if (recusa) return json({ ok: false, error: recusa.run.erro, runs }, recusa.http);
  return json({ ok: runs.every((r) => r.status !== "falhou"), runs });
});
