import { test, expect, db, runTag, aguardarCarregamento } from "../support/fixtures";
import { CORRETOR_DE_FORA, idDoPerfil } from "../matriz/cenario";

/**
 * Ata de 23/07: "gerentes veem o desempenho de sua equipe". Na agenda quem
 * recorta é o RLS de `tasks` (`assigned_to` em `auth_visible_profiles()`), sem
 * filtro de papel na tela.
 *
 * O gerente E2E lidera Alfa E Beta (`support/users.ts`), então a atividade do
 * brokerRival é visível por construção e não serve de contraexemplo — o mesmo
 * motivo de `manager/visibilidade.spec.ts`. O invisível honesto é um corretor
 * do seed numa equipe de outro gerente.
 */
const tag = runTag();
let daEquipe = "";
let doColega = "";
let deFora = "";

test.beforeAll(async () => {
  daEquipe = `Cobrar documentos ${tag}`;
  doColega = `Confirmar visita ${tag}`;
  deFora = `Retornar ligação ${tag}`;
  await db.insert("tasks", [
    { title: daEquipe, assigned_to: await db.profileIdOf("broker"), due_at: "2020-01-01T10:00:00Z" },
    { title: doColega, assigned_to: await db.profileIdOf("brokerThird"), due_at: "2030-01-01T10:00:00Z" },
    { title: deFora, assigned_to: await idDoPerfil(CORRETOR_DE_FORA), due_at: "2020-01-01T10:00:00Z" },
  ]);
});

test.afterAll(async () => {
  await db.remove(`tasks?title=like.*${tag}*`);
});

test("gerente vê a atividade do corretor da equipe alfa e não a de fora", async ({ page }) => {
  await page.goto("/atividades");
  await aguardarCarregamento(page);

  // Âncora antes da negativa: prova que a lista carregou.
  await expect(page.getByText(daEquipe, { exact: true })).toBeVisible();
  await expect(page.getByText(deFora, { exact: true })).toHaveCount(0);
});

test("a atividade de fora existe — quem a esconde é o RLS", async () => {
  const rows = await db.select<{ id: string }>(
    `tasks?title=eq.${encodeURIComponent(deFora)}&select=id`,
  );
  expect(rows).toHaveLength(1);
});

test("o filtro por responsável isola um corretor da equipe", async ({ page }) => {
  await page.goto("/atividades");
  await aguardarCarregamento(page);
  await expect(page.getByText(doColega, { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Responsável" }).click();
  await page.getByRole("option", { name: "E2E Corretor", exact: true }).click();

  await expect(page.getByText(daEquipe, { exact: true })).toBeVisible();
  await expect(page.getByText(doColega, { exact: true })).toHaveCount(0);
});
