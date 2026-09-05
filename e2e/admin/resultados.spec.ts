import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import type { Page } from "@playwright/test";

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

/** Seletor "Pré-visualizar como papel" da barra do topo — só o admin tem. */
async function verComo(page: Page, papel: string) {
  await page.getByRole("combobox", { name: "Pré-visualizar como papel" }).click();
  await page.getByRole("option", { name: `Ver como ${papel}` }).click();
}

/** O ano de teste nasce recolhido; a prévia não remonta a tela, mas não vale supor. */
async function abrirAno(page: Page) {
  const gatilho = page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) });
  if ((await gatilho.getAttribute("aria-expanded")) !== "true") await gatilho.click();
}

test.describe("resultados anuais · quem lança", () => {
  /**
   * A policy `annual_results_write` é `has_any_role('admin','director')`, mas a
   * tela liberava campo, "Salvar" e "Recalcular" por `reports.view_finance` —
   * que marketing e sócio também têm. Eles recebiam um formulário que o banco
   * recusa (e o recálculo do marketing, sem negócio visível, terminava em falso
   * sucesso). A prévia de papel é o jeito de cobrar isso de dentro da sessão
   * do admin; ela é client-side e some no próximo carregamento.
   */
  test("marketing e sócio leem; diretor lança", async ({ page }) => {
    // A suíte é serial e o teste de edição acima deixa o mês com outro valor;
    // o que se cobra aqui é que o select deles funciona, não um número fixo.
    const [{ sales_count: vendasNoBanco }] = await db.select<{ sales_count: number }>(
      `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count`,
    );

    await page.goto("/resultados");
    await aguardarCarregamento(page);

    const salvar = page.getByRole("button", { name: `Salvar Maio de ${ANO}` });
    const recalcular = page.getByRole("button", { name: `Recalcular ${ANO} pelo pipeline` });
    const vendas = page.getByLabel(`Vendas de Maio de ${ANO}`);

    for (const papel of ["Marketing", "Sócio"]) {
      await verComo(page, papel);
      await abrirAno(page);
      await expect(page.getByText(/somente leitura/i)).toBeVisible();
      await expect(salvar).toHaveCount(0);
      await expect(recalcular).toHaveCount(0);
      await expect(vendas).toBeDisabled();
      // O consolidado continua legível: o select deles é permitido.
      await expect(vendas).toHaveValue(String(vendasNoBanco));
    }

    await verComo(page, "Diretor");
    await abrirAno(page);
    await expect(page.getByText(/somente leitura/i)).toHaveCount(0);
    await expect(salvar).toBeVisible();
    await expect(vendas).toBeEnabled();

    /**
     * "Recalcular" é só do admin, e a razão não é permissão de escrita — é o
     * recorte da LEITURA. A origem do número é `listLegacyDeals()`, que lê
     * `deals` sob RLS: o diretor enxerga a própria hierarquia, enquanto
     * `annual_results` é da casa inteira. O recálculo dele reescreveria o ano
     * com um pipeline parcial e zeraria os meses das outras diretorias — e
     * gravação irreversível não pode depender de o operador adivinhar isso.
     */
    await expect(recalcular, "o diretor lança mês a mês, mas não recalcula o ano").toHaveCount(0);
  });
});


test.describe("resultados anuais · o que não pode se perder", () => {
  /**
   * `upsertAnnualResult` manda `notes: input.notes ?? null` e a tela nunca
   * passava `notes`: o primeiro "Salvar" apagava em silêncio o texto que
   * explica o número ("Parcial do mês corrente…"). As 4 linhas da homologação
   * tinham nota preenchida.
   */
  test("salvar um mês não apaga a nota que só o banco tem", async ({ page }) => {
    const nota = `nota-preservada-${tag}`;
    await db.update(`annual_results?year=eq.${ANO}&month=eq.${MES}`, { notes: nota });

    await page.goto("/resultados");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) }).click();

    const vendas = page.getByLabel(`Vendas de Maio de ${ANO}`);
    const novoValor = String(Number(await vendas.inputValue()) + 1);
    await vendas.fill(novoValor);
    await page.getByRole("button", { name: `Salvar Maio de ${ANO}` }).click();

    await expect
      .poll(async () => {
        const [linha] = await db.select<{ sales_count: number }>(
          `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count`,
        );
        return String(linha?.sales_count);
      })
      .toBe(novoValor);

    const [linha] = await db.select<{ notes: string | null }>(
      `annual_results?year=eq.${ANO}&month=eq.${MES}&select=notes`,
    );
    expect(linha.notes, "a nota do banco não pode sumir num salvamento de número").toBe(nota);
  });

  /** Vendas é `int` no banco: o erro aparecia só depois do clique, em inglês. */
  test("o formulário recusa venda fracionada antes de chamar o banco", async ({ page }) => {
    await page.goto("/resultados");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) }).click();

    const antes = (await db.select<{ sales_count: number }>(
      `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count`,
    ))[0].sales_count;

    await page.getByLabel(`Vendas de Maio de ${ANO}`).fill("3.5");
    await expect(page.getByText(/vendas é um número inteiro/i)).toBeVisible();
    await expect(page.getByRole("button", { name: `Salvar Maio de ${ANO}` })).toBeDisabled();

    const depois = (await db.select<{ sales_count: number }>(
      `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count`,
    ))[0].sales_count;
    expect(depois).toBe(antes);
  });

  /**
   * Um clique no salvar de um mês EM BRANCO gravava 0/0 com toast de sucesso.
   *
   * `dirty` era falso com os dois campos vazios, então o botão continuava
   * habilitado; `validate` aceita (`Number("" || 0)` é 0) e a linha nascia em
   * `annual_results`. O efeito visível: o aviso honesto "Nenhum mês lançado em
   * {ano}" sumia e a tela passava a afirmar um lançamento que ninguém fez.
   * Zerar um mês JÁ lançado continua permitido — ali a linha existe e apagar os
   * campos é correção deliberada.
   */
  test("salvar um mês em branco não cria linha em annual_results", async ({ page }) => {
    const MES_VAZIO = 11;
    const antes = await db.select(`annual_results?year=eq.${ANO}&month=eq.${MES_VAZIO}&select=id`);
    test.skip(antes.length > 0, `annual_results já tem ${MES_VAZIO}/${ANO} neste alvo`);

    await page.goto("/resultados");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) }).click();

    const salvar = page.getByRole("button", { name: `Salvar Novembro de ${ANO}` });
    await expect(salvar, "mês em branco e inexistente não tem o que salvar").toBeDisabled();

    expect(
      await db.select(`annual_results?year=eq.${ANO}&month=eq.${MES_VAZIO}&select=id`),
      "nenhuma linha de 0/0 pode nascer de um clique",
    ).toHaveLength(0);
  });

  /**
   * "Recalcular pelo pipeline" reescrevia o ano inteiro num clique, sem prévia
   * e sem confirmação — e só os meses COM negócio ganho, então um mês que
   * perdeu as vendas ficava com o valor antigo para sempre.
   */
  test("recalcular mostra a prévia e não grava nada se for cancelado", async ({ page }) => {
    await page.goto("/resultados");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: new RegExp(`^${ANO}\\b`) }).click();

    const antes = (await db.select<{ sales_count: number; vgv: string }>(
      `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count,vgv`,
    ))[0];

    await page.getByRole("button", { name: `Recalcular ${ANO} pelo pipeline` }).click();

    // O ano de teste tem lançamento e nenhum negócio ganho: o recálculo tem que
    // propor zerar o mês — que é justamente o que o caminho antigo nunca fazia.
    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo).toContainText(new RegExp(`Recalcular ${ANO} pelo pipeline`));
    await expect(dialogo).toContainText("Maio");
    await expect(dialogo).toContainText(/mês sem negócio ganho nesse recorte vai a zero/i);
    // O diálogo diz de QUE recorte saiu a conta: "o que o pipeline soma" é o
    // que o perfil de quem clicou enxerga, e o consolidado é da casa inteira.
    await expect(dialogo).toContainText(/negócios ganhos que o seu perfil enxerga/i);

    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toBeHidden();

    const depois = (await db.select<{ sales_count: number; vgv: string }>(
      `annual_results?year=eq.${ANO}&month=eq.${MES}&select=sales_count,vgv`,
    ))[0];
    expect(depois.sales_count, "cancelar não pode gravar").toBe(antes.sales_count);
    expect(depois.vgv).toBe(antes.vgv);
  });
});
