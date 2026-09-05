#!/usr/bin/env node
/**
 * Atalho multiplataforma para a suíte E2E.
 *
 *   node scripts/e2e.mjs                  → alvo local (padrão)
 *   node scripts/e2e.mjs --remote         → homologação (exige SUPABASE_SERVICE_ROLE_KEY)
 *   node scripts/e2e.mjs --ui             → modo interativo
 *   node scripts/e2e.mjs --project=broker → só a visão do corretor
 *   node scripts/e2e.mjs --demo          → grava o vídeo da fila de leads
 *
 * Existe porque `E2E_TARGET=remote playwright test` não funciona no PowerShell
 * e uma dependência a mais só para exportar variável não se paga.
 */
import { spawn } from "node:child_process";
import { travar } from "./e2e-lock.mjs";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const remoto = args.includes("--remote");
const demo = args.includes("--demo");
const resto = args.filter((a) => a !== "--remote" && a !== "--demo");
if (demo) resto.push("--project=demo");

// Uma execução por vez contra o mesmo alvo: os dez usuários da suíte têm
// identidade fixa e o `global-teardown` os apaga. Ver `scripts/e2e-lock.mjs`.
const liberarTrava = await travar();

const filho = spawn("npx", ["playwright", "test", ...resto], {
  stdio: "inherit",
  // No Windows o alvo é um .cmd, que o spawn só executa através do shell.
  shell: process.platform === "win32",
  env: {
    ...process.env,
    E2E_TARGET: remoto ? "remote" : "local",
    E2E_DEMO: demo ? "1" : "",
    E2E_RUN_ID: process.env.E2E_RUN_ID ?? String(Date.now()),
  },
});

/** Tira o vídeo de dentro de `test-results/` e deixa num lugar fácil de anexar. */
function publicarVideo() {
  const raiz = "test-results";
  let achado = null;
  for (const pasta of readdirSync(raiz, { withFileTypes: true })) {
    if (!pasta.isDirectory() || !pasta.name.startsWith("demo-")) continue;
    for (const arquivo of readdirSync(join(raiz, pasta.name))) {
      if (!arquivo.endsWith(".webm")) continue;
      const caminho = join(raiz, pasta.name, arquivo);
      const mtime = statSync(caminho).mtimeMs;
      if (!achado || mtime > achado.mtime) achado = { caminho, mtime };
    }
  }
  if (!achado) return console.log("\n[demo] nenhum vídeo gerado.");
  mkdirSync("demo", { recursive: true });
  const destino = join("demo", "fila-de-leads.webm");
  copyFileSync(achado.caminho, destino);
  console.log(`\n[demo] vídeo pronto: ${destino}`);
}

filho.on("exit", (code) => {
  liberarTrava();
  if (demo && code === 0) {
    try {
      publicarVideo();
    } catch (e) {
      console.log(`\n[demo] não consegui copiar o vídeo: ${String(e)}`);
    }
  } else if (demo) {
    console.log("\n[demo] roteiro reprovado; o vídeo final não foi publicado.");
  }
  process.exit(code ?? 1);
});
