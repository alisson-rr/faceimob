import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUserPermission } from "../_shared/auth.ts";
import { descreverFalhaMeta } from "../_shared/metaErros.ts";
import { MetaApiError, metaGet, metaGetAll, metaToken } from "../_shared/metaAds.ts";

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
type Pedido = { action: "testar" } | { action: "salvar"; act_ids: string[] };

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const gate = await requireUserPermission(req, "settings.integrations", corsHeaders);
  if (gate.denied) return gate.denied;

  const pedido = lerPedido(await req.json().catch(() => null));
  if (!pedido) {
    return json({ error: "Pedido inválido: envie {action:'testar'} ou {action:'salvar', act_ids:['act_…']}." }, 422);
  }

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
