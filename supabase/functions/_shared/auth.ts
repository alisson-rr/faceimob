/**
 * Portaria das edge functions.
 *
 * O gateway do Supabase valida a ASSINATURA do JWT, não o papel de quem chama.
 * Com `verify_jwt` ligado (padrão) qualquer requisição com a chave publicável —
 * que vai no bundle do navegador — passa pelo gateway e chega ao nosso código.
 * Function que roda com service_role e não checa nada depois disso é uma
 * service_role exposta na internet (achados S01 e S04 da auditoria de 21/08).
 *
 * Duas portas, uma por tipo de chamador:
 *   - `requireUserPermission` — chamada vinda do navegador: exige usuário
 *     autenticado E a permissão que a própria tela usa para aparecer no menu.
 *   - `requireServiceRole` — chamada vinda do pg_cron via pg_net: exige a chave
 *     de serviço, a mesma que a migration guarda no cofre.
 *
 * Ambas devolvem `null` quando liberam a passagem e uma `Response` pronta
 * quando barram — o chamador só precisa de `if (denied) return denied;`.
 *
 * `hasAnyRole` é o complemento das duas: não é porta, é a pergunta "que papel
 * tem quem já entrou", para a operação cuja RLS pede papel e não código.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "./secrets.ts";
import { tokenEhChaveDeServico } from "./chaveServico.ts";

type Headers = Record<string, string>;

const deny = (message: string, status: number, corsHeaders: Headers) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Token do header `Authorization: Bearer <token>`; string vazia se não houver. */
function bearerToken(req: Request): string {
  const raw = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : "";
}

/** Cliente com service role — só para consultas do servidor, nunca autoriza nada. */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/**
 * Chave para o header `apikey`. Só o gateway a lê; quem decide o papel no
 * PostgREST e no GoTrue é o `Authorization`, que aqui é sempre o token do
 * usuário.
 *
 * A cascata existe porque o projeto usa as chaves novas (`sb_publishable_…`) e
 * não há garantia de qual variável a plataforma injeta. Cair na service role
 * como último recurso não escala privilégio: o `Authorization` do usuário
 * continua mandando, e se ele sumisse a consulta rodaria com `auth.uid()` nulo
 * — `has_permission` devolveria false e a porta fecharia. Falha fechada.
 */
function gatewayKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY")
    ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? "";
}

/**
 * Porta do navegador: usuário autenticado com a permissão `permission`.
 *
 * A autorização sai de `public.has_permission()`, a MESMA função que decide se
 * a tela aparece no menu. Lista de papéis escrita à mão aqui divergiria da
 * matriz que o admin edita em Admin · Permissões — o defeito clássico de "a UI
 * mostra o botão e o backend recusa" (ou pior, o contrário).
 *
 * O cliente é criado com a chave publicável + o `Authorization` do chamador, de
 * modo que `auth.uid()` dentro da RPC é o usuário — não a service role.
 */
export async function requireUserPermission(
  req: Request,
  permission: string,
  corsHeaders: Headers,
): Promise<{ denied: Response; userId: null } | { denied: null; userId: string }> {
  const token = bearerToken(req);
  if (!token) {
    return { denied: deny("Autenticação obrigatória.", 401, corsHeaders), userId: null };
  }

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    gatewayKey(),
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    return { denied: deny("Sessão inválida ou expirada.", 401, corsHeaders), userId: null };
  }

  const { data: allowed, error: permError } = await authClient.rpc("has_permission", {
    code: permission,
  });
  if (permError) {
    console.error(`requireUserPermission(${permission}): falha ao checar permissão`, permError.message);
    return { denied: deny("Não foi possível verificar a permissão.", 500, corsHeaders), userId: null };
  }
  if (allowed !== true) {
    return { denied: deny("Sem permissão para esta operação.", 403, corsHeaders), userId: null };
  }

  return { denied: null, userId: data.user.id };
}

/**
 * Segunda porta, quando a primeira não basta: o PAPEL de quem chama.
 *
 * `requireUserPermission` responde por um código da matriz (`menu.sdr` abre a
 * tela do SDR); há operação que precisa de mais que isso — o Playground GRAVA
 * conversa e o disparo em massa MANDA mensagem para cliente real, e a RLS
 * dessas tabelas pergunta por papel, não por código.
 *
 * Espelha `public.has_any_role` (0002, redefinida pela 0099): pedir `'admin'`
 * aceita TAMBÉM `'partner'` — administrador e sócio têm o mesmo nível de
 * permissão (decisão do cliente em 10/09/2026). Pedir qualquer outro papel
 * continua literal.
 *
 * Ponto único de propósito: a mesma lista escrita à mão em duas functions foi o
 * defeito real — as duas ficaram com `['admin','marketing','sdr']` e recusavam
 * o sócio que a policy já aceitava, cada uma com sua própria consulta a
 * `user_roles`. Aqui a regra tem um lugar só, e o gate novo nasce certo.
 *
 * `error` separado de `allowed` porque falha de leitura não é recusa: quem
 * chama devolve 500 ("não deu para verificar"), e não 403 ("você não pode").
 */
export async function hasAnyRole(
  supabase: SupabaseClient,
  userId: string,
  ...targets: string[]
): Promise<{ allowed: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("user_roles").select("role").eq("profile_id", userId);
  if (error) return { allowed: false, error: error.message };

  const aceitos = new Set(targets);
  if (aceitos.has("admin")) aceitos.add("partner");
  return {
    allowed: (data ?? []).some((r: { role: string }) => aceitos.has(r.role)),
    error: null,
  };
}

/**
 * Porta do cron: só a chave de serviço entra.
 *
 * O token precisa ser IGUAL à chave de serviço configurada, e aceita dois
 * lugares porque os chamadores mandam de lugares diferentes:
 *   - o cofre (`supabase/service_role_key`) — é o que os crons da 0018 à 0119
 *     leem para montar o `Authorization` do pg_net;
 *   - o `Deno.env` — a chave que a plataforma injeta, que a suíte E2E e os
 *     scripts usam, e que vale mesmo quando o cofre guarda a `sb_secret_…`.
 *
 * NÃO basta um JWT dizer `role = 'service_role'`: sem conferir a assinatura,
 * isso aceitava token forjado no meta-ads-webhook, que roda com
 * `verify_jwt = false` e o gateway não confere nada.
 *
 * Qualquer outra coisa — inclusive a chave publicável e o JWT de um usuário
 * autenticado — leva 401.
 */
export async function requireServiceRole(
  req: Request,
  corsHeaders: Headers,
): Promise<Response | null> {
  const token = bearerToken(req);
  if (!token) return deny("Endpoint interno: autenticação obrigatória.", 401, corsHeaders);

  const chaves = [await getSecret("SUPABASE_SERVICE_ROLE_KEY"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
  if (tokenEhChaveDeServico(token, chaves)) return null;

  return deny("Endpoint interno: somente a service role.", 401, corsHeaders);
}
