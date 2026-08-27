/**
 * O GESTO de mover o cartão no kanban — teclado e mouse.
 *
 * `broker/etapas.spec.ts` já prova o EFEITO nos dois sentidos (etapa permitida
 * grava, etapa negada avisa e não grava), mas dispara `dragstart`/`drop`
 * sintéticos: evento montado à mão não é gesto. Aqui as teclas e o arrastar
 * passam pelo `Input.dispatchKeyEvent`/`dispatchDragEvent` do Chromium — é o
 * mesmo caminho de um dedo no teclado e de uma mão no mouse.
 *
 * O teclado nunca tinha sido exercitado: o `DealCard` virou `role="button"` com
 * `tabIndex` na Tarefa H (achado X01) e, até aqui, ninguém — nem a suíte, nem o
 * smoke da Tarefa J — chegou a apertar a tecla.
 *
 * A regra que mais custa numa refatoração é a de baixo: **seta sozinha não
 * move**. Ela existe porque a coluna rola, e mover negócio sem querer é gravação
 * no banco. Um `if (!event.shiftKey) return;` some sem ninguém notar.
 */
import { test, expect, db, runTag } from "../support/fixtures";
import { abrirPipelineFiltrado, criarNegocio, limparCenario } from "../matriz/cenario";

const tag = runTag();

let negocio: { id: string; cliente: string };
let etapaLead = "";
let etapaProposta = "";
let etapaVisita = "";

test.beforeAll(async () => {
  [{ id: etapaLead }] = await db.select<{ id: string }>("pipeline_stages?code=eq.lead&select=id");
  [{ id: etapaProposta }] = await db.select<{ id: string }>("pipeline_stages?code=eq.proposal&select=id");
  [{ id: etapaVisita }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.visit_scheduled&select=id",
  );
});

test.afterAll(async () => {
  await limparCenario(tag);
});

/**
 * Cenário por teste, e não por arquivo: cada um começa com o cartão em
 * "Proposta". Compartilhar um negócio entre testes que o movem faz o segundo
 * depender da ordem do primeiro — e a suíte roda em série, mas por escolha, não
 * por garantia.
 */
test.beforeEach(async () => {
  await limparCenario(tag);
  negocio = await criarNegocio(tag, "GESTO", await db.profileIdOf("broker"));
});

async function abrirKanban(page: import("@playwright/test").Page) {
  await abrirPipelineFiltrado(page, tag);
  await page.getByRole("button", { name: /ver em kanban/i }).click();
}

/** O cartão do kanban: `role="button"` cujo nome acessível começa pelo cliente. */
const cartao = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: new RegExp(`^${negocio.cliente}`) });

const etapaNoBanco = async () => {
  const [linha] = await db.select<{ stage_id: string }>(`deals?id=eq.${negocio.id}&select=stage_id`);
  return linha.stage_id;
};

const esperarEtapa = async (esperada: string, mensagem: string) =>
  expect.poll(etapaNoBanco, { message: mensagem, timeout: 10_000 }).toBe(esperada);

test.describe("corretor · kanban pelo teclado", () => {
  test("o cartão recebe foco e Shift+→ move para a próxima etapa", async ({ page }) => {
    await abrirKanban(page);

    const alvo = cartao(page);
    await alvo.focus();
    // Sem isto o teste passaria mesmo se o cartão tivesse perdido o `tabIndex`:
    // a tecla iria para o `body` e o `onKeyDown` nunca rodaria.
    await expect(alvo).toBeFocused();
    // O rótulo é o que ensina o gesto a quem não vê a tela.
    await expect(alvo).toHaveAccessibleName(/Shift com seta move de etapa/i);

    await page.keyboard.press("Shift+ArrowRight");

    await expect(page.getByText(/negócio movido para visita agendada/i)).toBeVisible();
    await esperarEtapa(etapaVisita, "Shift+→ tem que gravar a etapa seguinte");

    // E o cartão está mesmo na coluna nova, não só no banco.
    await expect(
      page.locator("div.w-60").filter({ hasText: "Visita Agendada" }).getByRole("button", {
        name: new RegExp(`^${negocio.cliente}`),
      }),
    ).toBeVisible();
  });

  test("Shift+← volta para a etapa anterior", async ({ page }) => {
    await abrirKanban(page);

    await cartao(page).focus();
    await page.keyboard.press("Shift+ArrowLeft");

    await expect(page.getByText(/negócio movido para lead/i)).toBeVisible();
    await esperarEtapa(etapaLead, "Shift+← tem que gravar a etapa anterior");
  });

  test("seta sozinha não move o negócio", async ({ page }) => {
    await abrirKanban(page);

    const alvo = cartao(page);
    await alvo.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");

    // Provar que NÃO gravou exige dar ao app a chance de gravar.
    await page.waitForTimeout(1_000);
    expect(await etapaNoBanco(), "seta sem Shift é rolagem, não movimentação").toBe(etapaProposta);
    await expect(page.getByText(/negócio movido para/i)).toHaveCount(0);
    // E o foco continua no cartão: a tecla foi ignorada, não engoliu o elemento.
    await expect(alvo).toBeFocused();
  });

  test("Enter no cartão abre o negócio", async ({ page }) => {
    await abrirKanban(page);

    await cartao(page).focus();
    await page.keyboard.press("Enter");

    const modal = page.getByRole("dialog");
    await expect(modal.getByRole("button", { name: /confirmar alterações/i })).toBeVisible();
    await expect(modal).toContainText(negocio.cliente);
  });
});

test.describe("corretor · kanban pelo mouse", () => {
  test("arrastar o cartão com o mouse move de coluna e grava", async ({ page }) => {
    await abrirKanban(page);

    const alvo = cartao(page);
    await expect(alvo).toBeVisible();
    const colunaVisita = page.locator("div.w-60").filter({ hasText: "Visita Agendada" });

    // `dragTo` é arrastar de verdade: o Chromium recebe mouse down, movimento e
    // up, e o próprio navegador constrói o `DataTransfer` do HTML5. É o que
    // separa este teste do `dispatchEvent("dragstart")` de `etapas.spec.ts`.
    await alvo.dragTo(colunaVisita);

    await expect(page.getByText(/negócio movido para visita agendada/i)).toBeVisible();
    await esperarEtapa(etapaVisita, "arrastar com o mouse tem que gravar");
  });
});
