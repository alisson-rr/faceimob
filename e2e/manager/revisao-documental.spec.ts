import { test, expect, db, runTag } from "../support/fixtures";
import { abrirDetalhe, abrirPipeline, buscar, idDaEtapa, limparNegocios, semearNegocio } from "../helpers/negocio";

const tag = runTag();
const clienteAprovacao = `DOC APROVAR ${tag}`;
const clienteDevolucao = `DOC DEVOLVER ${tag}`;
let dealAprovacao: string;
let dealDevolucao: string;
let brokerId: string;

async function prepararPendente(dealId: string) {
  const tipos = await db.select<{ id: string; code: string }>(
    "document_types?active=is.true&required_for_conversion=is.true&select=id,code&order=sort_order",
  );
  await db.insert("deal_documents", tipos.map((tipo) => ({
    deal_id: dealId,
    document_type_id: tipo.id,
    storage_path: `${dealId}/e2e-${tipo.code}.pdf`,
    original_name: `${tipo.code}.pdf`,
    stored_name: `${tipo.code}-${tag}.pdf`,
  })));
  await db.update(`deals?id=eq.${dealId}`, {
    document_review_status: "pending",
    document_review_requested_at: new Date().toISOString(),
    document_review_requested_by: brokerId,
  });
}

test.beforeAll(async () => {
  brokerId = await db.profileIdOf("broker");
  dealAprovacao = (await semearNegocio({ cliente: clienteAprovacao, brokerId })).id;
  dealDevolucao = (await semearNegocio({ cliente: clienteDevolucao, brokerId })).id;
  await prepararPendente(dealAprovacao);
  await prepararPendente(dealDevolucao);
});

test.afterAll(async () => {
  await limparNegocios(tag);
});

test("um gerente vinculado aprova e o negócio entra no CCA", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, clienteAprovacao);
  const modal = await abrirDetalhe(page, clienteAprovacao);
  await modal.getByRole("button", { name: "Anexos", exact: true }).click();

  await expect(modal.getByText("Aguardando gerente", { exact: true })).toBeVisible();
  await modal.getByRole("button", { name: /aprovar e enviar ao cca/i }).click();

  await expect(modal.getByText("Aprovado pelo gerente", { exact: true })).toBeVisible();
  const analysisStageId = await idDaEtapa("under_analysis");
  await expect.poll(async () => {
    const [deal] = await db.select<{ document_review_status: string; stage_id: string }>(
      `deals?id=eq.${dealAprovacao}&select=document_review_status,stage_id`,
    );
    return deal;
  }).toEqual({ document_review_status: "approved", stage_id: analysisStageId });

  const cases = await db.select<{ id: string }>(`cca_cases?deal_id=eq.${dealAprovacao}&select=id`);
  expect(cases).toHaveLength(1);
});

test("gerente só devolve com motivo e o corretor é notificado", async ({ page }) => {
  const motivo = `Documento ilegível ${tag}`;
  await abrirPipeline(page);
  await buscar(page, clienteDevolucao);
  const modal = await abrirDetalhe(page, clienteDevolucao);
  await modal.getByRole("button", { name: "Anexos", exact: true }).click();

  const devolver = modal.getByRole("button", { name: "Devolver", exact: true });
  await expect(devolver).toBeDisabled();
  await modal.getByRole("textbox", { name: "Motivo da devolução" }).fill(motivo);
  await expect(devolver).toBeEnabled();
  await devolver.click();

  await expect(modal.getByText("Devolvido para correção", { exact: true })).toBeVisible();
  await expect(modal.getByText(motivo, { exact: true })).toBeVisible();
  await expect.poll(async () => {
    const rows = await db.select<{ body: string }>(
      `notifications?profile_id=eq.${brokerId}&kind=eq.document_review_returned&body=eq.${encodeURIComponent(motivo)}&select=body`,
    );
    return rows.length;
  }).toBe(1);
});
