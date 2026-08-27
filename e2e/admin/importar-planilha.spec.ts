/**
 * Importar planilha de leads — a recusa do `.xls` legado.
 *
 * A Tarefa L trocou o `xlsx` (0.18.5, abandonado no npm com duas CVEs abertas)
 * por `read-excel-file`, e com isso o `.xls` (Excel 97-2003) deixou de ser lido.
 * A troca foi tratada: o seletor **continua aceitando `.xls` de propósito**, para
 * o usuário descobrir o motivo em vez de o arquivo sumir da janela, e a tela
 * explica o que fazer.
 *
 * `importSheet.test.ts` já cobra a mensagem no parser. O que faltava — e é o que
 * este arquivo cobre — é ela **chegar à tela**: um `catch` que virasse
 * `console.error`, ou um estado de erro que ninguém renderizasse, passaria pelo
 * teste de unidade sem que ninguém visse a frase.
 *
 * Nada é gravado aqui: os dois caminhos param antes de confirmar a importação.
 */
import { expect } from "@playwright/test";
import { test, aguardarCarregamento } from "../support/fixtures";

/**
 * Assinatura OLE2 de um Excel 97-2003 — os oito bytes por onde o parser
 * reconhece o formato antigo. O resto é enchimento: a decisão sai do cabeçalho.
 */
const XLS_LEGADO = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(56),
]);

const CSV_VALIDO = Buffer.from(
  ["Cliente,Telefone,E-mail", "Ana Importada,11988887777,ana@example.invalid"].join("\n"),
  "utf8",
);

async function abrirImportacao(page: import("@playwright/test").Page) {
  await page.goto("/leads");
  await aguardarCarregamento(page);
  await page.getByRole("button", { name: /importar planilha/i }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/importar leads \(csv\/xlsx\)/i)).toBeVisible();
  return dialogo;
}

test.describe("leads · importar planilha", () => {
  test("o .xls antigo é recusado com instrução na tela, não com 'formato não reconhecido'", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    // O seletor aceita `.xls` de propósito: filtrar o arquivo na janela do
    // sistema esconderia o motivo da recusa em vez de explicá-lo.
    const entrada = dialogo.locator('input[type="file"]');
    await expect(entrada).toHaveAttribute("accept", ".csv,.xlsx,.xls");

    await entrada.setInputFiles({
      name: "leads-antigos.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: XLS_LEGADO,
    });

    await expect(dialogo.getByText(
      "Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV.",
    )).toBeVisible();

    // E a recusa é mesmo uma recusa: nada de prévia, nada para importar.
    await expect(dialogo.getByRole("button", { name: /importar 0 leads/i })).toBeDisabled();
    await expect(dialogo.getByRole("table")).toHaveCount(0);
  });

  test("contraprova: um CSV válido é lido e mostra a prévia", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    // Sem esta metade, o teste acima passaria também se o dropzone estivesse
    // quebrado e recusasse tudo.
    await dialogo.locator('input[type="file"]').setInputFiles({
      name: "leads-teste.csv",
      mimeType: "text/csv",
      buffer: CSV_VALIDO,
    });

    await expect(dialogo.getByText(/1 leads/i).first()).toBeVisible();
    await expect(dialogo.getByRole("cell", { name: "Ana Importada" })).toBeVisible();
    await expect(dialogo.getByText(/formato antigo/i)).toHaveCount(0);

    // Sai sem importar: este arquivo não pode virar lead no banco compartilhado.
    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(dialogo).toBeHidden();
  });
});
