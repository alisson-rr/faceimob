import type { Page } from "@playwright/test";
import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { subirArquivo } from "../helpers/negocio";
import { resolveTarget } from "../support/target";
import {
  abaDoModal,
  abrirNegocio,
  apagarDoBucket,
  comSessao,
  criarCenario,
  estagioCca,
  limparCenario,
  semearCasoCca,
  semearDocumento,
  type Cenario,
  type DocumentoDoNegocio,
} from "./esteira";


const escapar = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A esteira vista por quem NÃO decide, e o envio à construtora de ponta a ponta.
 *
 * Três buracos que o inventário apontou e nenhum teste cobria:
 *
 * 1. **Modo leitura sem prova.** A 0059 abriu `menu.cca` para diretoria e
 *    gerência mantendo a escrita fechada em `cca.review`. Nada garantia que a
 *    tela realmente escondesse "Mover para…" para eles — e botão que o banco
 *    recusa é exatamente o defeito que a permissão espelhada existe para evitar.
 *    "Enviar à construtora" saiu do cartão em 17/09/2026: não aparece para
 *    ninguém, nem para o CCA.
 * 2. **375 px sem cobertura.** O quadro é uma faixa rolável de colunas de 264 px;
 *    sem `contain: paint` o transbordo escapa e passa a rolar a PÁGINA inteira.
 * 3. **O envio à construtora no fluxo certo.** Desde a 0154 o envio é do
 *    GERENTE do negócio, na aba Anexos, depois da conferência aprovada e só para
 *    construtora de fluxo externo; o corretor não vê o botão. Aqui a construtora
 *    é externa, o campo "Para" tem de nascer com `developers.submission_email`,
 *    a gravação passa por `enqueue_developer_submission` (o gerente não tem
 *    `cca.review`, que é o que a tabela cobra) e enfileirar tem de mover o caso
 *    sozinho (gatilho `developer_submissions_advance_case`, 0077) em vez de
 *    exigir um "Mover para…" à mão.
 */
test.describe.serial("CCA · leitura, 375 px e envio externo", () => {
  let cenario: Cenario;
  let casoId = "";
  let docComArquivo: DocumentoDoNegocio;
  let docSemArquivo: DocumentoDoNegocio;

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
    docComArquivo = await semearDocumento(cenario, "rg_cpf");
    await subirArquivo(docComArquivo.storage_path, `dossie ${cenario.tag}`);
    // Registro sem objeto no bucket: o estado que o inventário achou na
    // homologação. `limparCenario` limpa os dois do mesmo jeito.
    // Sem arquivo DE PROPÓSITO: é o documento que faz a tela dizer
    // "Documento sem arquivo" e travar o envio.
    docSemArquivo = await semearDocumento(cenario, "comprovante_renda", { comArquivo: false });
  });

  test.afterAll(async () => {
    await limparCenario(cenario);
  });

  /**
   * O gerente abre o negócio pelo cartão da esteira (o mesmo `DealDetailModal`
   * do Pipeline), aba Anexos, "Enviar à construtora". Pela esteira e não pelo
   * Pipeline para o último teste conferir o quadro que fica por baixo.
   */
  async function abrirEnvioComoGerente(page: Page) {
    await comSessao(page, "manager");
    await page.goto("/cca");
    await aguardarCarregamento(page);
    await page
      .getByRole("article")
      .filter({ hasText: cenario.cliente })
      .getByRole("button", { name: /^abrir o negócio de/i })
      .click();
    await abaDoModal(page, /^anexos$/i).click();
    const enviar = page.getByRole("dialog").getByRole("button", { name: /enviar à construtora/i });
    // Externa COM e-mail: sem o motivo de cadastro torto e sem botão cinza.
    await expect(enviar).toBeEnabled();
    await expect(page.getByText(/construtora sem e-mail cadastrado/i)).toHaveCount(0);
    await enviar.click();
    return page.getByRole("dialog", { name: "Enviar dossiê para a construtora" });
  }

  test("diretoria e gerência abrem a esteira em modo leitura; o cartão não envia à construtora", async ({ page }) => {
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

    // Nem quem decide a esteira tem o envio no cartão (0154). O "Mover para…"
    // presente é o que faz a ausência provar algo: o cartão desenhou os
    // controles de escrita, e o envio não está entre eles.
    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);
    const card = page.getByRole("article").filter({ hasText: cenario.cliente });
    await expect(card.getByRole("combobox", { name: `Mover ${cenario.cliente} para outro estágio` })).toBeVisible();
    await expect(card.getByRole("button", { name: /enviar à construtora/i })).toHaveCount(0);
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

  /**
   * A conferência da carga é um RETRATO: o arquivo pode sumir enquanto o
   * gerente redige a mensagem. Sem a reconferência no clique, a submission
   * entrava na fila e `submission-dispatch` fazia `throw` no anexo inexistente —
   * envio "Falhou", uma das 5 tentativas gasta e a mensagem crua do Storage no
   * histórico. E com TODO documento sem arquivo o botão precisa travar: não há
   * uma caixa sequer clicável para cumprir "selecione ao menos um documento".
   */
  /**
   * Na conferência aprovada o botão é de quem confere. A ausência só prova algo
   * com a aba já carregada no estado em que o gerente VÊ o botão ("Conferido",
   * construtora externa com e-mail) — e o gerente vê, nos dois testes abaixo.
   */
  test("na conferência aprovada o corretor não vê o envio à construtora", async ({ page }) => {
    await comSessao(page, "broker");
    await abrirNegocio(page, cenario.cliente);
    await abaDoModal(page, /^anexos$/i).click();

    await expect(page.getByRole("dialog").getByText("Conferido", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /enviar à construtora/i })).toHaveCount(0);
  });

  test("arquivo apagado com o diálogo aberto é barrado no clique, e o dossiê vazio trava o botão", async ({ page }) => {
    const dialogo = await abrirEnvioComoGerente(page);
    await expect(dialogo.getByText("Documentos (1 de 2)", { exact: true })).toBeVisible();

    // O arquivo do documento BOM some depois de a seleção já estar montada.
    await apagarDoBucket("deal-documents", docComArquivo.storage_path);
    try {
      await dialogo.getByRole("button", { name: /enfileirar envio/i }).click();

      await expect(page.getByText("Documento sem arquivo", { exact: true })).toBeVisible();
      // Nada foi enfileirado: é o que separa a recusa de um envio condenado.
      expect(
        await db.select(`developer_submissions?deal_id=eq.${cenario.dealId}&select=id`),
      ).toHaveLength(0);

      // A tela passa a mostrar o que a reconferência descobriu — senão o
      // gerente clicaria de novo na mesma seleção — e o botão trava, porque
      // agora não há caixa clicável nenhuma.
      await expect(dialogo.getByText("Documentos (0 de 2)", { exact: true })).toBeVisible();
      await expect(
        dialogo.getByRole("checkbox", { name: new RegExp(escapar(docComArquivo.stored_name)) }),
      ).toBeDisabled();
      await expect(dialogo.getByRole("button", { name: /enfileirar envio/i })).toBeDisabled();
    } finally {
      await subirArquivo(docComArquivo.storage_path, `dossie ${cenario.tag}`);
    }
  });

  test("o gerente envia pela conferência: nasce com o e-mail do cadastro e move o caso", async ({ page }) => {
    const dialogo = await abrirEnvioComoGerente(page);

    // Quem envia redigitava o endereço a cada envio, e errar uma letra ali não
    // dá erro em lugar nenhum: o dossiê simplesmente não chega.
    const destinatario = dialogo.getByLabel("Destinatário", { exact: true });
    await expect(destinatario).toHaveValue(`dossie-${cenario.tag}@construtora.test`);

    // `submission-dispatch` assina cada documento e faz `throw` no primeiro que
    // não existe: um registro sem arquivo derruba o envio INTEIRO e gasta uma
    // das 5 tentativas. O diálogo pré-selecionava TUDO, inclusive esse.
    await expect(
      dialogo.getByRole("checkbox", { name: new RegExp(escapar(docComArquivo.stored_name)) }),
    ).toBeChecked();
    const ausente = dialogo.getByRole("checkbox", {
      name: new RegExp(`${escapar(docSemArquivo.stored_name)}.*arquivo ausente`),
    });
    await expect(ausente).not.toBeChecked();
    // Desmarcado não basta: marcar de novo devolveria o mesmo envio "Falhou".
    await expect(ausente).toBeDisabled();
    await expect(dialogo.getByText(/o arquivo não está no armazenamento/i)).toBeVisible();
    await expect(dialogo.getByText("Documentos (1 de 2)", { exact: true })).toBeVisible();

    await dialogo.getByRole("button", { name: /enfileirar envio/i }).click();
    await expect(page.getByText("Envio enfileirado", { exact: true })).toBeVisible();

    const [envio] = await db.select<{
      to_email: string;
      status: string;
      document_ids: string[];
      requested_by: string;
    }>(`developer_submissions?deal_id=eq.${cenario.dealId}&select=to_email,status,document_ids,requested_by`);
    expect(envio.to_email).toBe(`dossie-${cenario.tag}@construtora.test`);
    expect(envio.status).toBe("queued");
    // Só o documento que existe entrou no envio gravado.
    expect(envio.document_ids).toEqual([docComArquivo.id]);
    // Gravado pela RPC na sessão do gerente, não por quem tem `cca.review`.
    expect(envio.requested_by).toBe(await db.profileIdOf("manager"));

    // Reenviar e cancelar gravam na tabela, que é `cca.review`: o gerente vê o
    // envio na fila, mas não o botão que o banco recusaria.
    const historico = dialogo.getByRole("group", { name: "Envios anteriores" });
    await expect(historico.getByText("Na fila", { exact: true })).toBeVisible();
    await expect(historico.getByRole("button")).toHaveCount(0);

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

    // O quadro por baixo recarrega sem F5. A coluna vem do banco: desde a 0150
    // "Enviado à Construtora" só fica ativa se já havia construtora externa
    // ativa quando a migration rodou; sem ela o caso fica na coluna em que
    // estava, agora com `sent_to_developer` — e não pode sumir do quadro.
    // Fecha o envio e depois o negócio: com o modal aberto o quadro fica
    // `aria-hidden` e nenhuma busca por papel o enxerga.
    await dialogo.getByRole("button", { name: /^fechar$/i }).first().click();
    await expect(dialogo).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const [{ cca_stages: estagio }] = await db.select<{ cca_stages: { name: string } }>(
      `cca_cases?id=eq.${casoId}&select=cca_stages(name)`,
    );
    const coluna = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: estagio.name, exact: true }) });
    await expect(coluna.getByRole("article").filter({ hasText: cenario.cliente })).toHaveCount(1);
  });
});
