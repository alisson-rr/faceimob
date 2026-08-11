import { defineConfig, devices } from "@playwright/test";
import { resolveTarget } from "./e2e/support/target";
import { statePathFor } from "./e2e/support/paths";
import { E2E_USERS } from "./e2e/support/users";

/**
 * Suíte de ponta a ponta do FACEIMOB.
 *
 * Um "project" por visão de usuário: cada um roda com a sessão real do seu
 * papel, então a mesma tela é verificada por admin, diretor, gerente, corretor,
 * CCA, SDR e marketing em paralelo. É assim que a matriz de visibilidade da ata
 * de 23/07 ("corretores veem apenas seus negócios, gerentes veem sua equipe,
 * diretores têm visão total") vira teste em vez de promessa.
 *
 * Porta própria (5199) de propósito: o `npm run dev` do dia a dia aponta para o
 * projeto remoto, e reaproveitá-lo faria a suíte testar o banco errado.
 */
const target = resolveTarget();
const PORT = Number(process.env.E2E_PORT || 5199);
const baseURL = `http://localhost:${PORT}`;

const projectFor = (key: string, extra: Record<string, unknown> = {}) => ({
  name: key,
  use: { ...devices["Desktop Chrome"], storageState: statePathFor(key), ...extra },
  testMatch: [`**/${key}/**/*.spec.ts`, `**/*.${key}.spec.ts`],
});

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  /**
   * Execução serial, de propósito.
   *
   * Todos os projects apontam para o MESMO banco e vários deles mexem no mesmo
   * corretor: um spec atribui lead (e o app abre o modal "Lead atribuído a
   * você!" em cima da tela de outro), outro fecha a temporada da gamificação no
   * meio da contagem de pontos, outro apaga check-in. Rodando em paralelo isso
   * vira falha intermitente que parece defeito da aplicação e não é — e o custo
   * de investigar cada uma é maior do que o de esperar a suíte.
   *
   * ponytail: paralelismo só volta com um banco por worker (branch de preview ou
   * schema por worker); enquanto for um banco só, serial é o que dá resultado
   * reproduzível.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },

  projects: [
    // Fluxos sem sessão: login, diário público, checkpoint da diretoria.
    {
      name: "anonimo",
      use: { ...devices["Desktop Chrome"], storageState: { cookies: [], origins: [] } },
      testMatch: ["**/anonimo/**/*.spec.ts", "**/*.anonimo.spec.ts"],
    },
    ...E2E_USERS.map((u) => projectFor(u.key)),

    /**
     * Roteiro de demonstração, para gravar e mostrar ao cliente.
     *
     * Só entra na lista com `npm run demo` — vídeo sempre ligado e passos
     * desacelerados atrapalhariam a suíte de verdade. É a mesma sessão e o
     * mesmo banco dos outros testes: o que aparece no vídeo aconteceu.
     */
    ...(process.env.E2E_DEMO
      ? [{
          name: "demo",
          testMatch: ["**/demo/**/*.spec.ts"],
          use: {
            ...devices["Desktop Chrome"],
            storageState: statePathFor("broker"),
            viewport: { width: 1366, height: 768 },
            video: { mode: "on" as const, size: { width: 1366, height: 768 } },
            launchOptions: { slowMo: 320 },
          },
          timeout: 180_000,
        }]
      : []),
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      // O app precisa falar com o MESMO Supabase que o preparo usou.
      VITE_SUPABASE_URL: target.supabaseUrl,
      VITE_SUPABASE_PUBLISHABLE_KEY: target.anonKey,
    },
  },
});
