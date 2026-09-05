/**
 * "Por construtora" — a tela que junta aporte, gasto de campanha, leads,
 * negócios e VGV na mesma linha.
 *
 * Os quatro números já existiam no banco com a mesma chave (`developers.id`) e
 * moravam em três telas diferentes: aporte em badges no popup de /marketing,
 * construtora numa coluna da tabela de campanhas, e vendas × propostas × VGV no
 * Dashboard. O dono não conseguia responder "quanto investi na Horizonte e
 * quanto ela me devolveu".
 *
 * O que se prova aqui, contra o banco com service_role (visão da empresa
 * inteira, sem recorte de RLS):
 *   1. o aporte da linha é a soma real de `marketing_investments`;
 *   2. NENHUM lead e NENHUM negócio somem: o total da tela bate com o total da
 *      empresa, que é o papel do balde "Sem construtora";
 *   3. o mês recorta o aporte e NÃO recorta o gasto de campanha — por isso o
 *      ROAS do mês não existe, e a tela diz isso em vez de exibir um número.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { E2E_USERS, type RoleKey } from "../support/users";
import type { Browser, Page } from "@playwright/test";

const tag = runTag();

/** Contexto com a sessão REAL de outro papel: JWT de verdade, RLS valendo. */
async function abrirComo(browser: Browser, baseURL: string | undefined, key: RoleKey) {
  if (!baseURL) throw new Error("baseURL do Playwright ausente");
  const usuario = E2E_USERS.find((u) => u.key === key);
  if (!usuario) throw new Error(`papel E2E desconhecido: ${key}`);
  const contexto = await browser.newContext({
    baseURL,
    storageState: storageStateFor(await mintSession(usuario.email), baseURL),
  });
  return { contexto, pagina: await contexto.newPage() };
}

const mesCorrente = () => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
};

const emReais = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const abrirResumo = async (page: Page) => {
  await page.goto("/marketing");
  await aguardarCarregamento(page);
  await page.getByRole("tab", { name: "Por construtora" }).click();
  const tabela = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "ROAS" }) });
  await expect(tabela).toBeVisible();
  return tabela;
};

test.afterAll(async () => {
  await db.remove(`marketing_investments?notes=like.*${tag}*`);
  await db.remove(`ad_campaigns?external_id=like.*${tag}*`);
  await db.remove(`developers?name=like.*${tag}*`);
});

test.describe("Marketing · por construtora", () => {
  test("aporte e gasto de campanha da linha vêm do banco, na mesma chave", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Resumo ${tag}`,
      slug: `construtora-resumo-${tag}`,
    });
    await db.insert("marketing_investments", [
      { developer_id: construtora.id, period: "2026-03-01", amount: 4000, notes: `resumo ${tag}` },
      { developer_id: construtora.id, period: "2026-04-01", amount: 6000, notes: `resumo ${tag}` },
    ]);
    await db.insert("ad_campaigns", {
      external_id: `resumo-${tag}`,
      platform: "meta",
      name: `Campanha Resumo ${tag}`,
      developer_id: construtora.id,
      status: "ACTIVE",
      total_spend: 2500,
    });

    const tabela = await abrirResumo(page);
    const linha = tabela.getByRole("row").filter({ hasText: construtora.name });

    // Todo o período: 4.000 + 6.000 de aporte, 2.500 de campanha — em colunas
    // separadas, porque somar as duas verbas contaria dobrado.
    await expect(linha).toContainText(emReais(10000));
    await expect(linha).toContainText(emReais(2500));
  });

  test("nenhum lead e nenhum negócio somem: o total da tela é o total da empresa", async ({ page }) => {
    const leads = (await db.select<{ id: string }>("leads?select=id")).length;
    const negocios = (await db.select<{ id: string }>("deals?select=id")).length;
    expect(leads, "sem lead no banco a comparação seria vazia").toBeGreaterThan(0);

    const tabela = await abrirResumo(page);
    const total = tabela.locator("tfoot tr");

    await expect(total).toContainText(leads.toLocaleString("pt-BR"));
    await expect(total).toContainText(negocios.toLocaleString("pt-BR"));
  });

  /**
   * O aporte é mensal e `ad_campaigns.total_spend` é acumulado da vida da
   * campanha. Dividir um custo eterno por um resultado mensal produz número sem
   * sentido — então, com mês escolhido, o ROAS é travessão e a tela explica.
   */
  test("com mês escolhido, o aporte é do mês e o ROAS não é inventado", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Mês ${tag}`,
      slug: `construtora-mes-${tag}`,
    });
    const hoje = new Date();
    const mes = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
    await db.insert("marketing_investments", [
      { developer_id: construtora.id, period: mes, amount: 3300, notes: `mes ${tag}` },
      { developer_id: construtora.id, period: "2026-02-01", amount: 9900, notes: `mes ${tag}` },
    ]);

    const tabela = await abrirResumo(page);
    await expect(tabela.getByRole("row").filter({ hasText: construtora.name })).toContainText(emReais(13200));

    await page.getByLabel("Período do resumo").click();
    await page.getByRole("option").nth(1).click(); // o primeiro mês da lista é o corrente

    await expect(tabela.getByRole("row").filter({ hasText: construtora.name })).toContainText(emReais(3300));
    await expect(page.getByText(/o ROAS do mês não existe/i)).toBeVisible();
    // Construtora · Aporte · Gasto · Leads · Negócios · Vendas · VGV · ROAS ·
    // [Retorno sobre aporte]. O ROAS de campanha é a 8ª coluna e continua
    // travessão com mês escolhido, porque o gasto de campanha é acumulado.
    await expect(tabela.locator("tfoot tr td").nth(7)).toHaveText("—");
  });

  /**
   * Retorno sobre APORTE — a conta que a tela dizia não fazer.
   *
   * O aporte é o dinheiro que a construtora efetivamente põe no mês e o VGV do
   * mês é o que voltou: as duas pontas na MESMA janela, que é exatamente o que
   * falta ao ROAS de campanha (gasto acumulado ÷ retorno mensal). Por isso a
   * coluna só existe com um mês escolhido e some em "Todo o período".
   */
  test("com mês escolhido aparece o retorno sobre o aporte; em todo o período, não", async ({ page }) => {
    const [comAporte] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Retorno ${tag}`,
      slug: `construtora-retorno-${tag}`,
    });
    const [semAporte] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Sem Aporte ${tag}`,
      slug: `construtora-sem-aporte-${tag}`,
    });
    await db.insert("marketing_investments", {
      developer_id: comAporte.id, period: mesCorrente(), amount: 5000, notes: `retorno ${tag}`,
    });
    // Só gasto de campanha, nenhum aporte: é o caso em que a divisão do mês não
    // existe — e "R$ 0,00 de retorno" seria afirmação diferente de "não sei".
    await db.insert("ad_campaigns", {
      external_id: `retorno-${tag}`,
      platform: "meta",
      name: `Campanha Retorno ${tag}`,
      developer_id: semAporte.id,
      total_spend: 800,
    });

    const tabela = await abrirResumo(page);
    // Em "Todo o período" a coluna não existe: aporte é mensal, e misturá-lo com
    // o acumulado seria a mesma confusão com outro nome.
    await expect(page.getByRole("columnheader", { name: "Retorno sobre aporte" })).toHaveCount(0);

    await page.getByLabel("Período do resumo").click();
    await page.getByRole("option").nth(1).click(); // o primeiro mês da lista é o corrente

    await expect(page.getByRole("columnheader", { name: "Retorno sobre aporte" })).toBeVisible();
    await expect(page.getByText(/VGV do mês ÷ aporte do mês/i)).toBeVisible();

    // Aporte lançado e nenhuma venda no mês: zero é informação verdadeira.
    await expect(
      tabela.getByRole("row").filter({ hasText: comAporte.name }).locator("td").nth(8),
    ).toHaveText("0×");
    // Sem aporte não há por que dividir — travessão, e não zero.
    await expect(
      tabela.getByRole("row").filter({ hasText: semAporte.name }).locator("td").nth(8),
    ).toHaveText("—");
  });
});

/**
 * A RPC autoriza todo papel com `reports.view_finance` — diretor, gerente,
 * marketing e sócio — e só o marketing exercitava esta aba. Se alguém apertasse
 * a guarda da função, o diretor veria 42501 numa tela que a matriz concede, e
 * nenhum teste reclamaria.
 */
test.describe("Marketing · por construtora, na visão de quem só lê", () => {
  // Diretor e gerente: os dois têm `reports.view_finance` no banco e nenhum
  // tinha teste. Sócio também tem — mas não existe usuário `partner` na suíte
  // (`e2e/support/users.ts` tem dez papéis e o sócio não está entre eles).
  for (const papel of ["director", "manager"] as const) {
    test(`o papel ${papel} abre a aba e lê o total da empresa, como o marketing`, async ({ browser, baseURL }) => {
      const leads = (await db.select<{ id: string }>("leads?select=id")).length;
      expect(leads, "sem lead no banco a comparação seria vazia").toBeGreaterThan(0);

      const { contexto, pagina } = await abrirComo(browser, baseURL, papel);
      try {
        const tabela = await abrirResumo(pagina);
        await expect(pagina.getByText(/não consegui carregar o resumo/i)).toHaveCount(0);
        // A função é agregada e SECURITY DEFINER justamente para não mudar de
        // significado por papel: os dois leem o MESMO total da empresa.
        await expect(tabela.locator("tfoot tr td").nth(3)).toHaveText(leads.toLocaleString("pt-BR"));
      } finally {
        await contexto.close();
      }
    });
  }
});

/**
 * Comparação de período — a metade que o dado sustenta.
 *
 * "O CPL de setembro contra o de agosto" não aparecia em lugar nenhum, e não
 * pode aparecer: o denominador do CPL é `ad_campaigns.total_spend`, gasto
 * ACUMULADO da vida da campanha e sem data. Aporte, leads, vendas e VGV, ao
 * contrário, já são recortados por mês pela RPC — esses comparam.
 *
 * O que se prova: a faixa só existe com um mês escolhido, os dois números que
 * ela divide vêm do banco (mês escolhido e mês anterior, mesma chave), e o
 * rodapé continua dizendo por que CPL e ROAS de campanha ficam de fora.
 */
test.describe("Marketing · comparação com o mês anterior", () => {
  const somaDoMes = async (period: string) =>
    (await db.select<{ amount: string }>(`marketing_investments?period=eq.${period}&select=amount`))
      .reduce((soma, r) => soma + Number(r.amount), 0);

  const mesAnteriorDe = (period: string) => {
    const [ano, mes] = period.split("-").map(Number);
    return mes === 1 ? `${ano - 1}-12-01` : `${ano}-${String(mes - 1).padStart(2, "0")}-01`;
  };

  test("a faixa compara mês escolhido e mês anterior, e some em todo o período", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Comparação ${tag}`,
      slug: `construtora-comparacao-${tag}`,
    });
    const mes = mesCorrente();
    const anterior = mesAnteriorDe(mes);
    // Os dois meses precisam ter aporte: com o anterior zerado a tela diz
    // "sem base no mês anterior", que é outro caminho (e é o certo lá).
    await db.insert("marketing_investments", [
      { developer_id: construtora.id, period: mes, amount: 12000, notes: `comparacao ${tag}` },
      { developer_id: construtora.id, period: anterior, amount: 8000, notes: `comparacao ${tag}` },
    ]);

    await abrirResumo(page);

    // "Todo o período" não tem mês anterior: comparar acumulado com acumulado
    // seria comparar a mesma coisa com ela mesma.
    await expect(page.getByRole("group", { name: "Comparação com o mês anterior" })).toHaveCount(0);

    await page.getByLabel("Período do resumo").click();
    await page.getByRole("option").nth(1).click(); // o primeiro mês da lista é o corrente

    const faixa = page.getByRole("group", { name: "Comparação com o mês anterior" });
    await expect(faixa).toBeVisible();

    // Os dois lados da divisão saem do banco, na mesma chave que a RPC usa.
    const totalDoMes = await somaDoMes(mes);
    const totalAnterior = await somaDoMes(anterior);
    expect(totalDoMes, "sem aporte no mês a comparação seria vazia").toBeGreaterThan(0);
    expect(totalAnterior, "sem aporte no mês anterior a faixa diria 'sem base'").toBeGreaterThan(0);

    await expect(faixa).toContainText(emReais(totalDoMes));
    await expect(faixa).toContainText(emReais(totalAnterior));
    // A direção é lida pelo sinal (e pela seta ao lado). Diferença abaixo de meio
    // ponto a tela chama de "estável" de propósito — aí não há sinal a conferir.
    if (Math.abs(totalDoMes - totalAnterior) / totalAnterior > 0.01) {
      await expect(faixa).toContainText(totalDoMes > totalAnterior ? "+" : "-");
    }

    // E a tela continua dizendo o que NÃO compara, em vez de inventar a série.
    await expect(page.getByText(/não há CPL nem ROAS de campanha por mês/i)).toBeVisible();
  });

  /**
   * Dois números do MESMO mês na mesma dobra.
   *
   * O popup de aportes mora no cabeçalho desta tela. Ele recarregava só o
   * próprio estado ao salvar; a faixa e a tabela vivem numa consulta do
   * TanStack Query com `staleTime` de 60 s, então o botão do popup passava a
   * mostrar o total novo enquanto a faixa logo abaixo continuava no antigo por
   * até um minuto — e a variação percentual passava a ser calculada sobre um
   * mês corrente desatualizado.
   */
  test("aporte lançado pelo popup atualiza a faixa na hora, sem recarregar a página", async ({ page }) => {
    const [comAporte] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Faixa A ${tag}`,
      slug: `construtora-faixa-a-${tag}`,
    });
    // A segunda nasce SEM aporte no mês: o lançamento do popup soma em vez de
    // substituir (a chave do upsert é (construtora, mês)), e a conta fica legível.
    const [semAporte] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Faixa B ${tag}`,
      slug: `construtora-faixa-b-${tag}`,
    });
    const mes = mesCorrente();
    const anterior = mesAnteriorDe(mes);
    await db.insert("marketing_investments", [
      { developer_id: comAporte.id, period: mes, amount: 12000, notes: `faixa ${tag}` },
      { developer_id: comAporte.id, period: anterior, amount: 8000, notes: `faixa ${tag}` },
    ]);

    await abrirResumo(page);
    await page.getByLabel("Período do resumo").click();
    await page.getByRole("option").nth(1).click();

    const faixa = page.getByRole("group", { name: "Comparação com o mês anterior" });
    const cartaoAporte = faixa.locator("div.grid > div").filter({ hasText: "Aporte do mês" });
    const antes = await somaDoMes(mes);
    await expect(cartaoAporte).toContainText(emReais(antes));

    // Lançamento pelo popup do cabeçalho, com a aba já aberta no mês corrente.
    await page.getByRole("button", { name: /^Aporte / }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByLabel("Valor (R$)").fill("5000");
    await dialogo.getByLabel("Construtora").click();
    await page.getByRole("option", { name: semAporte.name }).click();
    // A nota carrega o `tag`: é o `afterAll` limpa `marketing_investments` por
    // ela antes de apagar as construtoras (a FK é RESTRICT).
    await dialogo.getByLabel("Nota").fill(`faixa ${tag}`);
    await dialogo.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Aporte salvo")).toBeVisible({ timeout: 15_000 });
    await dialogo.getByRole("button", { name: "Fechar esta janela" }).click();

    await expect(async () => {
      const depois = await somaDoMes(mes);
      expect(depois, "o aporte novo não chegou ao banco").toBeGreaterThan(antes);
      await expect(
        cartaoAporte,
        "a faixa continua no total antigo: a consulta do resumo não foi invalidada ao salvar",
      ).toContainText(emReais(depois));
    }).toPass({ timeout: 15_000 });
  });
});
