import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import {
  abaDoModal,
  abrirNegocio,
  comSessao,
  criarCenario,
  estagioCca,
  limparCenario,
  semearCasoCca,
  semearDocumento,
  type Cenario,
  type DocumentoDoNegocio,
} from "./esteira";

test.describe.serial("CCA · análise, decisão e envio", () => {
  let cenario: Cenario;
  let casoId = "";
  let documento: DocumentoDoNegocio;

  test.beforeAll(async () => {
    cenario = await criarCenario({ dono: "broker", etapa: "under_analysis", apelido: "Credito" });
    await db.update(`deals?id=eq.${cenario.dealId}`, { document_review_status: "approved" });
    const etapa = await estagioCca("under_review");
    const [caso] = await semearCasoCca(cenario, "under_review", etapa.id);
    casoId = caso.id;
    documento = await semearDocumento(cenario, "rg_cpf");
  });

  test.afterAll(async () => {
    await limparCenario(cenario);
  });

  test("registra análise, aprova com histórico e reprocessa o dossiê", async ({ page }) => {
    await comSessao(page, "cca");

    await abrirNegocio(page, cenario.cliente);
    await abaDoModal(page, /^cca$/i).click();
    // Os campos da aba CCA ganharam `useId` + `<Label htmlFor>` na Tarefa H
    // (achado X04): o placeholder deixou de ser a única pista do que é o campo.
    await page.getByLabel("Renda aprovada", { exact: true }).fill("R$ 8.500,00");
    await page.getByRole("button", { name: /confirmar alterações/i }).click();
    await expect(page.getByText("Alterações salvas", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const [row] = await db.select<{ analysis: Record<string, string> }>(
        `cca_cases?id=eq.${casoId}&select=analysis`,
      );
      return row?.analysis?.renda_aprovada;
    }).toBe("R$ 8.500,00");

    await page.goto("/cca");
    await aguardarCarregamento(page);
    // O cartão virou `<article>` e o "Mover p/ X" — que só aparecia no hover,
    // em 8 px (achado X02) — virou um `<Select>` **sempre visível**, com nome
    // acessível. Sem hover: quem usa no celular não tem hover para dar.
    const card = page.getByRole("article").filter({ hasText: cenario.cliente });
    await expect(card).toHaveCount(1);
    await card.getByRole("combobox", { name: `Mover ${cenario.cliente} para outro estágio` }).click();
    await page.getByRole("option", { name: "Aprovado", exact: true }).click();
    await page.getByLabel("Observações", { exact: true }).fill("Crédito aprovado no teste E2E");
    await page.getByRole("button", { name: /^confirmar$/i }).click();
    // O aviso passou a ser "Caso movido — <cliente> → <estágio>".
    await expect(page.getByText("Caso movido", { exact: true })).toBeVisible();
    await expect(page.getByText(`${cenario.cliente} → Aprovado.`)).toBeVisible();

    await expect.poll(async () => {
      const [row] = await db.select<{ status: string }>(`cca_cases?id=eq.${casoId}&select=status`);
      return row?.status;
    }).toBe("approved");

    const [deal] = await db.select<{ pipeline_stages: { code: string } }>(
      `deals?id=eq.${cenario.dealId}&select=pipeline_stages(code)`,
    );
    expect(deal.pipeline_stages.code).toBe("approved");
    expect(await db.select(`cca_case_events?case_id=eq.${casoId}&kind=eq.status_changed&to_value=eq.approved&select=id`)).toHaveLength(1);
    expect(await db.select(`deal_history?deal_id=eq.${cenario.dealId}&kind=eq.cca_status_changed&to_value=eq.approved&select=id`)).toHaveLength(1);

    await card.getByRole("button", { name: /enviar à construtora/i }).click();
    await page.getByPlaceholder("analise@construtora.com.br").fill("credito@construtora.test");
    await page.getByRole("button", { name: /enfileirar envio/i }).click();
    await expect(page.getByText("Envio na fila", { exact: true })).toBeVisible();

    const [submission] = await db.select<{
      id: string;
      status: string;
      attempts: number;
      document_ids: string[];
    }>(`developer_submissions?deal_id=eq.${cenario.dealId}&select=id,status,attempts,document_ids`);
    expect(submission.status).toBe("queued");
    expect(submission.document_ids).toEqual([documento.id]);

    await db.update(`developer_submissions?id=eq.${submission.id}`, {
      status: "failed",
      attempts: 3,
      last_error: "SMTP indisponível",
    });
    // Dois "Fechar" na página: o do rodapé do diálogo e o "×" do primitivo
    // `dialog.tsx`, que ganhou `sr-only` "Fechar" (achado X03). Ancorar no
    // diálogo aberto resolve sem depender de qual dos dois vem primeiro.
    await page.getByRole("dialog").getByRole("button", { name: /^fechar$/i }).first().click();
    await card.getByRole("button", { name: /enviar à construtora/i }).click();
    await page.getByRole("button", { name: /reenviar/i }).click();
    await expect(page.getByText("Reenfileirado", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const [row] = await db.select<{ status: string; attempts: number; last_error: string | null }>(
        `developer_submissions?id=eq.${submission.id}&select=status,attempts,last_error`,
      );
      return row;
    }).toEqual({ status: "queued", attempts: 0, last_error: null });
  });
});
