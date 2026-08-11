import { test, expect, runTag } from "../support/fixtures";
import { abrirPipelineFiltrado, limparCenario, linhaDoCliente, montarDuasEquipes } from "../matriz/cenario";

/**
 * O espelho do spec do corretor.
 *
 * Sem ele, "corretor A não vê o negócio de B" poderia ser explicado por um
 * negócio que simplesmente não existe ou não renderiza. Aqui é B quem vê o seu
 * e não vê o de A — a mesma regra valendo nos dois sentidos é o que prova
 * isolamento por equipe, e não um acidente do cenário.
 */
const tag = runTag();
let alfa: { id: string; cliente: string };
let beta: { id: string; cliente: string };

test.beforeAll(async () => {
  ({ alfa, beta } = await montarDuasEquipes(tag));
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test("corretor da equipe Beta vê o seu e não vê o da Alfa", async ({ page }) => {
  await abrirPipelineFiltrado(page, tag);

  await expect(linhaDoCliente(page, beta.cliente)).toBeVisible();
  await expect(linhaDoCliente(page, alfa.cliente)).toHaveCount(0);
});
