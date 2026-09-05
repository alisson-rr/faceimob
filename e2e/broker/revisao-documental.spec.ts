import { test, expect, db, runTag } from "../support/fixtures";
import { abrirDetalhe, abrirPipeline, buscar, limparNegocios, semearNegocio } from "../helpers/negocio";
import { apagarArquivos, arquivo, campoDeArquivo } from "../cca/esteira";

const tag = runTag();
const cliente = `DOC BROKER ${tag}`;
const clienteSemGerente = `DOC SEM GERENTE ${tag}`;
const clienteDoZero = `DOC DO ZERO ${tag}`;
let dealId: string;
let dealSemGerente: string;
let dealDoZero: string;

/** Os três tipos que o seed marca como `required_for_conversion`. */
const OBRIGATORIOS = ["RG / CPF", "Comprovante de Renda", "Comprovante de Residência"];

async function anexarObrigatorios(id: string) {
  const tipos = await db.select<{ id: string; code: string }>(
    "document_types?active=is.true&required_for_conversion=is.true&select=id,code&order=sort_order",
  );
  await db.insert("deal_documents", tipos.map((tipo) => ({
    deal_id: id,
    document_type_id: tipo.id,
    storage_path: `${id}/e2e-${tipo.code}.pdf`,
    original_name: `${tipo.code}.pdf`,
    stored_name: `${tipo.code}-${tag}.pdf`,
  })));
}

test.beforeAll(async () => {
  const brokerId = await db.profileIdOf("broker");
  dealId = (await semearNegocio({ cliente, brokerId })).id;
  dealSemGerente = (await semearNegocio({ cliente: clienteSemGerente, brokerId })).id;
  dealDoZero = (await semearNegocio({ cliente: clienteDoZero, brokerId })).id;
  await anexarObrigatorios(dealId);
  await anexarObrigatorios(dealSemGerente);

  // `deal_participants_autofill` puxa o gerente da equipe do corretor. Tirar a
  // linha reproduz o negócio real que a auditoria achou na homologação
  // (NEG-000127, 0 gerentes) sem inventar um cenário que não existe.
  await db.remove(`deal_participants?deal_id=eq.${dealSemGerente}&role=eq.manager`);
});

test.afterAll(async () => {
  // O `delete` da linha não tira o binário do bucket: são tabelas diferentes.
  await apagarArquivos(dealDoZero);
  await limparNegocios(tag);
});

test("corretor envia os documentos completos para conferência do gerente", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, cliente);
  const modal = await abrirDetalhe(page, cliente);
  await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

  await expect(modal.getByText("Em preparação", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: /enviar ao gerente/i }).click();

  await expect(modal.getByText("Aguardando gerente", { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const [deal] = await db.select<{ document_review_status: string }>(
      `deals?id=eq.${dealId}&select=document_review_status`,
    );
    return deal.document_review_status;
  }).toBe("pending");
});

/**
 * `submit_deal_for_manager_review` recusa negócio sem gerente vinculado
 * (0028:404). A tela só olhava documentos obrigatórios e construtora: o
 * corretor clicava e recebia a mensagem crua do banco em toast.
 */
test("sem gerente vinculado o botão avisa em vez de deixar o banco recusar", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, clienteSemGerente);
  const modal = await abrirDetalhe(page, clienteSemGerente);
  await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

  await expect(modal.getByText(/vincule ao menos um gerente/i)).toBeVisible();
  await expect(modal.getByRole("button", { name: /enviar ao gerente/i })).toBeDisabled();

  // E o banco continua intocado: nenhuma tentativa parcial.
  const [deal] = await db.select<{ document_review_status: string }>(
    `deals?id=eq.${dealSemGerente}&select=document_review_status`,
  );
  expect(deal.document_review_status).toBe("draft");
});

/**
 * Anexar e enviar na MESMA corrida.
 *
 * Os outros casos semeiam `deal_documents` por service_role, e o upload real só
 * é exercitado num spec que não envia ao gerente: o passo entre "o arquivo
 * subiu" e "o obrigatório foi reconhecido pelo botão" não tinha cobertura.
 */
test("anexar os obrigatórios pela tela libera o envio ao gerente", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, clienteDoZero);
  const modal = await abrirDetalhe(page, clienteDoZero);
  await modal.getByRole("tab", { name: "Anexos", exact: true }).click();

  await expect(modal.getByText(/faltam 3 obrigatórios/i)).toBeVisible();
  await expect(modal.getByRole("button", { name: /enviar ao gerente/i })).toBeDisabled();

  for (const [i, rotulo] of OBRIGATORIOS.entries()) {
    await campoDeArquivo(page, rotulo).setInputFiles(arquivo(`obrigatorio-${i}.pdf`, `doc ${i}`));
    await expect(modal.getByRole("button", { name: /^Baixar / })).toHaveCount(i + 1);
  }

  await expect(modal.getByText(/obrigatórios completos/i)).toBeVisible();
  await modal.getByRole("button", { name: /enviar ao gerente/i }).click();
  await expect(modal.getByText("Aguardando gerente", { exact: true })).toBeVisible();

  await expect.poll(async () => {
    const [deal] = await db.select<{ document_review_status: string }>(
      `deals?id=eq.${dealDoZero}&select=document_review_status`,
    );
    return deal.document_review_status;
  }).toBe("pending");

  // Os arquivos existem de verdade, não só as linhas.
  const docs = await db.select<{ storage_path: string }>(
    `deal_documents?deal_id=eq.${dealDoZero}&select=storage_path`,
  );
  expect(docs).toHaveLength(3);
});
