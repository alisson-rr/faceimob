/**
 * /links — o recorte por perfil, que era a metade sem teste.
 *
 * O único e2e da tela era o smoke de `rotas-positivas` (admin abre e vê o
 * título). Nada provava a parte que o banco decide: `useful_links_write` é
 * `is_admin()` e `useful_links_select` é `active OR is_admin()`, então quem não
 * é administrador não pode ver botão de escrita NEM o link desativado. Os dois
 * lados falhavam em silêncio se alguém trocasse `isAdmin` por outra coisa: o
 * botão apareceria e todo clique voltaria 204 sem erro.
 *
 * O papel deste project é `marketing` (a matriz concede `menu.links` desde a
 * 0063); admin e corretor entram por contexto próprio, com sessão real, porque
 * o corretor é o papel mais numeroso da operação e o que menos deveria ver
 * controle.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { E2E_USERS, type RoleKey } from "../support/users";
import type { Browser, Page } from "@playwright/test";

const tag = runTag();
const ATIVO = `Link ativo ${tag}`;
const INATIVO = `Link desativado ${tag}`;
const CATEGORIA = `categoria ${tag}`;

/** Contexto com a sessão REAL de outro papel — o JWT é de verdade e o RLS vale. */
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

test.beforeAll(async () => {
  await db.insert("useful_links", [
    { label: ATIVO, url: `https://exemplo.test/${tag}/ativo`, category: CATEGORIA, sort_order: 1, active: true },
    { label: INATIVO, url: `https://exemplo.test/${tag}/inativo`, category: CATEGORIA, sort_order: 2, active: false },
  ]);
});

test.afterAll(async () => {
  await db.remove(`useful_links?label=like.*${tag}*`);
});

/** Só os controles que `useful_links_write` reserva ao administrador. */
const controlesDeEscrita = (raiz: Page) => [
  raiz.getByRole("button", { name: /novo link/i }),
  raiz.getByRole("button", { name: `Editar ${ATIVO}` }),
  raiz.getByRole("button", { name: `Excluir ${ATIVO}` }),
  raiz.getByRole("switch", { name: `Link ${ATIVO} ativo` }),
  // Reordenar também é `useful_links_write`: as setas gravam `sort_order`.
  raiz.getByRole("button", { name: `Subir ${ATIVO}` }),
  raiz.getByRole("button", { name: `Descer ${ATIVO}` }),
];

test.describe("Links · quem não é administrador", () => {
  test("marketing lê a lista agrupada e não vê nenhum controle de escrita", async ({ page }) => {
    await page.goto("/links");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: "Links", level: 1 })).toBeVisible();
    // A categoria vira cabeçalho de seção — a coluna existia e a tela só a
    // imprimia ao lado da URL.
    // O cabeçalho da seção é `uppercase` por CSS, e o nome acessível que o
    // Chromium calcula segue o texto renderizado: casar por regex sem caixa é
    // o que impede o teste de reprovar por causa de uma classe de estilo.
    await expect(page.getByRole("heading", { name: new RegExp(CATEGORIA, "i"), level: 2 })).toBeVisible();
    await expect(page.getByText(ATIVO, { exact: true })).toBeVisible();

    for (const controle of controlesDeEscrita(page)) {
      await expect(controle).toHaveCount(0);
    }
    // O que ele PODE fazer continua: copiar e abrir em outra aba.
    await expect(page.getByRole("button", { name: `Copiar link ${ATIVO}` })).toBeVisible();
    await expect(page.getByRole("link", { name: `Abrir ${ATIVO}` })).toHaveAttribute("rel", "noopener noreferrer");
  });

  /**
   * `useful_links_select` = `active OR is_admin()`. A tela NÃO filtra `active`
   * de propósito (filtrar deixaria o link desativado invisível também para
   * quem pode reativá-lo), então quem esconde o inativo é o banco — e é
   * exatamente isso que precisa de prova.
   */
  test("o link desativado não chega a quem não é administrador, e chega ao admin", async ({ page, browser, baseURL }) => {
    await page.goto("/links");
    await aguardarCarregamento(page);
    await expect(page.getByText(ATIVO, { exact: true })).toBeVisible();
    await expect(page.getByText(INATIVO)).toHaveCount(0);

    const { contexto, pagina } = await abrirComo(browser, baseURL, "admin");
    try {
      await pagina.goto("/links");
      await aguardarCarregamento(pagina);
      await expect(pagina.getByText(INATIVO)).toBeVisible();
      await expect(pagina.getByText("inativo", { exact: true }).first()).toBeVisible();
    } finally {
      await contexto.close();
    }
  });

  /**
   * O corretor é quem mais abre esta tela e quem menos pode escrever nela.
   * Sessão real, JWT real: é o RLS respondendo, não uma condição de front.
   */
  test("o corretor vê a lista e nenhum botão que o banco recusaria", async ({ browser, baseURL }) => {
    const { contexto, pagina } = await abrirComo(browser, baseURL, "broker");
    try {
      await pagina.goto("/links");
      await aguardarCarregamento(pagina);

      await expect(pagina.getByRole("heading", { name: "Links", level: 1 })).toBeVisible();
      await expect(pagina.getByText(ATIVO, { exact: true })).toBeVisible();
      await expect(pagina.getByText(INATIVO)).toHaveCount(0);
      for (const controle of controlesDeEscrita(pagina)) {
        await expect(controle).toHaveCount(0);
      }
    } finally {
      await contexto.close();
    }
  });
});

test.describe("Links · no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("a lista cabe em 375 px, sem rolagem horizontal", async ({ page }) => {
    await page.goto("/links");
    await aguardarCarregamento(page);
    await expect(page.getByText(ATIVO, { exact: true })).toBeVisible();

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(transbordo, "a página rola na horizontal em 375 px").toBeLessThanOrEqual(1);
  });
});
