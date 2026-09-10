import { test, expect, db, runTag, aguardarCarregamento } from "../support/fixtures";
import {
  abrirPipelineFiltrado,
  criarNegocio,
  limparCenario,
  linhaDoCliente,
  montarDuasEquipes,
} from "../matriz/cenario";

/**
 * O caso que motivou `user_roles` ser N:N (ata de 23/07: "os Diretores possuem
 * a capacidade de atuar em múltiplos papéis").
 *
 * "União dos dois papéis" tem de ser verificável, não retórica. Nesta base a
 * matriz de menu do corretor está contida na do diretor, então a união se
 * observa em duas coisas ao mesmo tempo:
 *   · lado diretor  → visão total do Pipeline + menus que corretor não tem;
 *   · lado corretor → ele próprio é participante de negócio como "Corretor 1".
 * Se um papel apagasse o outro, um dos dois lados quebraria.
 */
const tag = runTag();
let alfa: { id: string; cliente: string };
let beta: { id: string; cliente: string };
let meu: { id: string; cliente: string };

test.beforeAll(async () => {
  ({ alfa, beta } = await montarDuasEquipes(tag));
  meu = await criarNegocio(tag, "DUAL", await db.profileIdOf("dual"));
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test("os dois papéis estão gravados em user_roles", async () => {
  const id = await db.profileIdOf("dual");
  const linhas = await db.select<{ role: string }>(
    `user_roles?profile_id=eq.${id}&select=role`,
  );
  expect(linhas.map((l) => l.role).sort()).toEqual(["broker", "director"]);
});

test("lado diretor: enxerga negócio das duas equipes", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);

  await expect(linhaDoCliente(page, alfa.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, beta.cliente)).toBeVisible();
});

test("lado corretor: aparece como Corretor 1 no próprio negócio", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);

  await expect(linhaDoCliente(page, meu.cliente)).toBeVisible();
  // O nome do corretor sai de `deal_participants`; se o papel de corretor
  // tivesse sido perdido, a linha existiria sem ele.
  await expect(page.getByText(/e2e diretor corretor/i).first()).toBeVisible();

  const participantes = await db.select<{ role: string; profile_id: string }>(
    `deal_participants?deal_id=eq.${meu.id}&select=role,profile_id`,
  );
  const eu = await db.profileIdOf("dual");
  expect(participantes.some((p) => p.profile_id === eu && p.role === "broker")).toBe(true);
});

test("lado diretor: o menu traz o que corretor puro não tem", async ({ page }) => {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);

  // `exact: true`: sem ele o nome casa por SUBSTRING, e quem tem `menu.cca`
  // enxerga DOIS itens contendo "Pipeline" — "Pipeline" (/pipeline) e
  // "CCA Pipeline" (/cca). Sao dois itens legitimos e distintos, nao um menu
  // duplicado: o corretor, que nao tem `menu.cca`, passa neste mesmo assert.
  // O que o teste afirma e "existe o item Pipeline", nao "algum item cita
  // Pipeline". Os `toHaveCount(0)` abaixo ficam por substring de proposito:
  // para negar, o casamento mais largo e o mais rigoroso.
  for (const item of ["Pipeline", "Checkpoint", "Resultados", "Marketing"]) {
    await expect(page.getByRole("link", { name: item, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Permissões" })).toHaveCount(0);
});
