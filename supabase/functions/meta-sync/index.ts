import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireServiceRole, requireUserPermission, serviceClient } from "../_shared/auth.ts";
import { descreverFalhaMeta } from "../_shared/metaErros.ts";
import { actId, MetaApiError, metaGet, metaGetAll, metaToken } from "../_shared/metaAds.ts";
import {
  type GraphAccount, type GraphAdset, type GraphCampaign, type GraphInsight,
  hojeNoFuso, janelaPedida, montarConta, montarPayload,
} from "./montar.ts";

/**
 * Sincronização com a Marketing API (F1.2), que dispara os alertas (F1.5/F1.6).
 *
 * Portas: service role (pg_cron, 0118) ou usuário com marketing.meta_manage
 * (manual, conferido no banco por has_permission).
 *
 * Body {account_id?: uuid, dias?: 1..90, modo?: 'completo' | 'estado'}.
 *  - completo (padrão): por conta, lê conta, campanhas, conjuntos e insights
 *    diários e grava tudo numa transação (meta_sync_apply). Se QUALQUER chamada
 *    à Meta falhar, a execução vira 'falhou' com a frase e nada toca o livro, os
 *    insights nem o estado da conta.
 *  - estado (cron de hora em hora): só act_X com status, bloqueio, limite e
 *    saldo — sem insights, sem IA — e a avaliação só do estado da conta.
 *
 * 200 {ok, contas:[{account_id, run_id, status, erro?, dias?, campanhas?, conflitos?}]}
 * 409 sem token: no modo completo cada conta ganha a execução 'falhou' com a
 * frase e o alerta sync_falhou (aberto uma vez, fecha na próxima ok).
 * Nenhuma chamada de IA. Nenhuma URL nem token no log.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SEM_TOKEN =
  "Token da Marketing API não cadastrado: nenhum número da Meta foi atualizado. Cole o token de usuário de sistema " +
  "(ads_read e ads_management) em 'Meta — token da Marketing API', em Admin → Meta Ads.";

const CAMPOS_CONTA = [
  "name", "currency", "timezone_name", "account_status", "disable_reason",
  "is_prepay_account", "amount_spent", "spend_cap", "funding_source_details",
];
const CAMPOS_ESTADO = [
  "account_status", "disable_reason", "spend_cap", "amount_spent", "funding_source_details", "is_prepay_account",
];
// Sem o filtro, /campaigns e /adsets deixam ARCHIVED de fora. DELETED não é
// listável aqui: a campanha apagada chega pelos insights (montar.ts).
const STATUS_CAMPANHA = JSON.stringify(["ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"]);
const STATUS_CONJUNTO = JSON.stringify(["ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES"]);
// Gasto de campanha arquivada ou apagada dentro da janela também é gasto.
const FILTRO_INSIGHTS = JSON.stringify([{
  field: "campaign.effective_status",
  operator: "IN",
  value: ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "IN_PROCESS", "WITH_ISSUES"],
}]);
// Limite de chamadas e token inválido: repetir sem funding_source_details não muda nada.
const NAO_REPETE = new Set([4, 17, 190, 613, 80004]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pedido = { account_id: string | null; dias: number; modo: "completo" | "estado" };
type Conta = { id: string; act_id: string; timezone_name: string | null; last_sync_ok_at: string | null };
type Resultado = {
  account_id: string;
  run_id: string | null;
  status: "ok" | "falhou" | "em_andamento";
  erro?: string;
  dias?: number;
  campanhas?: number;
  conflitos?: string[];
  estado_conta?: string | null;
};

function lerPedido(texto: string): Pedido | null {
  let b: unknown = {};
  if (texto.trim()) {
    try {
      b = JSON.parse(texto);
    } catch {
      return null;
    }
  }
  if (b === null || typeof b !== "object" || Array.isArray(b)) return null;
  const { account_id = null, dias = 7, modo = "completo" } = b as Record<string, unknown>;
  if (account_id !== null && !(typeof account_id === "string" && UUID.test(account_id))) return null;
  if (typeof dias !== "number" || !Number.isInteger(dias) || dias < 1 || dias > 90) return null;
  if (modo !== "completo" && modo !== "estado") return null;
  return { account_id, dias, modo };
}

function logFalha(onde: string, conta: string, e: unknown) {
  console.error(
    `meta-sync: ${onde} (conta ${conta})`,
    e instanceof MetaApiError ? `status=${e.status} code=${e.code ?? "-"}` : "falha fora da Meta",
  );
}

/** A conta na Meta. funding_source_details exige MANAGE: negado, repete sem ele
 *  e o saldo pré-pago fica nulo (o estado sai de status e bloqueio). */
async function lerConta(act: string, campos: string[], token: string): Promise<GraphAccount> {
  try {
    return await metaGet<GraphAccount>(act, { fields: campos.join(",") }, token);
  } catch (e) {
    if (!(e instanceof MetaApiError) || e.status === 0 || NAO_REPETE.has(e.code ?? 0)) throw e;
    const sem = campos.filter((c) => c !== "funding_source_details").join(",");
    return await metaGet<GraphAccount>(act, { fields: sem }, token);
  }
}

/** Tudo o que a apply precisa. Lança na primeira falha: nada foi gravado ainda. */
async function buscarNaMeta(svc: SupabaseClient, conta: Conta, dias: number, token: string) {
  const act = actId(conta.act_id);
  const [contaMeta, campanhas, adsets] = await Promise.all([
    lerConta(act, CAMPOS_CONTA, token),
    metaGetAll<GraphCampaign>(`${act}/campaigns`, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
      effective_status: STATUS_CAMPANHA,
      limit: "500",
    }, token),
    metaGetAll<GraphAdset>(`${act}/adsets`, {
      fields: "id,campaign_id,status,effective_status,destination_type,optimization_goal,daily_budget,lifetime_budget",
      effective_status: STATUS_CONJUNTO,
      limit: "500",
    }, token),
  ]);

  const fuso = contaMeta.timezone_name ?? conta.timezone_name;
  // O dia da última boa sai no fuso da conta: em UTC, a das 22:30 cairia no dia seguinte.
  const pedida = janelaPedida(
    hojeNoFuso(fuso),
    dias,
    conta.last_sync_ok_at === null ? null : hojeNoFuso(fuso, new Date(conta.last_sync_ok_at)),
  );
  const { data: desde, error } = await svc.rpc("meta_sync_window", {
    p_account_id: conta.id,
    p_external_ids: campanhas.map((c) => c.id).filter((id) => typeof id === "string" && id !== ""),
    p_inicio: pedida.inicio,
    p_fim: pedida.fim,
  });
  if (error || typeof desde !== "string") {
    throw new Error(`Não consegui calcular a janela da sincronização: ${error?.message ?? "resposta vazia do banco"}.`);
  }
  const buscada = { inicio: desde < pedida.inicio ? desde : pedida.inicio, fim: pedida.fim };

  const insights = await metaGetAll<GraphInsight>(`${act}/insights`, {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: buscada.inicio, until: buscada.fim }),
    fields: "campaign_id,campaign_name,date_start,spend,impressions,reach,clicks,inline_link_clicks,actions",
    filtering: FILTRO_INSIGHTS,
    limit: "500",
  }, token);

  const { data: construtoras, error: erroDev } = await svc.from("developers").select("id,name");
  if (erroDev) throw new Error("Não consegui ler as construtoras para sugerir o vínculo.");

  return montarPayload({
    janelaPedida: pedida,
    janelaBuscada: buscada,
    conta: contaMeta,
    campanhas,
    adsets,
    insights,
    construtoras: (construtoras ?? []) as { id: string; name: string }[],
  });
}

/** Depois de apply ou finish. Falhar aqui só vai para o log: a sincronização vale. */
async function avaliarAlertas(svc: SupabaseClient, contaId: string) {
  const { error } = await svc.rpc("meta_avaliar_alertas", { p_account_id: contaId });
  if (error) console.error(`meta-sync: meta_avaliar_alertas falhou (conta ${contaId})`, error.code);
}

async function falhar(svc: SupabaseClient, contaId: string, runId: string, erro: string): Promise<Resultado> {
  const { error } = await svc.rpc("meta_sync_finish", { p_run_id: runId, p_status: "falhou", p_error: erro });
  if (error) console.error(`meta-sync: meta_sync_finish falhou (conta ${contaId})`, error.code);
  await avaliarAlertas(svc, contaId);
  return { account_id: contaId, run_id: runId, status: "falhou", erro };
}

async function sincronizarConta(
  svc: SupabaseClient,
  conta: Conta,
  dias: number,
  token: string | null,
  trigger: "cron" | "manual",
  userId: string | null,
): Promise<Resultado> {
  const inicio = await svc.rpc("meta_sync_start", {
    p_account_id: conta.id,
    p_trigger: trigger,
    p_requested_by: userId,
  });
  if (inicio.error) {
    const status = inicio.error.code === "55P03" ? "em_andamento" : "falhou";
    return { account_id: conta.id, run_id: null, status, erro: inicio.error.message };
  }
  const runId = inicio.data as string;

  let payload: ReturnType<typeof montarPayload>;
  try {
    if (!token) throw new Error(SEM_TOKEN);
    payload = await buscarNaMeta(svc, conta, dias, token);
  } catch (e) {
    logFalha("leitura interrompida", conta.id, e);
    return await falhar(svc, conta.id, runId, descreverFalhaMeta(e));
  }

  const { data, error } = await svc.rpc("meta_sync_apply", { p_run_id: runId, p_payload: payload });
  if (error) {
    console.error(`meta-sync: meta_sync_apply recusou (conta ${conta.id})`, error.code);
    return await falhar(svc, conta.id, runId, `O banco recusou a gravação e nada foi trocado: ${error.message}`);
  }
  await avaliarAlertas(svc, conta.id);

  const r = data as { campanhas_criadas: number; campanhas_atualizadas: number; dias: number; conflitos: string[] };
  return {
    account_id: conta.id,
    run_id: runId,
    status: "ok",
    dias: r.dias,
    campanhas: r.campanhas_criadas + r.campanhas_atualizadas,
    conflitos: r.conflitos ?? [],
  };
}

/** Modo estado: grava os campos crus lidos agora e avalia só a transição de estado.
 *  Leitura falhou: nada é gravado e o estado anterior continua (com a data dele). */
async function verificarEstado(svc: SupabaseClient, conta: Conta, token: string): Promise<Resultado> {
  let c: ReturnType<typeof montarConta>;
  try {
    c = montarConta(await lerConta(actId(conta.act_id), CAMPOS_ESTADO, token));
  } catch (e) {
    logFalha("leitura do estado interrompida", conta.id, e);
    return { account_id: conta.id, run_id: null, status: "falhou", erro: descreverFalhaMeta(e) };
  }

  const { error } = await svc.from("meta_ad_accounts").update({
    account_status: c.account_status,
    disable_reason: c.disable_reason,
    is_prepay: c.is_prepay,
    amount_spent: c.amount_spent,
    spend_cap: c.spend_cap,
    prepay_available: c.prepay_available,
    account_checked_at: new Date().toISOString(),
  }).eq("id", conta.id);
  if (error) {
    console.error(`meta-sync: gravar estado falhou (conta ${conta.id})`, error.code);
    return { account_id: conta.id, run_id: null, status: "falhou", erro: `O banco recusou o estado da conta: ${error.message}` };
  }

  const r = await svc.rpc("meta_avaliar_alertas", { p_account_id: conta.id, p_so_estado: true });
  if (r.error) console.error(`meta-sync: avaliação do estado falhou (conta ${conta.id})`, r.error.code);
  const estado = (r.data as { estado_conta?: string } | null)?.estado_conta ?? null;
  return { account_id: conta.id, run_id: null, status: "ok", estado_conta: estado };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const servico = (await requireServiceRole(req, corsHeaders)) === null;
  let userId: string | null = null;
  if (!servico) {
    const gate = await requireUserPermission(req, "marketing.meta_manage", corsHeaders);
    if (gate.denied) return gate.denied;
    userId = gate.userId;
  }

  const pedido = lerPedido(await req.text());
  if (!pedido) {
    return json({ error: "Pedido inválido: envie {account_id?: uuid, dias?: 1 a 90, modo?: 'completo' ou 'estado'}." }, 422);
  }

  const svc = serviceClient();
  let consulta = svc.from("meta_ad_accounts")
    .select("id,act_id,timezone_name,last_sync_ok_at")
    .eq("enabled", true)
    .order("act_id");
  if (pedido.account_id) consulta = consulta.eq("id", pedido.account_id);
  const { data, error } = await consulta;
  if (error) {
    console.error("meta-sync: leitura das contas falhou", error.code);
    return json({ error: "Não consegui ler as contas de anúncios." }, 500);
  }
  const contas = (data ?? []) as Conta[];
  if (contas.length === 0) {
    return pedido.account_id
      ? json({ error: "Conta de anúncios não encontrada ou desligada em /admin/meta-ads." }, 404)
      : json({ error: "Nenhuma conta de anúncios ligada: escolha as contas em /admin/meta-ads." }, 422);
  }

  const token = await metaToken();
  const resultados: Resultado[] = [];

  if (pedido.modo === "estado") {
    // Sem token o estado só fica como estava (com a data da última leitura); a
    // execução 'falhou' e o alerta ficam com a sincronização diária, que roda
    // mesmo sem token. Registrar aqui encheria meta_sync_runs de hora em hora.
    if (!token) return json({ error: SEM_TOKEN }, 409);
    // ponytail: contas em série, uma chamada cada; paralelizar se houver dezenas de contas.
    for (const conta of contas) resultados.push(await verificarEstado(svc, conta, token));
    return json({ ok: resultados.every((r) => r.status === "ok"), contas: resultados });
  }

  // Em série: a janela, a apply e o limite de chamadas são por conta, e uma
  // conta que falha não pode levar as outras junto.
  // ponytail: todas as contas numa requisição só; separar por conta quando o
  // tempo somado passar do limite da edge function.
  for (const conta of contas) {
    resultados.push(await sincronizarConta(svc, conta, pedido.dias, token, servico ? "cron" : "manual", userId));
  }
  if (!token) return json({ error: SEM_TOKEN, contas: resultados }, 409);
  return json({ ok: resultados.every((r) => r.status === "ok"), contas: resultados });
});
