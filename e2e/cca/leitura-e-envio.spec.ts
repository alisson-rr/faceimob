import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import {
  comSessao,
  criarCenario,
  estagioCca,
  limparCenario,
  semearCasoCca,
  semearDocumento,
  type Cenario,
} from "./esteira";

/**
 * A esteira vista por quem NÃO decide, e o envio à construtora de ponta a ponta.
 *
 * Três buracos que o inventário apontou e nenhum teste cobria:
 *
 * 1. **Modo leitura sem prova.** A 0059 abriu `menu.cca` para diretoria e
 *    gerência mantendo a escrita fechada em `cca.review`. Nada garantia que a
 *    tela realmente escondesse "Mover para…" e "Enviar à construtora" para eles
 *    — e botão que o banco recusa é exatamente o defeito que a permissão
 *    espelhada existe para evitar.
 * 2. **375 px sem cobertura.** O quadro é uma faixa rolável de colunas de 264 px;
 *    sem `contain: paint` o transbordo escapa e passa a rolar a PÁGINA inteira.
 * 3. **O envio à construtora nunca foi exercitado no fluxo certo.** O único
 *    teste do envio rodava sobre construtora de fluxo INTERNO (o padrão de
 *    `criarCenario`), que não tem e-mail cadastrado: ele codificava o defeito
 *    em vez de pegá-lo. Aqui a construtora é externa, o campo "Para" tem de
 *    nascer preenchido com `developers.submission_email`, e enfileirar tem de
 *    mover o caso sozinho (gatilho `developer_submissions_advance_case`, 0077)
 *    em vez de exigir um segundo "Mover para…" à mão.
 */
test.describe.serial("CCA · leitura, 375 px e envio externo", () => {
  let cenario: Cenario;
  let casoId = "";

  test.beforeAll(async () => {
    cenario = await criarCenario({
      dono: "broker",
      fluxo: "external",
      etapa: "under_analysis",
      apelido: "Externo",
    });
    await db.update(`deals?id=eq.${cenario.dealId}`, { document_review_status: "approved" });
    const etapa = await estagioCca("under_review");
    const [caso] = await semearCasoCca(cenario, "under_review", etapa.id);
    casoId = caso.id;
    await semearDocumento(cenario, "rg_cpf");
  });

  test.afterAll(async () => {
    await limparCenario(cenario);
  });

  test("diretoria e gerência abrem a esteira em modo leitura", async ({ page }) => {
    for (const papel of ["director", "manager"] as const) {
      await comSessao(page, papel);
      await page.goto("/cca");
      await aguardarCarregamento(page);

      await expect(page.getByText("Somente leitura", { exact: true })).toBeVisible();
      // A ausência é o teste: os dois controles de escrita não existem em
      // cartão nenhum, nem no cabeçalho.
      await expect(page.getByRole("combobox", { name: /Mover .* para outro estágio/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /enviar à construtora/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /gerenciar estágios/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /tipos de documento/i })).toHaveCount(0);
    }
  });

  test("o quadro cabe em 375 px sem rolar a página na horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 780 });
    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);

    await expect(page.getByRole("article").filter({ hasText: cenario.cliente })).toHaveCount(1);
    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(transbordo, "a esteira faz a página inteira rolar na horizontal a 375 px").toBeLessThanOrEqual(1);
  });

  test("o envio à construtora nasce com o e-mail do cadastro e move o caso", async ({ page }) => {
    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);

    const card = page.getByRole("article").filter({ hasText: cenario.cliente });
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: /enviar à construtora/i }).click();

    // O analista redigitava o endereço a cada envio, e errar uma letra ali não
    // dá erro em lugar nenhum: o dossiê simplesmente não chega.
    const destinatario = page.getByRole("dialog").getByLabel("Destinatário", { exact: true });
    await expect(destinatario).toHaveValue(`dossie-${cenario.tag}@construtora.test`);
    // Construtora externa COM e-mail: nenhum dos dois avisos de cadastro torto.
    await expect(page.getByText(/fluxo interno/i)).toHaveCount(0);
    await expect(page.getByText(/sem e-mail de envio cadastrado/i)).toHaveCount(0);

    await page.getByRole("button", { name: /enfileirar envio/i }).click();
    await expect(page.getByText("Envio na fila", { exact: true })).toBeVisible();

    const [envio] = await db.select<{ to_email: string; status: string }>(
      `developer_submissions?deal_id=eq.${cenario.dealId}&select=to_email,status`,
    );
    expect(envio.to_email).toBe(`dossie-${cenario.tag}@construtora.test`);
    expect(envio.status).toBe("queued");

    // Enfileirar move o caso: sem o gatilho o analista precisava de um segundo
    // "Mover para… → Enviado à Construtora" e nada ligava um ao outro.
    await expect.poll(async () => {
      const [row] = await db.select<{ status: string }>(`cca_cases?id=eq.${casoId}&select=status`);
      return row?.status;
    }).toBe("sent_to_developer");

    // E o Status 2 deixa de ficar nulo justamente no negócio que saiu da casa.
    await expect.poll(async () => {
      const [row] = await db.select<{ status_detail: string | null }>(
        `deals?id=eq.${cenario.dealId}&select=status_detail`,
      );
      return row?.status_detail;
    }).toBe("ANÁLISE EXTERNA");

    // O quadro por baixo recarrega: o cartão aparece na coluna nova sem F5.
    await page.getByRole("dialog").getByRole("button", { name: /^fechar$/i }).first().click();
    const coluna = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Enviado à Construtora", exact: true }) });
    await expect(coluna.getByRole("article").filter({ hasText: cenario.cliente })).toHaveCount(1);
  });
});
