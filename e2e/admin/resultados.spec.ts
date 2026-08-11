import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

/**
 * Consolidado anual.
 *
 * A queixa que originou a tabela `annual_results` foi a discrepância nos
 * relatórios: a tela recalculava o ano inteiro a partir dos negócios a cada
 * abertura, ignorando `closed_months` — mexer num negócio antigo mudava o anual
 * retroativamente. A tela agora LÊ `annual_results`.
 *
 * Então o teste faz as duas pontas: escreve no banco e cobra a leitura; edita
 * na tela e cobra a gravação. Toast não prova gravação — a auditoria recente
 * achou tela que dizia "salvo" sem gravar nada.
 */
const tag = runTag();
const ANO = new Date().getFullYear() + 1; // a tela lista currentYear + 1
const MES = 5;
const VENDAS = 42;
const VGV = 1234567;
const VENDAS_EDITADO = 43;

test.beforeAll(async () => {
  const jaTem = await db.select(`annual_results?year=eq.${ANO}&month=eq.${MES}&select=id`);
  if (jaTem.length) throw new Error(`annual_results já tem ${MES}/${ANO}; o cenário do teste supõe que não`);

  await db.insert("annual_results", {
    year: ANO,
    month: MES,
    sales_count: VENDAS,
    vgv: VGV,
    notes: tag,
  });
});

test.afterAll(async () => {
  await db.remove(`annual_results?year=eq.${ANO}&month=eq.${MES}`);
});

test.describe("resultados anuais", () => {
  test("o consolidado da tela vem de annual_results", async ({ page }) => {
    await page.goto("/resultados");
    await aguardarCarregamento(page);

    const ano = page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) });
    await expect(ano).toContainText(String(VENDAS));
    // 1.234.567 formatado em pt-BR; o separador é o que a tela usa.
    await expect(ano).toContainText("1.234.567");

    await ano.click();
    await expect(page.getByLabel(`Vendas de Maio de ${ANO}`)).toHaveValue(String(VENDAS));
    await expect(page.getByLabel(`VGV de Maio de ${ANO}`)).toHaveValue(String(VGV));
  });

  test("editar um mês grava em annual_results", async ({ page }) => {
    await page.goto("/resultados");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) }).click();
    await page.getByLabel(`Vendas de Maio de ${ANO}`).fill(String(VENDAS_EDITADO));
    await page.getByRole("button", { name: `Salvar Maio de ${ANO}` }).click();

    await expect(page.getByText(`Maio/${ANO} atualizado`)).toBeVisible();

    // A prova é o banco, não o toast.
    await expect
      .poll(async () => {
        const [linha] = await db.select<{ sales_count: number }>(
          `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count`,
        );
        return linha?.sales_count;
      })
      .toBe(VENDAS_EDITADO);

    await expect(page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) })).toContainText(
      String(VENDAS_EDITADO),
    );
  });
});
