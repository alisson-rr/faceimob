import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserPermission, serviceClient } from "../_shared/auth.ts";
import { descreverFalhaMeta } from "../_shared/metaErros.ts";
import { actId, MetaApiError, metaGet, metaGetAll, metaPost, metaToken } from "../_shared/metaAds.ts";
import { paraCentavos } from "../_shared/metaInsights.ts";
import {
  type ConjuntoAoVivo,
  type ConjuntoComVerba,
  conjuntosComVerba,
  escalarConjuntos,
  verbaDaCampanha,
} from "./verba.ts";

/**
 * Pausar, ativar e mudar verba de campanha na Meta (F1.3) e a execução da fila
 * do gestor IA (F2.2) — os dois pela MESMA porta e pelo MESMO executor.
 *
 * Porta: `marketing.meta_manage`, aqui (requireUserPermission) e de novo no
 * banco (meta_action_create / meta_action_decide, chamadas com o cliente do
 * USUÁRIO, que gravam quem pediu e quem decidiu).
 *   - {campaign_id, acao, verba_diaria?, confirma_aprendizado?} → ação manual.
 *   - {action_id, decisao, confirma_aprendizado?} → aprovar ou recusar proposta.
 *
 * O executor, na ordem, sem atalho:
 *   1. meta_action_claim (aprovada → executando; a segunda chamada não acha nada);
 *   2. lê a campanha na Meta AGORA: a conta dona e a verba ao vivo;
 *   3. confere que a conta é uma conta LIGADA em meta_ad_accounts (lição 4);
 *   4. em verba, pergunta a meta_action_precisa_aprendizado com a verba ao vivo —
 *      a do banco pode ter um dia de atraso — e, sem o aviso aceito, encerra
 *      como precisa_confirmar (409) sem mandar nada;
 *   5. manda a mudança (em ABO, cada conjunto ativo na mesma proporção);
 *   6. meta_action_finish grava o antes, o depois e a resposta da Meta.
 *
 * 200 {ok, action_id, status} · 409 {code:'aprendizado', variacao, verba_atual,
 * verba_nova} · 422 {error} · 502 {ok:false, action_id, status:'falhou', error}.
 * Nenhuma URL nem token em log; sem IA.
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
const ACOES = ["pausar", "ativar", "verba"] as const;
type Acao = (typeof ACOES)[number];

const SEM_TOKEN =
  "Token da Marketing API não cadastrado: nada foi feito na Meta. Cadastre o token de usuário de sistema " +
  "(ads_read e ads_management) no campo 'Meta — token da Marketing API', em Admin → Meta Ads.";

type Pedido =
  | { tipo: "acao"; campaign_id: string; acao: Acao; verba_diaria: number | null; confirma: boolean }
  | { tipo: "decisao"; action_id: string; decisao: "aprovar" | "recusar"; confirma: boolean };

/** O que meta_action_create e meta_action_decide devolvem. */
type RespostaDoBanco = {
  status?: string;
  action_id?: string;
  variacao?: number | null;
  verba_atual?: number | null;
  verba_nova?: number | null;
};

/** A linha que meta_action_claim devolve (0116). */
type Claim = {
  action_id: string;
  campaign_external_id: string;
  act_id: string | null;
  acao: Acao;
  verba_nova: number | null;
  exigiu_aprendizado: boolean;
};

type CampanhaAoVivo = {
  account_id?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

type Aviso = { variacao: number; verba_atual: number; verba_nova: number };
type Fim =
  | { status: "executada" | "parcial" | "falhou"; resultado: Record<string, unknown> | null; erro: string | null }
  | { status: "precisa_confirmar"; resultado: Record<string, unknown>; erro: null; aviso: Aviso };

function lerPedido(body: unknown): Pedido | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.confirma_aprendizado !== undefined && typeof b.confirma_aprendizado !== "boolean") return null;
  const confirma = b.confirma_aprendizado === true;

  if (b.action_id !== undefined) {
    if (typeof b.action_id !== "string" || !UUID.test(b.action_id) || b.campaign_id !== undefined) return null;
    if (b.decisao !== "aprovar" && b.decisao !== "recusar") return null;
    return { tipo: "decisao", action_id: b.action_id, decisao: b.decisao, confirma };
  }

  if (typeof b.campaign_id !== "string" || !UUID.test(b.campaign_id)) return null;
  const acao = ACOES.find((a) => a === b.acao);
  if (!acao) return null;
  if (acao !== "verba") {
    return b.verba_diaria === undefined || b.verba_diaria === null
      ? { tipo: "acao", campaign_id: b.campaign_id, acao, verba_diaria: null, confirma }
      : null;
  }
  const v = b.verba_diaria;
  // numeric(12,2) no banco: acima disso nem cabe.
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v >= 1e10) return null;
  return { tipo: "acao", campaign_id: b.campaign_id, acao, verba_diaria: v, confirma };
}

/** Cliente com o JWT de quem chamou: `auth.uid()` nas RPCs é o usuário, e é ele
 *  que fica em requested_by e decided_by. */
function clienteDoUsuario(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
}

function recusaDoBanco(error: { code?: string; message: string }) {
  if (error.code === "42501") return json({ error: error.message }, 403);
  if (error.code === "22023" || error.code === "55000") return json({ error: error.message }, 422);
  console.error("meta-campaign-action: o banco recusou", error.code ?? "-");
  return json({ error: "Não foi possível registrar a ação: nada foi feito na Meta." }, 500);
}

/** A Meta responde {success:true} quando aceita. Qualquer outra resposta não vira "feito". */
function aceitou(resposta: unknown): void {
  if ((resposta as { success?: unknown } | null)?.success !== true) {
    throw new Error("A Meta respondeu sem confirmar a mudança: confira no Gerenciador de Anúncios antes de repetir.");
  }
}

/**
 * Lição 4: a campanha pertence a uma conta LIGADA no FACEIMOB. A conta sai da
 * leitura ao vivo, não do banco, que só sabe onde a campanha estava na última
 * sincronização. Devolve a frase da recusa, ou null quando pode seguir.
 */
async function conferirDono(campanha: CampanhaAoVivo, a: Claim, svc: SupabaseClient): Promise<string | null> {
  let act: string;
  try {
    act = actId(String(campanha.account_id ?? ""));
  } catch {
    return "A Meta não informou a conta de anúncios desta campanha: nada foi feito.";
  }
  if (act !== a.act_id) {
    return `Na Meta esta campanha está na conta ${act}, e não na conta em que foi sincronizada: nada foi feito. Sincronize de novo antes de agir.`;
  }
  const { data, error } = await svc
    .from("meta_ad_accounts").select("id").eq("act_id", act).eq("enabled", true).maybeSingle();
  if (error) throw new Error("Não foi possível conferir a conta de anúncios no FACEIMOB: nada foi feito na Meta.");
  return data ? null : `A conta ${act} está desligada em /admin/meta-ads: as ações nela ficam congeladas e nada foi feito.`;
}

async function aplicar(a: Claim, token: string, svc: SupabaseClient): Promise<Fim> {
  const alvo = a.campaign_external_id;
  const campanha = await metaGet<CampanhaAoVivo>(
    alvo,
    { fields: "account_id,status,effective_status,daily_budget,lifetime_budget" },
    token,
  );
  const antes = { status: campanha.status ?? null, effective_status: campanha.effective_status ?? null };

  const recusa = await conferirDono(campanha, a, svc);
  if (recusa) return { status: "falhou", resultado: { antes }, erro: recusa };

  if (a.acao !== "verba") {
    const status = a.acao === "pausar" ? "PAUSED" : "ACTIVE";
    aceitou(await metaPost(alvo, { status }, token));
    return { status: "executada", resultado: { antes, depois: { status } }, erro: null };
  }

  const verba = verbaDaCampanha(campanha);
  if (verba.nivel === "lifetime") {
    return { status: "falhou", resultado: { antes }, erro: "Verba total: mude no Gerenciador de Anúncios." };
  }

  let conjuntos: ConjuntoComVerba[] = [];
  let atualCentavos = 0;
  if (verba.nivel === "campaign") {
    atualCentavos = verba.centavos;
  } else {
    conjuntos = conjuntosComVerba(
      await metaGetAll<ConjuntoAoVivo>(
        `${alvo}/adsets`,
        { fields: "id,name,status,daily_budget,lifetime_budget", limit: "100" },
        token,
      ),
    );
    if (conjuntos.length === 0) {
      return {
        status: "falhou",
        resultado: { antes },
        erro: "Nenhum conjunto ativo com verba diária nesta campanha: não há verba para mudar.",
      };
    }
    atualCentavos = conjuntos.reduce((s, c) => s + c.daily_budget_centavos, 0);
  }

  const atual = atualCentavos / 100;
  const nova = Number(a.verba_nova);
  const antesVerba = { ...antes, verba_diaria: atual, nivel: verba.nivel };

  // A regra dos 30% com a verba AO VIVO, pela mesma função SQL que criar e
  // aprovar usam: um número só, em um lugar só.
  const { data: precisa, error } = await svc.rpc("meta_action_precisa_aprendizado", { p_atual: atual, p_novo: nova });
  if (error || typeof precisa !== "boolean") {
    throw new Error("Não foi possível conferir a regra da fase de aprendizado: nada foi feito na Meta.");
  }
  if (precisa && !a.exigiu_aprendizado) {
    const aviso = { variacao: Math.round(((nova - atual) / atual) * 10000) / 10000, verba_atual: atual, verba_nova: nova };
    return { status: "precisa_confirmar", resultado: { antes: antesVerba, aviso }, erro: null, aviso };
  }

  const novaCentavos = paraCentavos(nova);
  if (verba.nivel === "campaign") {
    aceitou(await metaPost(alvo, { daily_budget: String(novaCentavos) }, token));
    return {
      status: "executada",
      resultado: { antes: antesVerba, depois: { verba_diaria: novaCentavos / 100 } },
      erro: null,
    };
  }

  // ABO: um conjunto por vez. O que a Meta recusar fica listado com o antes e o
  // depois, e os aceitos NÃO são revertidos: reverter seria outra mexida em
  // dinheiro sem decisão humana.
  const nomes = new Map(conjuntos.map((c) => [c.id, c.nome]));
  const itens: { id: string; nome: string | null; de: number; para: number; ok: boolean; erro?: string }[] = [];
  let depoisCentavos = 0;
  for (const p of escalarConjuntos(conjuntos, novaCentavos)) {
    const item = { id: p.id, nome: nomes.get(p.id) ?? null, de: p.de / 100, para: p.para / 100 };
    try {
      aceitou(await metaPost(p.id, { daily_budget: String(p.para) }, token));
      itens.push({ ...item, ok: true });
      depoisCentavos += p.para;
    } catch (e) {
      itens.push({ ...item, ok: false, erro: descreverFalhaMeta(e) });
      depoisCentavos += p.de;
    }
  }

  const recusados = itens.filter((i) => !i.ok);
  const status = recusados.length === 0 ? "executada" : recusados.length < itens.length ? "parcial" : "falhou";
  return {
    status,
    resultado: { antes: antesVerba, depois: { verba_diaria: depoisCentavos / 100 }, conjuntos: itens },
    erro: recusados.length === 0
      ? null
      : `A Meta recusou ${recusados.length} de ${itens.length} conjuntos: ${recusados[0].erro}`,
  };
}

/** O executor único: manual e fila do gestor chegam aqui com a ação já aprovada. */
async function executar(actionId: string, token: string): Promise<Response> {
  const svc = serviceClient();
  const { data, error } = await svc.rpc("meta_action_claim", { p_action_id: actionId });
  if (error) {
    console.error("meta-campaign-action: meta_action_claim falhou", error.code ?? "-");
    return json({
      ok: false,
      action_id: actionId,
      status: "aprovada",
      error: "A ação foi registrada, mas a execução não começou: nada foi feito na Meta.",
    }, 500);
  }
  if (!data) {
    return json({ error: "Esta ação já está em execução ou já terminou: nada foi feito de novo.", action_id: actionId }, 422);
  }

  let fim: Fim;
  try {
    fim = await aplicar(data as Claim, token, svc);
  } catch (e) {
    console.error(
      "meta-campaign-action: a execução falhou",
      e instanceof MetaApiError ? `status=${e.status} code=${e.code ?? "-"}` : "sem código da Meta",
    );
    fim = { status: "falhou", resultado: null, erro: descreverFalhaMeta(e) };
  }

  const { error: erroFim } = await svc.rpc("meta_action_finish", {
    p_action_id: actionId,
    p_status: fim.status,
    p_resultado: fim.resultado,
    p_erro: fim.erro,
  });
  if (erroFim) {
    console.error("meta-campaign-action: meta_action_finish falhou", erroFim.code ?? "-");
    return json({
      ok: false,
      action_id: actionId,
      status: fim.status,
      error: `A Meta terminou como '${fim.status}', mas o registro não foi gravado. Confira a campanha no Gerenciador de Anúncios antes de repetir.`,
    }, 500);
  }

  if (fim.status === "precisa_confirmar") return json({ code: "aprendizado", action_id: actionId, ...fim.aviso }, 409);
  if (fim.status === "falhou") return json({ ok: false, action_id: actionId, status: "falhou", error: fim.erro }, 502);
  return json({ ok: true, action_id: actionId, status: fim.status, ...(fim.erro ? { error: fim.erro } : {}) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const gate = await requireUserPermission(req, "marketing.meta_manage", corsHeaders);
  if (gate.denied) return gate.denied;

  const pedido = lerPedido(await req.json().catch(() => null));
  if (!pedido) {
    return json({
      error:
        "Pedido inválido: envie {campaign_id, acao:'pausar'|'ativar'|'verba', verba_diaria?} " +
        "ou {action_id, decisao:'aprovar'|'recusar'}.",
    }, 422);
  }

  // Sem token, nada é registrado: a proposta da IA não pode ser consumida por
  // falta de configuração. Recusar proposta não fala com a Meta e dispensa.
  const vaiNaMeta = pedido.tipo === "acao" || pedido.decisao === "aprovar";
  const token = vaiNaMeta ? await metaToken() : null;
  if (vaiNaMeta && !token) return json({ error: SEM_TOKEN, code: "sem_token" }, 422);

  const usuario = clienteDoUsuario(req);
  const { data, error } = pedido.tipo === "acao"
    ? await usuario.rpc("meta_action_create", {
      p_campaign_id: pedido.campaign_id,
      p_acao: pedido.acao,
      p_verba_nova: pedido.verba_diaria,
      p_confirma_aprendizado: pedido.confirma,
    })
    : await usuario.rpc("meta_action_decide", {
      p_action_id: pedido.action_id,
      p_decisao: pedido.decisao,
      p_confirma_aprendizado: pedido.confirma,
    });
  if (error) return recusaDoBanco(error);

  const r = (data ?? {}) as RespostaDoBanco;
  const idDoPedido = pedido.tipo === "decisao" ? pedido.action_id : null;

  if (r.status === "precisa_confirmar") {
    return json({
      code: "aprendizado",
      variacao: r.variacao ?? null,
      verba_atual: r.verba_atual ?? null,
      verba_nova: r.verba_nova ?? null,
    }, 409);
  }
  if (r.status === "recusada") return json({ ok: true, action_id: idDoPedido, status: "recusada" });
  if (r.status === "expirada") {
    return json({
      error: "Esta proposta venceu (vale 24 h) e saiu da fila: nada foi feito na Meta.",
      action_id: idDoPedido,
      status: "expirada",
    }, 422);
  }
  if (r.status !== "aprovada" || typeof r.action_id !== "string" || !token) {
    console.error("meta-campaign-action: resposta inesperada do banco", r.status ?? "-");
    return json({ error: "Resposta inesperada ao registrar a ação: nada foi feito na Meta." }, 500);
  }
  return await executar(r.action_id, token);
});
