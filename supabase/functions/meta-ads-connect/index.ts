import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserPermission } from "../_shared/auth.ts";
import { descreverFalhaMeta } from "../_shared/metaErros.ts";
import { MetaApiError, metaGet, metaGetAll, metaPost, metaToken } from "../_shared/metaAds.ts";
import { diagnosticarLeadsMeta, type FatosDaMeta } from "../_shared/metaLeadsDiagnostico.ts";
import { getSecret } from "../_shared/secrets.ts";
import { getMetaPageCredentials } from "../_shared/metaPageTokensStore.ts";

/**
 * Conexão com a Marketing API (F1.1): testar o token do cofre e escolher as
 * contas de anúncios que o sistema sincroniza.
 *
 * Porta: `settings.integrations` (administrador e sócio), a mesma do cofre.
 * "Salvar" relista /me/adaccounts na hora e só grava a conta que o token de
 * fato alcança: um act_ adulterado no navegador não vira conta sincronizada. A
 * gravação vai com o cliente do USUÁRIO, então `meta_accounts_save` confere a
 * permissão de novo no banco.
 *
 * Leads de formulário (29/09/2026): `diagnosticar_leads` confere a corrente
 * inteira que traz o lead (pausa, cofre, token da PÁGINA, assinatura da página
 * no app, última chamada ao webhook) e `assinar_pagina` faz o passo que faltava
 * em todo o sistema — POST /{page}/subscribed_apps com `leadgen`. Os dois usam o
 * token da página, não o da Marketing API.
 *
 * Formulários (02/10/2026): `listar_formularios` lê /{page}/leadgen_forms de
 * cada página do cofre, para a roleta (Admin → Automação de leads) oferecer o
 * formulário antes do primeiro lead dele chegar. Porta própria:
 * `menu.admin_lead_automation`, a da tela que usa a lista.
 *
 * 200 com o resultado · 409 sem token · 422 corpo inválido · 502 quando a Meta
 * falha, com a frase de `descreverFalhaMeta`. Nenhuma URL nem token no log.
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
  "'Meta — token da Marketing API', em Admin → Meta Ads, e teste de novo.";

type ContaGraph = { id?: string; name?: string; currency?: string; timezone_name?: string; account_status?: number };
type ContaAlcancada = {
  act_id: string;
  name: string | null;
  currency: string | null;
  timezone_name: string | null;
  account_status: number | null;
};
type Pedido =
  | { action: "testar" }
  | { action: "salvar"; act_ids: string[] }
  | { action: "diagnosticar_leads" }
  | { action: "assinar_pagina" }
  | { action: "listar_formularios" };

/** As contas que o token alcança. O `id` vem como act_<número>, o único formato que o banco aceita. */
async function contasDoToken(token: string): Promise<ContaAlcancada[]> {
  const linhas = await metaGetAll<ContaGraph>(
    "me/adaccounts",
    { fields: "account_id,name,currency,timezone_name,account_status", limit: "100" },
    token,
  );
  return linhas.flatMap((c) => {
    const id = c.id ?? "";
    if (!/^act_\d+$/.test(id)) return [];
    return [{
      act_id: id,
      name: c.name ?? null,
      currency: c.currency ?? null,
      timezone_name: c.timezone_name ?? null,
      account_status: typeof c.account_status === "number" ? c.account_status : null,
    }];
  });
}

function lerPedido(body: unknown): Pedido | null {
  const b = body as { action?: unknown; act_ids?: unknown } | null;
  if (b?.action === "testar") return { action: "testar" };
  if (b?.action === "diagnosticar_leads") return { action: "diagnosticar_leads" };
  if (b?.action === "assinar_pagina") return { action: "assinar_pagina" };
  if (b?.action === "listar_formularios") return { action: "listar_formularios" };
  if (b?.action !== "salvar") return null;
  const ids = b.act_ids;
  if (!Array.isArray(ids) || ids.length > 500) return null;
  if (!ids.every((id) => typeof id === "string" && /^act_\d{1,30}$/.test(id))) return null;
  return { action: "salvar", act_ids: ids };
}

/** Cliente com o JWT de quem chamou: `auth.uid()` na RPC é o usuário. A chave
 *  vai só no `apikey` do gateway; quem decide o papel é o Authorization. */
function clienteDoUsuario(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
}

function falhaDaMeta(e: unknown) {
  console.error(
    "meta-ads-connect: a Meta falhou",
    e instanceof MetaApiError ? `status=${e.status} code=${e.code ?? "-"}` : "leitura interrompida",
  );
  return json({ error: descreverFalhaMeta(e) }, 502);
}

/** A recusa da Meta numa chamada com o token da PÁGINA, em frase de quem opera. */
function falhaDaPagina(e: unknown): string {
  if (!(e instanceof MetaApiError)) return "Não consegui falar com a Meta.";
  if (e.code === 190) return "O token da página expirou ou foi revogado. Gere outro e substitua no cofre.";
  if (e.code === 10 || e.code === 200 || e.code === 210 || e.code === 3) {
    return "O token da página não tem a permissão para isto (pages_manage_metadata para assinar, leads_retrieval para ler o lead).";
  }
  return e.message;
}

type DonoDoToken = { id?: string; name?: string; metadata?: { type?: string } };
type PaginaAutorizada = { id: string; name: string | null; token: string };

/** De quem é o token: página (o certo) ou usuário (o erro mais comum ao colar). */
async function donoDoToken(pageToken: string): Promise<DonoDoToken> {
  return await metaGet<DonoDoToken>("me", { fields: "id,name", metadata: "1" }, pageToken);
}

/**
 * Tokens de usuário de sistema são permanentes e a Meta os reutiliza para os
 * ativos atribuídos. Por isso `/me` continua sendo o usuário, mesmo quando o
 * token alcança uma Página. Nesse caso o `page_id` explícito do cofre é a
 * fronteira de segurança: a credencial só é aceita se conseguir ler exatamente
 * essa Página. O formato legado sem `page_id` continua exigindo token cujo dono
 * seja a própria Página.
 */
async function paginaAutorizada(
  credential: { pageId: string | null; name: string | null; token: string },
): Promise<PaginaAutorizada> {
  const dono = await donoDoToken(credential.token);

  if (dono.metadata?.type === "page" && dono.id) {
    if (credential.pageId && credential.pageId !== dono.id) {
      throw new Error(`O token cadastrado para a página ${credential.pageId} pertence a outra página.`);
    }
    return { id: dono.id, name: dono.name ?? credential.name, token: credential.token };
  }

  if (!credential.pageId) {
    throw new Error("Há um token de usuário sem page_id. Informe a página junto da credencial.");
  }

  const pagina = await metaGet<{ id?: string; name?: string }>(
    credential.pageId,
    { fields: "id,name" },
    credential.token,
  );
  if (pagina.id !== credential.pageId) {
    throw new Error(`A credencial não confirmou acesso à página ${credential.pageId}.`);
  }
  return { id: pagina.id, name: pagina.name ?? credential.name, token: credential.token };
}

function clienteDeServico() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function diagnosticarLeads() {
  const db = clienteDeServico();
  const [appSecret, verifyToken, pageCredentials, ajustes, ultimoLead] = await Promise.all([
    getSecret("META_APP_SECRET"),
    getSecret("META_WEBHOOK_VERIFY_TOKEN"),
    getMetaPageCredentials(),
    db.from("automation_settings")
      .select("leads_paused, meta_webhook_last_at, meta_webhook_last_result")
      .eq("id", true).maybeSingle(),
    // Lead de formulário: o webhook grava o leadgen_id em `external_id`.
    db.from("leads").select("created_at, external_id")
      .not("external_id", "is", null).not("form_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const fatos: FatosDaMeta = {
    pausado: Boolean(ajustes.data?.leads_paused),
    temAppSecret: Boolean(appSecret),
    temVerifyToken: Boolean(verifyToken),
    temPageToken: pageCredentials.length > 0,
    token: null,
    assinaturas: null,
    leituraDeLead: null,
    ultimaChamada: ajustes.data?.meta_webhook_last_at
      ? { em: ajustes.data.meta_webhook_last_at, resultado: ajustes.data.meta_webhook_last_result ?? null }
      : null,
    ultimoLeadEm: ultimoLead.data?.created_at ?? null,
  };

  const paginas: Array<{ id: string; name: string | null; assinada: boolean; erro?: string }> = [];
  const tokensValidos: PaginaAutorizada[] = [];
  const errosDeToken: string[] = [];
  for (const credential of pageCredentials) {
    try {
      tokensValidos.push(await paginaAutorizada(credential));
    } catch (e) {
      errosDeToken.push(e instanceof Error && !(e instanceof MetaApiError) ? e.message : falhaDaPagina(e));
    }
  }

  fatos.token = errosDeToken.length
    ? { erro: errosDeToken.join(" ") }
    : tokensValidos.length
      ? { tipo: "page", nome: `${tokensValidos.length} página(s) válida(s)` }
      : null;

  const assinaturaErros: string[] = [];
  for (const page of tokensValidos) {
    try {
      const resposta = await metaGet<{ data?: { name?: string; subscribed_fields?: string[] }[] }>(
        `${page.id}/subscribed_apps`, {}, page.token,
      );
      const apps = resposta.data ?? [];
      const assinada = apps.some((app) => (app.subscribed_fields ?? []).includes("leadgen"));
      paginas.push({ id: page.id, name: page.name, assinada });
    } catch (e) {
      const erro = falhaDaPagina(e);
      assinaturaErros.push(erro);
      paginas.push({ id: page.id, name: null, assinada: false, erro });
    }
  }

  if (tokensValidos.length) {
    fatos.assinaturas = assinaturaErros.length
      ? { erro: assinaturaErros.join(" ") }
      : [{ nome: `${paginas.length} página(s)`, campos: paginas.every((p) => p.assinada) ? ["leadgen"] : [] }];

    const leadgenId = ultimoLead.data?.external_id;
    if (leadgenId && /^\d+$/.test(leadgenId)) {
      let leituraErro: string | null = null;
      for (const page of tokensValidos) {
        try {
          await metaGet(leadgenId, { fields: "id" }, page.token);
          fatos.leituraDeLead = { ok: true };
          leituraErro = null;
          break;
        } catch (e) {
          leituraErro = falhaDaPagina(e);
        }
      }
      if (!fatos.leituraDeLead && leituraErro) fatos.leituraDeLead = { erro: leituraErro };
    }
  }

  const checagens = diagnosticarLeadsMeta(fatos);
  const assinatura = checagens.find((c) => c.id === "assinatura");
  return json({
    ok: true,
    pagina: paginas[0] ? { id: paginas[0].id, name: paginas[0].name } : null,
    paginas,
    podeAssinar: paginas.length > 0 && assinatura?.ok === false,
    checagens,
  });
}

async function assinarPagina() {
  const credentials = await getMetaPageCredentials();
  if (!credentials.length) {
    return json({ error: "Nenhum token de página cadastrado. Cadastre meta/page_access_token ou meta/page_access_tokens em Integrações." }, 409);
  }
  const paginas: Array<{ id: string; name: string | null }> = [];
  for (const credential of credentials) {
    try {
      const pagina = await paginaAutorizada(credential);
      await metaPost(`${pagina.id}/subscribed_apps`, { subscribed_fields: "leadgen" }, pagina.token);
      paginas.push({ id: pagina.id, name: pagina.name });
    } catch (e) {
      console.error(
        "meta-ads-connect: assinatura da página falhou",
        e instanceof MetaApiError ? `status=${e.status} code=${e.code ?? "-"}` : "leitura interrompida",
      );
      const mensagem = e instanceof Error && !(e instanceof MetaApiError) ? e.message : falhaDaPagina(e);
      return json({ error: mensagem }, e instanceof MetaApiError ? 502 : 409);
    }
  }
  return json({ ok: true, pagina: paginas[0] ?? null, paginas });
}

type FormularioGraph = { id?: string; name?: string; status?: string };

/** Formulários de lead de todas as páginas do cofre. Página que falha não derruba as outras. */
async function listarFormularios() {
  const credentials = await getMetaPageCredentials();
  if (!credentials.length) {
    return json({ error: "Nenhum token de página cadastrado. Cadastre meta/page_access_token ou meta/page_access_tokens em Integrações." }, 409);
  }
  const formularios: Array<{ form_id: string; form_name: string | null; status: string | null; pagina: string | null }> = [];
  const erros: string[] = [];
  for (const credential of credentials) {
    try {
      const pagina = await paginaAutorizada(credential);
      const linhas = await metaGetAll<FormularioGraph>(
        `${pagina.id}/leadgen_forms`, { fields: "id,name,status", limit: "100" }, pagina.token,
      );
      for (const f of linhas) {
        if (!f.id || !/^\d+$/.test(f.id)) continue;
        formularios.push({ form_id: f.id, form_name: f.name ?? null, status: f.status ?? null, pagina: pagina.name });
      }
    } catch (e) {
      console.error(
        "meta-ads-connect: leitura dos formulários falhou",
        e instanceof MetaApiError ? `status=${e.status} code=${e.code ?? "-"}` : "leitura interrompida",
      );
      erros.push(e instanceof Error && !(e instanceof MetaApiError) ? e.message : falhaDaPagina(e));
    }
  }
  if (!formularios.length && erros.length) return json({ error: erros.join(" ") }, 502);
  return json({ ok: true, formularios, erros });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const pedido = lerPedido(await req.json().catch(() => null));
  if (!pedido) {
    return json({ error: "Pedido inválido: envie {action:'testar'}, {action:'salvar', act_ids:['act_…']}, {action:'diagnosticar_leads'}, {action:'assinar_pagina'} ou {action:'listar_formularios'}." }, 422);
  }

  // Ler formulários é da tela da roleta (diretor incluso); o resto é do cofre.
  const porta = pedido.action === "listar_formularios" ? "menu.admin_lead_automation" : "settings.integrations";
  const gate = await requireUserPermission(req, porta, corsHeaders);
  if (gate.denied) return gate.denied;

  if (pedido.action === "listar_formularios") return await listarFormularios();

  if (pedido.action === "diagnosticar_leads") return await diagnosticarLeads();
  if (pedido.action === "assinar_pagina") return await assinarPagina();

  const token = await metaToken();
  if (!token) return json({ error: SEM_TOKEN }, 409);

  let alcancadas: ContaAlcancada[];
  try {
    if (pedido.action === "testar") {
      const [eu, contas] = await Promise.all([
        metaGet<{ id?: string; name?: string }>("me", { fields: "id,name" }, token),
        contasDoToken(token),
      ]);
      return json({ ok: true, usuario: { id: eu.id ?? null, name: eu.name ?? null }, contas });
    }
    alcancadas = await contasDoToken(token);
  } catch (e) {
    return falhaDaMeta(e);
  }

  const pedidas = new Set(pedido.act_ids);
  const escolhidas = alcancadas
    .filter((c) => pedidas.has(c.act_id))
    .map(({ act_id, name, currency, timezone_name }) => ({ act_id, name, currency, timezone_name }));

  const { data, error } = await clienteDoUsuario(req).rpc("meta_accounts_save", { p_accounts: escolhidas });
  if (error) {
    console.error("meta-ads-connect: meta_accounts_save recusou", error.code);
    return json({ error: error.message, code: error.code ?? null }, error.code === "42501" ? 403 : 400);
  }
  return json({ ok: true, salvas: typeof data === "number" ? data : 0 });
});
