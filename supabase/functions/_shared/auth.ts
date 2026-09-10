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
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "./secrets.ts";

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

/**
 * Papel declarado no corpo do JWT, sem verificar assinatura.
 *
 * Ler o payload sem validar só é seguro porque o gateway já validou a
 * assinatura antes de invocar a function — o que ele NÃO faz é olhar o papel.
 * Token forjado não chega até aqui; token legítimo de anon chega, e é
 * exatamente esse que precisamos recusar.
 */
function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Comparação sem atalho por prefixo: o tempo não pode contar quanto acertou. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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
 * Porta do cron: só a chave de serviço entra.
 *
 * Aceita duas formas porque o projeto usa as chaves novas (`sb_secret_…`, que
 * não são JWT) e o valor que o pg_net manda vem do cofre, cadastrado à mão pelo
 * admin:
 *   1. o token é idêntico à chave de serviço (cofre à frente, `Deno.env` atrás
 *      — a mesma ordem que a migration 0018 usa para montar a chamada);
 *   2. o token é um JWT com `role = 'service_role'` (formato legado).
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

  if (jwtRole(token) === "service_role") return null;

  const serviceKey = await getSecret("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && constantTimeEquals(token, serviceKey)) return null;

  return deny("Endpoint interno: somente a service role.", 401, corsHeaders);
}
