#!/usr/bin/env node
/**
 * Sobe o app apontando para o Supabase LOCAL, na porta 5200.
 *
 * O `.env` do dia a dia aponta para homologação, e lá o template de e-mail
 * ainda não tem o código de acesso — não dá para entrar na tela. No local o
 * Mailpit captura o e-mail com os seis dígitos, então a demonstração roda
 * inteira sem depender de caixa postal.
 */
import { spawn, spawnSync } from "node:child_process";

const proc = spawnSync("npx", ["supabase", "status", "-o", "env"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
const saida = proc.stdout || "";
const pegar = (chave) => saida.match(new RegExp(`${chave}="([^"]+)"`))?.[1];
const url = pegar("API_URL");
const anon = pegar("ANON_KEY");

if (!url || !anon) {
  console.error("Stack local não respondeu. Rode `npm run db:start` e tente de novo.");
  process.exit(1);
}

console.log(`app da demonstração → ${url}\nabra http://localhost:5200/login\n`);

const filho = spawn("npx", ["vite", "--port", "5200", "--strictPort"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: anon },
});
filho.on("exit", (code) => process.exit(code ?? 1));
