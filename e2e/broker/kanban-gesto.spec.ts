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
let etapaAnalise = "";

test.beforeAll(async () => {
  [{ id: etapaLead }] = await db.select<{ id: string }>("pipeline_stages?code=eq.lead&select=id");
  [{ id: etapaProposta }] = await db.select<{ id: string }>("pipeline_stages?code=eq.proposal&select=id");
  [{ id: etapaVisita }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.visit_scheduled&select=id",
  );
  [{ id: etapaAnalise }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.under_analysis&select=id",
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

/** O cartão do kanban: `role="button"` cujo nome acessível começa pelo cliente.
 *  Os botões de mover são IRMÃOS dele, não filhos — veja o teste de controle
 *  aninhado abaixo. */
const cartao = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: new RegExp(`^${negocio.cliente}`) });

const etapaNoBanco = async () => {
  const [linha] = await db.select<{ stage_id: string }>(`deals?id=eq.${negocio.id}&select=stage_id`);
  return linha.stage_id;
};

const esperarEtapa = async (esperada: string, mensagem: string) =>
  expect.poll(etapaNoBanco, { message: mensagem, timeout: 10_000 }).toBe(esperada);

/**
 * Põe o negócio em "Em Análise" com a conferência aprovada — o estado em que o
 * corretor NÃO pode entrar no destino seguinte ("Aprovado"), que é o cenário de
 * recusa por destino.
 *
 * "Em Análise" tem `requires_document` e a 0028 exige conferência aprovada: sem
 * os dois o próprio setup morre em P0001, mesmo por service_role.
 */
async function porEmAnalise() {
  const [tipo] = await db.select<{ id: string; code: string }>(
    "document_types?active=is.true&select=id,code&order=sort_order&limit=1",
  );
  await db.insert("deal_documents", {
    deal_id: negocio.id,
    document_type_id: tipo.id,
    storage_path: `${negocio.id}/e2e-${tag}.pdf`,
    original_name: `${tipo.code}.pdf`,
    stored_name: `${tipo.code}-${tag}.pdf`,
  });
  await db.update(`deals?id=eq.${negocio.id}`, {
    stage_id: etapaAnalise,
    document_review_status: "approved",
  });
}

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

  /**
   * `nested-interactive` do axe.
   *
   * O papel `button` tem filhos presentacionais na especificação ARIA: enquanto
   * os botões "Mover X para Y" moravam DENTRO do cartão `role="button"`, o
   * leitor de tela podia não expô-los de jeito nenhum, e o texto deles era
   * absorvido pelo nome acessível do cartão. O caminho de toque funcionava com
   * o dedo e não existia para tecnologia assistiva.
   */
  test("os botões de mover ficam fora do cartão, não aninhados nele", async ({ page }) => {
    await abrirKanban(page);

    const alvo = cartao(page);
    await expect(alvo).toBeVisible();
    // Descendente de DOM, e não `getByRole`: o que está sob teste é justamente
    // a árvore, não como o motor de papéis a interpreta.
    await expect(alvo.locator("button"), "nenhum controle dentro do cartão")
      .toHaveCount(0);
    await expect(
      page.getByRole("button", { name: new RegExp(`^Mover ${negocio.cliente}`) }),
      "e os dois botões de mover continuam existindo, como irmãos do cartão",
    ).toHaveCount(2);
  });

  /**
   * A OUTRA metade da matriz: `can_enter` do destino.
   *
   * O cartão decidia mostrar seta e alça só por `can_exit` da coluna atual — e
   * `can_exit` não sabe para onde o negócio vai. Corretor e gerente SAEM de
   * "Em Análise" e NÃO ENTRAM em "Aprovado" (medido na homologação em
   * 02/09/2026): a seta da direita aparecia habilitada e o clique voltava em
   * toast vermelho, que é justamente o "gesto que aparece e o banco recusa" que
   * o `guards.ts` existe para eliminar.
   */
  test("a seta para uma etapa que o perfil não pode ENTRAR fica desabilitada com o motivo", async ({ page }) => {
    await porEmAnalise();
    await abrirKanban(page);

    const paraAprovado = page.getByRole("button", {
      name: new RegExp(`^Mover ${negocio.cliente} para Aprovado`),
    });
    await expect(paraAprovado, "o destino recusado não some: fica desabilitado").toBeDisabled();
    // O motivo vai para o nome acessível — `title` não serve num controle
    // desabilitado, e o cartão só carrega o motivo da coluna, não o do destino.
    await expect(paraAprovado).toHaveAccessibleName(/não pode mover negócios para/i);

    // Contraprova: o destino permitido continua clicável. Sem ela, um cartão
    // que perdeu TODOS os botões faria a asserção acima passar por engano.
    await expect(
      page.getByRole("button", { name: new RegExp(`^Mover ${negocio.cliente} para Visita Agendada`) }),
    ).toBeEnabled();

    // E o teclado concorda com o botão: Shift+→ não pode permitir o que a seta
    // desabilita. Provar que não gravou exige dar ao app a chance de gravar.
    await cartao(page).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(1_000);
    expect(await etapaNoBanco(), "o cartão continua em Em Análise").toBe(etapaAnalise);
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

  /**
   * O solte HONRA a recusa que a coluna acabou de desenhar.
   *
   * A coluna já se marcava em vermelho durante o arraste, mas o `drop` só
   * conferia `canWrite` e a troca de coluna: o gesto virava escrita, o
   * `aria-live` anunciava "Movendo Fulano para Aprovado" e só DEPOIS vinha o
   * toast destrutivo. Quem usa leitor de tela recebia a confirmação antes da
   * negativa; quem enxerga levava toast vermelho por um gesto que a própria
   * coluna já tinha recusado.
   */
  test("soltar numa coluna que recusa não anuncia movimento nem grava", async ({ page }) => {
    await porEmAnalise();
    await abrirKanban(page);

    const alvo = cartao(page);
    await expect(alvo).toBeVisible();
    await alvo.dragTo(page.locator("div.w-60").filter({ hasText: "Aprovado" }));

    // O anúncio é a recusa — a MESMA frase do botão desabilitado e do toast.
    await expect(page.locator('p.sr-only[role="status"]'))
      .toHaveText(/não pode mover negócios para/i);
    await expect(
      page.getByText(/movimentação não permitida/i),
      "gesto recusado não vira escrita, então também não vira toast",
    ).toHaveCount(0);

    // Provar que não gravou exige dar ao app a chance de gravar.
    await page.waitForTimeout(1_000);
    expect(await etapaNoBanco(), "o cartão continua em Em Análise").toBe(etapaAnalise);
  });
});
