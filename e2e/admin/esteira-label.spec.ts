/**
 * "13. ESTEIRA AGIL", "RET. ESTEIRA AGIL" e "15. ANÁLISE P/ VIRAR NEGÓCIO" são
 * escritos pelo banco quando o caso entra na esteira do CCA, volta dela ou vai
 * no 2º envio (migrations 0037 e 0150). O Select de Status 2 não pode
 * oferecê-los: escolher à mão dizia que o negócio foi à esteira sem conferência
 * do gerente e sem caso no CCA.
 *
 * O que a tela precisa provar é o par: o rótulo some das opções, mas não some
 * da tela quando já está gravado — senão o negócio que está na esteira abriria
 * o Select em branco (achado F10 de novo).
 *
 * Desde a 0149 as opções saem do catálogo do banco (`deal_statuses`) e o texto
 * exibido é o `label` dele. Por isso a conta esperada é lida do banco: um número
 * fixo aqui quebraria no primeiro status que o administrador cadastrar, sem
 * provar nada sobre a regra.
 */
import { test, expect, db, runTag } from "../support/fixtures";
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
const DO_SISTEMA = ["13. ESTEIRA AGIL", "RET. ESTEIRA AGIL", "15. ANÁLISE P/ VIRAR NEGÓCIO"];

type LinhaDoCatalogo = { value: string; label: string; active: boolean };

const catalogo = () => db.select<LinhaDoCatalogo>("deal_statuses?select=value,label,active");

function nomeNoCatalogo(linhas: LinhaDoCatalogo[], value: string): string {
  const linha = linhas.find((row) => row.value === value);
  if (!linha) throw new Error(`Status 2 "${value}" não está no catálogo`);
  return linha.label;
}

/** O que o Select oferece: ativos, sem os do sistema, mais o valor gravado. */
const escolhiveis = (linhas: LinhaDoCatalogo[], atual: string) =>
  linhas
    .filter((row) => row.value === atual || (row.active && !DO_SISTEMA.includes(row.value)))
    .map((row) => row.label)
    .sort();

test.afterAll(async () => {
  await limparNegocios(marca);
});

test("negócio em rascunho: o Select da tabela e o do modal não oferecem o rótulo de esteira", async ({ page }) => {
  const cliente = `Esteira Rascunho ${marca}`;
  await semearNegocio({ cliente, statusDetail: "16. PENDENTE" });
  const linhas = await catalogo();

  await abrirPipeline(page);
  await buscar(page, cliente);

  const naTabela = await opcoesDe(linhaDoNegocio(page, cliente).getByRole("combobox", { name: /^Status 2 de/ }));
  for (const rotulo of DO_SISTEMA) expect(naTabela).not.toContain(nomeNoCatalogo(linhas, rotulo));
  expect(naTabela).toContain(nomeNoCatalogo(linhas, "16. PENDENTE"));
  expect([...naTabela].sort()).toEqual(escolhiveis(linhas, "16. PENDENTE"));

  const modal = await abrirDetalhe(page, cliente);
  const noModal = await opcoesDe(seletor(modal, "Status da venda (Status 2)"));
  for (const rotulo of DO_SISTEMA) expect(noModal).not.toContain(nomeNoCatalogo(linhas, rotulo));
  expect([...noModal].sort()).toEqual(escolhiveis(linhas, "16. PENDENTE"));
});

test("rótulo gravado pelo sistema continua aparecendo, e só ele", async ({ page }) => {
  // service_role escreve o rótulo (é o caminho da semente e do serviço); a tela
  // só lê. É o estado de um negócio que já entrou no CCA.
  const cliente = `Esteira Gravada ${marca}`;
  await semearNegocio({ cliente, statusDetail: "13. ESTEIRA AGIL" });
  const linhas = await catalogo();

  await abrirPipeline(page);
  await buscar(page, cliente);

  const gatilho = linhaDoNegocio(page, cliente).getByRole("combobox", { name: /^Status 2 de/ });
  await expect(gatilho).toContainText(nomeNoCatalogo(linhas, "13. ESTEIRA AGIL"));

  const opcoes = await opcoesDe(gatilho);
  expect(opcoes).toContain(nomeNoCatalogo(linhas, "13. ESTEIRA AGIL"));
  expect(opcoes).not.toContain(nomeNoCatalogo(linhas, "RET. ESTEIRA AGIL"));
  expect(opcoes).not.toContain(nomeNoCatalogo(linhas, "15. ANÁLISE P/ VIRAR NEGÓCIO"));
  expect([...opcoes].sort()).toEqual(escolhiveis(linhas, "13. ESTEIRA AGIL"));
});
