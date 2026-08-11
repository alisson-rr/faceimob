/**
 * Tela de Marketing na visão do papel `marketing`.
 *
 * O ponto que a auditoria cobrou aqui é "sem mock": a tela nasceu com campanhas
 * inventadas em `mockData` e o requisito é que cada linha venha de
 * `ad_campaigns`. Então os testes provam os dois sentidos — o que está no banco
 * aparece, e o que aparece está no banco.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();

type CampanhaRow = {
  id: string;
  external_id: string;
  platform: string;
  name: string;
  status: string | null;
  total_spend: number;
};

const todasAsCampanhas = () =>
  db.select<CampanhaRow>("ad_campaigns?select=id,external_id,platform,name,status,total_spend&order=name");

/** A tabela de campanhas é a que tem a coluna "Construtora" (a outra é a do
 *  painel de investimento × resultado, que não tem construtora). */
const tabelaDeCampanhas = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Construtora" }) });

/** Painel "Investimento × resultado", identificado pela coluna Custo/lead. */
const tabelaDePerformance = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Custo/lead" }) });

test.afterAll(async () => {
  await db.remove(`ad_campaigns?external_id=like.*${tag}*`);
});

test.describe("Marketing · campanhas", () => {
  test("a tabela é ad_campaigns, sem linha inventada", async ({ page }) => {
    const criada = `Campanha ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: `ext-${tag}`,
      platform: "meta",
      name: criada,
      status: "ACTIVE",
      total_spend: 1234,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const tabela = tabelaDeCampanhas(page);
    // Ida: uma campanha que só existe no banco aparece na tela.
    await expect(tabela.getByText(criada, { exact: true })).toBeVisible();
    await expect(tabela.getByRole("row").filter({ hasText: criada })).toContainText("R$ 1.234");

    // Volta: nenhum nome na tela sem lastro no banco — é isso que mata o mock.
    const doBanco = new Set((await todasAsCampanhas()).map((c) => c.name));
    const naTela = await tabela.locator("tbody tr td:nth-child(1)").allTextContents();
    expect(naTela.length).toBeGreaterThan(0);
    for (const nome of naTela) {
      expect(doBanco, `"${nome}" está na tela e não em ad_campaigns`).toContain(nome.trim());
    }
  });

  test("cadastra campanha pelo painel e grava em ad_campaigns", async ({ page }) => {
    const externo = `painel-${tag}`;
    const nome = `Painel ${tag}`;

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByLabel("ID externo da campanha").fill(externo);
    await page.getByLabel("Nome da campanha").fill(nome);
    await page.getByLabel("Total investido").fill("2500");
    await page.getByRole("button", { name: /salvar/i }).click();

    await expect(page.getByText(/campanha registrada/i)).toBeVisible({ timeout: 15_000 });

    const [gravada] = await db.select<CampanhaRow>(
      `ad_campaigns?external_id=eq.${externo}&select=id,external_id,platform,name,status,total_spend`,
    );
    expect(gravada, "campanha não chegou em ad_campaigns").toBeTruthy();
    expect(gravada.name).toBe(nome);
    expect(Number(gravada.total_spend)).toBe(2500);
    expect(gravada.platform).toBe("meta");

    // E volta para a tela sem recarregar a página.
    await expect(
      tabelaDePerformance(page).getByRole("row").filter({ hasText: nome }),
    ).toContainText("R$ 2.500,00");
  });

  test("filtro sem resultado zera os números em vez de inventar", async ({ page }) => {
    // Campanha só desta execução, para o par (canal, status) ser previsível.
    await db.insert("ad_campaigns", {
      external_id: `tiktok-${tag}`,
      platform: "tiktok",
      name: `TikTok pausada ${tag}`,
      status: "PAUSED",
      total_spend: 900,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByRole("combobox").filter({ hasText: "Todos canais" }).click();
    await page.getByRole("option", { name: "TikTok" }).click();
    await page.getByRole("combobox").filter({ hasText: "Todos status" }).click();
    await page.getByRole("option", { name: "Ativa", exact: true }).click();

    await expect(page.getByText(/Faceimob • 0 campanhas/)).toBeVisible();
    await expect(tabelaDeCampanhas(page).locator("tbody tr")).toHaveCount(0);
    // Sem lead no recorte, o CPL vira "—" e não "R$ 0,00" — zero mentiria.
    // O travessão aparece em várias células; o que importa é o KPI de CPL.
    await expect(
      page.getByText("CPL Médio", { exact: true }).locator("xpath=../following-sibling::p[1]"),
    ).toHaveText("—");
  });

  // A RPC agregada conta inclusive os leads já distribuídos sem ampliar o SELECT
  // de dados pessoais concedido ao papel marketing.
  test("a contagem de leads por campanha bate com o banco", async ({ page }) => {
    const externo = "camp-teste-001";
    const doBanco = await db.select<{ campaign_id: string }>(
      `leads?campaign_id=eq.${externo}&select=campaign_id`,
    );
    const [campanha] = await db.select<CampanhaRow>(
      `ad_campaigns?external_id=eq.${externo}&select=id,external_id,platform,name,status,total_spend`,
    );

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await expect(
      tabelaDeCampanhas(page).getByRole("row").filter({ hasText: campanha.name }),
    ).toContainText(String(doBanco.length));
  });
});
