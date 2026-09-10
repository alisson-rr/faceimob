/**
 * Alvo da suíte E2E: para qual Supabase os testes apontam.
 *
 *   E2E_TARGET=local (padrão) → stack do CLI: determinístico, semeado por
 *                               `npm run db:reset`, sem segredo nenhum
 *   E2E_TARGET=remote          → projeto de homologação (smoke test)
 *
 * A chave `service_role` NUNCA fica no repositório. No alvo local ela é a chave
 * de demonstração do CLI (pública, trocada a cada `supabase start`), lida de
 * `supabase status`. No remoto vem de `SUPABASE_SERVICE_ROLE_KEY` no ambiente.
 *
 * Ela é usada só para duas coisas, ambas fora do navegador: provisionar os
 * usuários de teste e gerar o código de acesso de cada um. O login em si é o
 * mesmo OTP da produção — não existe bypass nem senha nesta suíte.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type TargetName = "remote" | "local";

export type Target = {
  name: TargetName;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  /** Caixa de e-mail do CLI (Mailpit). Só existe no alvo local. */
  mailpitUrl: string | null;
};

const fromEnvFile = (): Record<string, string> => {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
  } catch {
    // sem .env: só o alvo remoto precisa dele, e reclama abaixo
  }
  return out;
};

let cached: Target | null = null;

export function resolveTarget(): Target {
  if (cached) return cached;
  const name: TargetName = process.env.E2E_TARGET === "remote" ? "remote" : "local";

  if (name === "local") {
    // `shell: true` no Windows: desde a correção do CVE-2024-27980 o Node se
    // recusa a executar `.cmd` (que é o npx) sem passar pelo shell.
    const proc = spawnSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      timeout: 180_000,
      shell: process.platform === "win32",
    });
    const raw = proc.stdout ?? "";
    const pick = (key: string) => new RegExp(`^${key}="?([^"\\r\\n]+)"?$`, "m").exec(raw)?.[1] ?? "";
    const supabaseUrl = pick("API_URL");
    const serviceRoleKey = pick("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Stack local não está de pé. Rode `npm run db:start` e `npm run db:reset` (migrations + seeds).",
      );
    }
    cached = {
      name,
      supabaseUrl,
      anonKey: pick("ANON_KEY"),
      serviceRoleKey,
      mailpitUrl: pick("MAILPIT_URL") || pick("INBUCKET_URL") || "http://127.0.0.1:54324",
    };
    return cached;
  }

  const env = fromEnvFile();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !anonKey) {
    throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ausentes (.env ou ambiente).");
  }
  if (!serviceRoleKey) {
    throw new Error(
      [
        "SUPABASE_SERVICE_ROLE_KEY não está no ambiente.",
        "",
        "Ela gera o código de acesso de cada papel sem depender de caixa de",
        "entrada. O login continua sendo o mesmo OTP da produção.",
        "Pegue em Supabase → Project Settings → API → service_role e exporte",
        "(nunca commite):",
        "",
        '  $env:SUPABASE_SERVICE_ROLE_KEY = "..."     # PowerShell',
        '  export SUPABASE_SERVICE_ROLE_KEY="..."     # bash',
        "",
        "Ou rode no alvo local, que não precisa de segredo: npm run e2e",
      ].join("\n"),
    );
  }

  cached = { name, supabaseUrl, anonKey, serviceRoleKey, mailpitUrl: null };
  return cached;
}

/** Chave que o supabase-js usa no localStorage: `sb-<primeiro rótulo do host>-auth-token`. */
export const storageKeyFor = (supabaseUrl: string) =>
  `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
