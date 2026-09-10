import { test, expect, db, runTag } from "../support/fixtures";
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
 * Ata de 23/07: "gerentes veem o desempenho de sua equipe".
 *
 * O gerente E2E lidera as duas equipes da suíte (Alfa e Beta são criadas com o
 * mesmo `manager_id` em `support/users.ts`), então o par Alfa/Beta NÃO serve
 * para provar o limite dele. O contraexemplo honesto é um negócio de corretor
 * do seed que está numa equipe de outro gerente: esse tem de ficar invisível.
 */
const tag = runTag();
let alfa: { id: string; cliente: string };
let deFora: { id: string; cliente: string };

test.beforeAll(async () => {
  ({ alfa } = await montarDuasEquipes(tag));
  deFora = await criarNegocio(tag, "FORA", await idDoPerfil(CORRETOR_DE_FORA));
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test("gerente vê o negócio do corretor da sua equipe", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);
  await expect(linhaDoCliente(page, alfa.cliente)).toBeVisible();
});

test("gerente não vê negócio de equipe que não lidera", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);

  // Âncora antes da negativa: prova que a lista carregou.
  await expect(linhaDoCliente(page, alfa.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, deFora.cliente)).toHaveCount(0);
});

test("o negócio de fora existe — quem o esconde é o RLS", async () => {
  const linhas = await db.select<{ id: string }>(`deals?id=eq.${deFora.id}&select=id`);
  expect(linhas).toHaveLength(1);
});
