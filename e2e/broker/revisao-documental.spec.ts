import { test, expect, db, runTag } from "../support/fixtures";
import { abrirDetalhe, abrirPipeline, buscar, limparNegocios, semearNegocio } from "../helpers/negocio";

const tag = runTag();
const cliente = `DOC BROKER ${tag}`;
let dealId: string;

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
  const deal = await semearNegocio({ cliente, brokerId });
  dealId = deal.id;
  await anexarObrigatorios(dealId);
});

test.afterAll(async () => {
  await limparNegocios(tag);
});

test("corretor envia os documentos completos para conferência do gerente", async ({ page }) => {
  await abrirPipeline(page);
  await buscar(page, cliente);
  const modal = await abrirDetalhe(page, cliente);
  await modal.getByRole("button", { name: "Anexos", exact: true }).click();

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
