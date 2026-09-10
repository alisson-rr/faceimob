/**
 * "13. ESTEIRA AGIL" e "RET. ESTEIRA AGIL" são escritos pelo banco quando o
 * caso entra na esteira do CCA e quando volta dela (migration 0037). O Select
 * de Status 2 não pode oferecê-los: escolher à mão dizia que o negócio foi à
 * esteira sem conferência do gerente e sem caso no CCA.
 *
 * O que a tela precisa provar é o par: o rótulo some das opções, mas não some
 * da tela quando já está gravado — senão o negócio que está na esteira abriria
 * o Select em branco (achado F10 de novo).
 */
import { test, expect, runTag } from "../support/fixtures";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  limparNegocios,
  linhaDoNegocio,
  opcoesDe,
  seletor,
  semearNegocio,
} from "../helpers/negocio";

const marca = runTag();
const DO_SISTEMA = ["13. ESTEIRA AGIL", "RET. ESTEIRA AGIL"];

test.afterAll(async () => {
  await limparNegocios(marca);
});

test("negócio em rascunho: o Select da tabela e o do modal não oferecem o rótulo de esteira", async ({ page }) => {
  const cliente = `Esteira Rascunho ${marca}`;
  await semearNegocio({ cliente, statusDetail: "16. PENDENTE" });

  await abrirPipeline(page);
  await buscar(page, cliente);

  const naTabela = await opcoesDe(linhaDoNegocio(page, cliente).getByRole("combobox"));
  for (const rotulo of DO_SISTEMA) expect(naTabela).not.toContain(rotulo);
  expect(naTabela).toContain("PROPOSTA");
  expect(naTabela).toContain("16. PENDENTE");
  // 32 do catálogo menos os 2 do sistema — `statuses.test.ts` trava a conta.
  expect(naTabela).toHaveLength(30);

  const modal = await abrirDetalhe(page, cliente);
  const noModal = await opcoesDe(seletor(modal, "Status da venda (Status 2)"));
  for (const rotulo of DO_SISTEMA) expect(noModal).not.toContain(rotulo);
  expect(noModal).toHaveLength(30);
});

test("rótulo gravado pelo sistema continua aparecendo, e só ele", async ({ page }) => {
  // service_role escreve o rótulo (é o caminho da semente e do serviço); a tela
  // só lê. É o estado de um negócio que já entrou no CCA.
  const cliente = `Esteira Gravada ${marca}`;
  await semearNegocio({ cliente, statusDetail: "13. ESTEIRA AGIL" });

  await abrirPipeline(page);
  await buscar(page, cliente);

  const gatilho = linhaDoNegocio(page, cliente).getByRole("combobox");
  await expect(gatilho).toContainText("13. ESTEIRA AGIL");

  const opcoes = await opcoesDe(gatilho);
  expect(opcoes).toContain("13. ESTEIRA AGIL");
  expect(opcoes).not.toContain("RET. ESTEIRA AGIL");
  expect(opcoes).toHaveLength(31);
});
