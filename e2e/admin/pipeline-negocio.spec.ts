/**
 * Pipeline · persistência do negócio ponta a ponta (visão admin).
 *
 * Rede de segurança da correção de 08/08: até então o modal de detalhe mostrava
 * "Alterações salvas" e não gravava nada, e a criação de negócio só existia em
 * memória. Por isso toda asserção aqui termina no banco (`db.select`) e o
 * caminho crítico ainda recarrega a página antes de conferir — toast e estado
 * de React não provam gravação.
 */
import { test, expect, db, runTag } from "../support/fixtures";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  campo,
  clientesDe,
  confirmarModal,
  escolher,
  limparNegocios,
  linhaDoNegocio,
  negocioPorCliente,
  opcoesDe,
  participantesDe,
  primeiraConstrutora,
  seletor,
  semearNegocio,
} from "../helpers/negocio";

const marca = runTag();
const nomeCliente = (prefixo: string) => `${prefixo} ${marca}`;

test.afterAll(async () => {
  await limparNegocios(marca);
});

test("cria negócio pela tela e grava deals, deal_clients e deal_participants", async ({ page }) => {
  const cliente = nomeCliente("Ana Criacao");
  const construtora = await primeiraConstrutora();
  const [empreendimento] = await db.select<{ name: string }>(
    `developer_projects?developer_id=eq.${construtora.id}&select=name&order=name&limit=1`,
  );

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByText("Novo Deal")).toBeVisible();

  await campo(modal, "Cliente *").fill(cliente);
  await escolher(seletor(modal, "Incorporadora"), construtora.name);
  await escolher(seletor(modal, "Empreendimento"), empreendimento.name);
  await campo(modal, "Unidade").fill("101");
  await escolher(seletor(modal, "Corretor 1"), "E2E Corretor");
  await escolher(seletor(modal, "Gerente 1"), "E2E Gerente");
  await campo(modal, "Valor").fill("500000");
  await modal.getByRole("button", { name: /criar deal/i }).click();
  await expect(modal).toBeHidden();

  const negocio = await negocioPorCliente(cliente);
  expect(negocio.unit).toBe("101");
  expect(Number(negocio.vgv_gross)).toBe(500000);
  expect(negocio.developer_id).toBe(construtora.id);
  expect(negocio.project_id).not.toBeNull();

  const clientes = await clientesDe(negocio.id);
  expect(clientes).toHaveLength(1);
  expect(clientes[0].full_name).toBe(cliente);
  expect(clientes[0].ordinal).toBe(1);

  const participantes = await participantesDe(negocio.id);
  const corretores = participantes.filter((p) => p.role === "broker");
  expect(corretores.map((p) => p.profile_id)).toEqual([await db.profileIdOf("broker")]);
  expect(Number(corretores[0].share_pct)).toBe(100);
  expect(participantes.filter((p) => p.role === "manager").map((p) => p.profile_id))
    .toContain(await db.profileIdOf("manager"));

  // Só existe de verdade se aparece na listagem depois de recarregar.
  await abrirPipeline(page);
  await buscar(page, cliente);
  await expect(linhaDoNegocio(page, cliente)).toBeVisible();
});

test("catálogos de construtora e corretor vêm do banco, não de lista fixa", async ({ page }) => {
  const construtoras = await db.select<{ name: string }>(
    "developers?active=is.true&select=name&order=name",
  );
  expect(construtoras.length, "seed sem construtoras — cenário inválido").toBeGreaterThan(0);

  await abrirPipeline(page);
  await page.getByRole("button", { name: /adicionar negócio/i }).click();
  const modal = page.getByRole("dialog");

  expect(await opcoesDe(seletor(modal, "Incorporadora"))).toEqual(
    construtoras.map((c) => c.name),
  );

  const corretores = await opcoesDe(seletor(modal, "Corretor 1"));
  expect(corretores.length).toBeGreaterThan(0);
  expect(corretores).toContain("E2E Corretor");
});

test("modal de detalhe: cliente, CPF, VGV, corretores e gerentes sobrevivem ao reload", async ({ page }) => {
  const original = nomeCliente("Bruno Original");
  const corrigido = nomeCliente("Bruno Corrigido");
  const negocio = await semearNegocio({ cliente: original });

  await abrirPipeline(page);
  await buscar(page, original);
  const modal = await abrirDetalhe(page, original);

  await campo(modal, "Cliente").first().fill(corrigido);
  await campo(modal, "CPF").first().fill("529.982.247-25");
  await campo(modal, "VGV Bruto").fill("750000");
  await campo(modal, "Perc. Desconto").fill("10");
  await escolher(seletor(modal, "Corretor 1 (Obrigatório)"), "E2E Corretor");
  await escolher(seletor(modal, "Corretor 2 (opcional)"), "E2E Corretor Rival");
  await escolher(seletor(modal, "Gerente 1 (Obrigatório)"), "E2E Gerente");
  await escolher(seletor(modal, "Gerente 2 (opcional)"), "E2E Diretor");
  await confirmarModal(page, modal);

  // 1) Banco: é aqui que a regressão de 08/08 aparecia (tela dizia "salvo",
  //    banco continuava com o valor antigo).
  const gravado = await negocioPorCliente(corrigido);
  expect(gravado.id).toBe(negocio.id);
  expect(Number(gravado.vgv_gross)).toBe(750000);
  expect(Number(gravado.discount_pct)).toBe(10);
  expect(Number(gravado.vgv_net)).toBe(675000);

  const clientes = await clientesDe(negocio.id);
  expect(clientes[0].full_name).toBe(corrigido);
  expect(clientes[0].cpf).toBe("529.982.247-25");

  const participantes = await participantesDe(negocio.id);
  expect(participantes.filter((p) => p.role === "broker").map((p) => p.profile_id).sort())
    .toEqual([await db.profileIdOf("broker"), await db.profileIdOf("brokerRival")].sort());
  // Ata 23/07: gerente 1 e 2 escolhidos na tela viram participante 'manager'.
  const gerentes = participantes.filter((p) => p.role === "manager").map((p) => p.profile_id);
  expect(gerentes).toContain(await db.profileIdOf("manager"));
  expect(gerentes).toContain(await db.profileIdOf("director"));

  // 2) Tela, depois de recarregar de verdade.
  await abrirPipeline(page);
  await buscar(page, corrigido);
  const reaberto = await abrirDetalhe(page, corrigido);
  await expect(campo(reaberto, "Cliente").first()).toHaveValue(corrigido);
  await expect(campo(reaberto, "CPF").first()).toHaveValue("529.982.247-25");
  await expect(campo(reaberto, "VGV Bruto")).toHaveValue("750000");
  await expect(seletor(reaberto, "Corretor 1 (Obrigatório)")).toContainText("E2E Corretor");
  await expect(seletor(reaberto, "Gerente 1 (Obrigatório)")).toContainText("E2E Gerente");
});

test("rateio de VGV fecha 100% com 2 e com 3 corretores", async ({ page }) => {
  const cliente = nomeCliente("Carla Rateio");
  const negocio = await semearNegocio({ cliente });

  await abrirPipeline(page);
  await buscar(page, cliente);
  let modal = await abrirDetalhe(page, cliente);
  await escolher(seletor(modal, "Corretor 1 (Obrigatório)"), "E2E Corretor");
  await escolher(seletor(modal, "Corretor 2 (opcional)"), "E2E Corretor Rival");
  await confirmarModal(page, modal);

  let corretores = (await participantesDe(negocio.id)).filter((p) => p.role === "broker");
  expect(corretores).toHaveLength(2);
  expect(corretores.map((p) => Number(p.share_pct))).toEqual([50, 50]);

  await buscar(page, cliente);
  modal = await abrirDetalhe(page, cliente);
  await escolher(seletor(modal, "Corretor 3 (opcional)"), "E2E Diretor Corretor");
  await confirmarModal(page, modal);

  corretores = (await participantesDe(negocio.id)).filter((p) => p.role === "broker");
  expect(corretores).toHaveLength(3);
  const soma = corretores.reduce((total, p) => total + Number(p.share_pct), 0);
  expect(soma, "o resto do arredondamento tem que sobrar para alguém").toBe(100);
  for (const p of corretores) expect(Number(p.share_pct)).toBeGreaterThan(33);

  // Gerente e diretor acompanham, mas não dividem VGV.
  const acompanhantes = (await participantesDe(negocio.id)).filter((p) => p.role !== "broker");
  for (const p of acompanhantes) expect(Number(p.share_pct)).toBe(0);
});

test("Status 2 escolhido na tabela grava em deals.status_detail e volta no reload", async ({ page }) => {
  const cliente = nomeCliente("Diego Status");
  const negocio = await semearNegocio({ cliente });
  const rotulo = "13. ESTEIRA AGIL";

  await abrirPipeline(page);
  await buscar(page, cliente);
  await escolher(linhaDoNegocio(page, cliente).getByRole("combobox"), rotulo);

  await expect
    .poll(async () => (await negocioPorCliente(cliente)).status_detail, {
      message: "Status 2 precisa chegar em deals.status_detail",
    })
    .toBe(rotulo);
  expect((await negocioPorCliente(cliente)).id).toBe(negocio.id);

  await abrirPipeline(page);
  await buscar(page, cliente);
  await expect(linhaDoNegocio(page, cliente).getByRole("combobox")).toContainText(rotulo);
});

test("filtro de mês reduz a tabela ao mês pedido", async ({ page }) => {
  const janeiro = nomeCliente("Elis Janeiro");
  const fevereiro = nomeCliente("Elis Fevereiro");
  await semearNegocio({ cliente: janeiro, monthBase: "2030-01-01" });
  await semearNegocio({ cliente: fevereiro, monthBase: "2030-02-01" });

  await abrirPipeline(page);
  await page.getByRole("button", { name: /filtrar negócio/i }).click();
  await page.getByPlaceholder("03/2026").fill("01/2030");

  await expect(linhaDoNegocio(page, janeiro)).toBeVisible();
  await expect(linhaDoNegocio(page, fevereiro)).toHaveCount(0);

  await page.getByPlaceholder("03/2026").fill("02/2030");
  await expect(linhaDoNegocio(page, fevereiro)).toBeVisible();
  await expect(linhaDoNegocio(page, janeiro)).toHaveCount(0);
});

test("filtro de Status 2 reduz a tabela ao rótulo pedido", async ({ page }) => {
  const esteira = nomeCliente("Fabio Esteira");
  const pendente = nomeCliente("Fabio Pendente");
  await semearNegocio({ cliente: esteira, statusDetail: "13. ESTEIRA AGIL" });
  await semearNegocio({ cliente: pendente, statusDetail: "16. PENDENTE" });

  await abrirPipeline(page);
  await page.getByRole("button", { name: /filtrar negócio/i }).click();
  // Pelo nome acessível, não pelo texto atual: o gatilho passa a mostrar o
  // valor escolhido, então um locator baseado no texto deixa de casar logo
  // depois do clique.
  await escolher(page.getByRole("combobox", { name: "Status 2" }), "13. ESTEIRA AGIL");

  await expect(linhaDoNegocio(page, esteira)).toBeVisible();
  await expect(linhaDoNegocio(page, pendente)).toHaveCount(0);
});

test("comentário manual do histórico grava em deal_history com kind='comment'", async ({ page }) => {
  const cliente = nomeCliente("Gabi Historico");
  const negocio = await semearNegocio({ cliente });
  const texto = `Cliente pediu retorno na segunda ${marca}`;

  await abrirPipeline(page);
  await buscar(page, cliente);
  const modal = await abrirDetalhe(page, cliente);

  const caixa = modal.getByPlaceholder(/digite aqui o novo histórico/i);
  await caixa.fill(texto);
  await caixa.locator("xpath=following-sibling::button[1]").click();

  await expect(modal.getByText(texto)).toBeVisible();
  await expect(caixa).toHaveValue("");

  const historico = await db.select<{ kind: string; to_value: string; actor_id: string }>(
    `deal_history?deal_id=eq.${negocio.id}&kind=eq.comment&select=kind,to_value,actor_id`,
  );
  expect(historico).toHaveLength(1);
  expect(historico[0].to_value).toBe(texto);
  expect(historico[0].actor_id).toBe(await db.profileIdOf("admin"));
});
