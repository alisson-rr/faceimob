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
 * Ata de 23/07: "diretores possuem visibilidade total".
 *
 * Total quer dizer inclusive fora das equipes que ele dirige — é o que
 * `can_read_all()` implementa. Por isso o cenário tem também um negócio de
 * corretor do seed, que não está em nenhuma equipe do diretor E2E.
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

test("diretor vê negócio das duas equipes e de fora delas", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);

  await expect(linhaDoCliente(page, alfa.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, beta.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, deFora.cliente)).toBeVisible();
});

test("diretor tem o menu de gestão, mas não o de administração", async ({ page }) => {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);

  for (const item of ["Pipeline", "Checkpoint", "Resultados", "Marketing"]) {
    await expect(page.getByRole("link", { name: item })).toBeVisible();
  }
  // Diretor não é administrador: a matriz não concede `menu.admin_*`.
  await expect(page.getByRole("link", { name: "Permissões" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Integrações" })).toHaveCount(0);
});

test("URL direta de /admin/permissions é negada ao diretor", async ({ page }) => {
  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);

  await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
  await expect(page.getByRole("tab", { name: /acesso ao menu/i })).toHaveCount(0);
});
