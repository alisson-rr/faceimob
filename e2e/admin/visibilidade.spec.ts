import { test, expect, runTag, aguardarCarregamento } from "../support/fixtures";
import {
  CORRETOR_DE_FORA,
  abrirPipelineFiltrado,
  criarNegocio,
  idDoPerfil,
  limparCenario,
  linhaDoCliente,
  montarDuasEquipes,
} from "../matriz/cenario";

/**
 * Administrador: `is_admin()` curto-circuita `has_permission()`,
 * `can_enter_stage()` e `can_read_all()`. Aqui isso vira teste — sem ele, um
 * admin com a matriz vazia pareceria "sem permissão de nada".
 */
const tag = runTag();
let alfa: { id: string; cliente: string };
let beta: { id: string; cliente: string };
let deFora: { id: string; cliente: string };

test.beforeAll(async () => {
  ({ alfa, beta } = await montarDuasEquipes(tag));
  deFora = await criarNegocio(tag, "FORA", await idDoPerfil(CORRETOR_DE_FORA));
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test("admin vê negócio de todas as equipes", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);

  await expect(linhaDoCliente(page, alfa.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, beta.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, deFora.cliente)).toBeVisible();
});

// `is_admin()` concede tudo, então a primeira tela do menu é o dashboard —
// a mesma regra que leva cca/sdr/marketing para outra tela.
test('"/" leva o admin ao dashboard', async ({ page }) => {
  await page.goto("/");
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await aguardarCarregamento(page);
  await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
});

test("admin tem o grupo de administração no menu", async ({ page }) => {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);

  await expect(page.getByText("Administração")).toBeVisible();
  for (const item of ["Permissões", "Integrações", "Construtoras", "IPs autorizados"]) {
    await expect(page.getByRole("link", { name: item })).toBeVisible();
  }
});
