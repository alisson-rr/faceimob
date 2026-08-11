/**
 * Preparo único da suíte: provisiona os dez usuários, gera uma sessão real
 * para cada um e valida que ela de fato autentica no app.
 *
 * A validação não é cerimônia. Se o formato do armazenamento da sessão mudar
 * numa atualização do supabase-js, todos os testes falhariam com "redirecionou
 * para /login" e a causa levaria horas para aparecer. Aqui a falha é imediata e
 * diz o que houve.
 */
import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveTarget } from "./support/target";
import { mintSession, storageStateFor } from "./support/session";
import { provisionE2EUsers } from "./support/users";
import { statePathFor } from "./support/paths";

/**
 * O check-in passa por uma edge function (`broker-checkin`, que é quem enxerga
 * o IP de origem). Com o runtime de functions fora do ar a tela simplesmente
 * não confirma nada, e o teste falha dizendo "não achei 'check-in confirmado'"
 * — que parece defeito da aplicação e é ambiente. Uma resposta 503 do gateway
 * significa runtime fora; 401 significa function viva pedindo autenticação, que
 * é o esperado para uma chamada sem token.
 */
async function exigirEdgeRuntime(supabaseUrl: string) {
  let status: number;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/broker-checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    status = res.status;
  } catch (e) {
    throw new Error(`[e2e] não consegui falar com as edge functions em ${supabaseUrl}: ${String(e)}`);
  }

  if (status === 503) {
    throw new Error(
      "[e2e] o runtime de edge functions está fora do ar — o check-in não tem como funcionar.\n" +
        "  No alvo local: `docker start supabase_edge_runtime_<ref>` ou `npm run db:stop && npm run db:start`.\n" +
        "  (O container costuma morrer por falta de memória; o `supabase start` não o ressuscita sozinho.)",
    );
  }
  console.log(`[e2e] edge functions respondendo (${status})`);
}

export default async function globalSetup(config: FullConfig) {
  const target = resolveTarget();
  const baseURL = config.projects[0]?.use?.baseURL ?? "http://localhost:8080";
  const origin = new URL(baseURL).origin;

  console.log(`\n[e2e] alvo: ${target.name} (${target.supabaseUrl})`);

  await exigirEdgeRuntime(target.supabaseUrl);

  const users = await provisionE2EUsers();
  console.log(`[e2e] ${users.size} usuários prontos`);

  const browser = await chromium.launch();
  try {
    for (const user of users.values()) {
      const session = await mintSession(user.email);
      const statePath = resolve(statePathFor(user.key));
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(statePath, JSON.stringify(storageStateFor(session, origin), null, 2));

      // Prova de que a sessão vale no navegador: abre uma rota protegida e
      // confere que NÃO houve desvio para o login.
      const context = await browser.newContext({ storageState: statePath, baseURL });
      const page = await context.newPage();
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      const url = page.url();
      await context.close();

      if (url.includes("/login")) {
        throw new Error(
          `[e2e] a sessão de ${user.email} não foi aceita pelo app (parou em ${url}).\n` +
            "Provável causa: mudança no formato de armazenamento do supabase-js — confira storageKeyFor/storageStateFor.",
        );
      }
      console.log(`[e2e]   ✓ ${user.key.padEnd(11)} ${user.email}`);
    }
  } finally {
    await browser.close();
  }
}
