/**
 * Sessão de teste pelo MESMO fluxo do usuário final.
 *
 * A tela de login não tem senha (ata 23/07) e o e-mail não chega em ambiente de
 * teste. A saída não é enfraquecer a autenticação: é pedir o código de acesso à
 * Admin API (`generate_link` devolve `email_otp`, sem enviar e-mail) e trocá-lo
 * por sessão em `/auth/v1/verify` — exatamente a chamada que `Login.tsx` faz.
 *
 * Consequência que importa: o JWT é real, `auth.uid()` é real e o RLS vale de
 * verdade em todos os testes. Um bypass de autenticação faria a suíte passar
 * mesmo com corretor enxergando negócio da empresa inteira, que é justamente o
 * risco silencioso deste projeto.
 */
import { resolveTarget, storageKeyFor } from "./target";

export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: string;
  user: { id: string; email: string };
};

export async function mintSession(email: string): Promise<StoredSession> {
  const t = resolveTarget();

  const gen = await fetch(`${t.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: t.serviceRoleKey,
      Authorization: `Bearer ${t.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const link = await gen.json();
  if (!gen.ok || !link.email_otp) {
    throw new Error(`generate_link(${email}) → ${gen.status}: ${JSON.stringify(link).slice(0, 200)}`);
  }

  const verify = await fetch(`${t.supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: t.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, token: link.email_otp, type: "email" }),
  });
  const session = await verify.json();
  if (!verify.ok || !session.access_token) {
    const dica = session?.error_code === "user_banned"
      ? " (conta banida — as contas `seed.*` são bloqueadas de propósito; use as `e2e.*`)"
      : "";
    throw new Error(`verify(${email}) → ${verify.status}: ${JSON.stringify(session).slice(0, 200)}${dica}`);
  }

  return session as StoredSession;
}

/** O formato é o que o supabase-js grava no localStorage: a sessão serializada. */
export function storageStateFor(session: StoredSession, appOrigin: string) {
  const t = resolveTarget();
  return {
    cookies: [],
    origins: [
      {
        origin: appOrigin,
        localStorage: [
          { name: storageKeyFor(t.supabaseUrl), value: JSON.stringify(session) },
        ],
      },
    ],
  };
}
