/** Corretor enxerga os gerentes vinculados ao próprio negócio, inclusive vários. */
import { test, expect, db, runTag } from "../support/fixtures";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  campo,
  escolher,
  limparNegocios,
  negocioPorCliente,
  participantesDe,
  primeiraConstrutora,
  seletor,
  semearNegocio,
} from "../helpers/negocio";

const marca = runTag();
const cliente = `Gerentes Visíveis ${marca}`;

test.afterAll(async () => limparNegocios(marca));

test("mostra todos os gerentes do negócio sem abrir o cadastro da empresa", async ({ page }) => {
  const brokerId = await db.profileIdOf("broker");
  const segundoGerenteId = await db.profileIdOf("director");
  const negocio = await semearNegocio({ cliente, brokerId });

  // O primeiro gerente entra pelo autofill da equipe; o segundo prova a relação N:N.
  await db.insert("deal_participants", {
    deal_id: negocio.id,
    profile_id: segundoGerenteId,
    role: "manager",
  });

  await abrirPipeline(page);
  await buscar(page, cliente);
  const modal = await abrirDetalhe(page, cliente);

  await expect(seletor(modal, "Gerente 1 *")).toContainText("E2E Gerente");
  await expect(seletor(modal, "Gerente 2")).toContainText("E2E Diretor");
});

test("corretor que cria o negócio entra como Corretor 1 com 100% do rateio", async ({ page }) => {
  // Contraprova da 0048, que passou a gravar o papel REAL de quem cria: o
  // caminho comum não pode ter mudado. Corretor continua sendo corretor, com o
  // rateio inteiro enquanto for o único — é dele que saem os pontos de venda.
  const cliente = `Corretor Criador ${marca}`;
  const construtora = await primeiraConstrutora();
  const [empreendimento] = await db.select<{ name: string }>(
    `developer_projects?developer_id=eq.${construtora.id}&select=name&order=name&limit=1`,
  );

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();

  const modal = page.getByRole("dialog");
  // "Corretor 1" já chega preenchido com quem está logado: é o próprio corretor
  // cadastrando o atendimento dele.
  await expect(seletor(modal, "Corretor 1 *")).toContainText("E2E Corretor");
  await campo(modal, "Cliente *").fill(cliente);
  // Construtora e empreendimento entraram no cenário porque o asterisco dos dois
  // passou a valer na CRIAÇÃO (`dealRequiredError`): sem eles o negócio nem
  // chega ao banco, e o que este teste quer provar é o rateio do gatilho, não a
  // validação. O corretor enxerga os dois catálogos — `developers_select` e
  // `developer_projects_select` são `using (true)` para todo autenticado.
  await escolher(seletor(modal, "Construtora *"), construtora.name);
  await escolher(seletor(modal, "Empreendimento"), empreendimento.name);
  await campo(modal, "VGV bruto").fill("300000");
  await modal.getByRole("button", { name: /criar negócio/i }).click();
  await expect(modal).toBeHidden();

  const negocio = await negocioPorCliente(cliente);
  const corretores = (await participantesDe(negocio.id)).filter((p) => p.role === "broker");
  expect(corretores.map((p) => p.profile_id)).toEqual([await db.profileIdOf("broker")]);
  expect(Number(corretores[0].share_pct)).toBe(100);
});
