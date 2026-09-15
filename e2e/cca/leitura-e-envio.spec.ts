import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { subirArquivo } from "../helpers/negocio";
import { resolveTarget } from "../support/target";
import {
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

  /**
   * A conferência da carga é um RETRATO: o arquivo pode sumir enquanto o
   * analista redige a mensagem. Sem a reconferência no clique, a submission
   * entrava na fila e `submission-dispatch` fazia `throw` no anexo inexistente —
   * envio "Falhou", uma das 5 tentativas gasta e a mensagem crua do Storage no
   * histórico. E com TODO documento sem arquivo o botão precisa travar: não há
   * uma caixa sequer clicável para cumprir "selecione ao menos um documento".
   */
  test("arquivo apagado com o diálogo aberto é barrado no clique, e o dossiê vazio trava o botão", async ({ page }) => {
    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);

    const card = page.getByRole("article").filter({ hasText: cenario.cliente });
    await card.getByRole("button", { name: /enviar à construtora/i }).click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText("Documentos (1 de 2)", { exact: true })).toBeVisible();

    // O arquivo do documento BOM some depois de a seleção já estar montada.
    await apagarDoBucket("deal-documents", docComArquivo.storage_path);
    try {
      await page.getByRole("button", { name: /enfileirar envio/i }).click();

      await expect(page.getByText("Documento sem arquivo", { exact: true })).toBeVisible();
      // Nada foi enfileirado: é o que separa a recusa de um envio condenado.
      expect(
        await db.select(`developer_submissions?deal_id=eq.${cenario.dealId}&select=id`),
      ).toHaveLength(0);

      // A tela passa a mostrar o que a reconferência descobriu — senão o
      // analista clicaria de novo na mesma seleção — e o botão trava, porque
      // agora não há caixa clicável nenhuma.
      await expect(dialogo.getByText("Documentos (0 de 2)", { exact: true })).toBeVisible();
      await expect(
        dialogo.getByRole("checkbox", { name: new RegExp(escapar(docComArquivo.stored_name)) }),
      ).toBeDisabled();
      await expect(page.getByRole("button", { name: /enfileirar envio/i })).toBeDisabled();
    } finally {
      await subirArquivo(docComArquivo.storage_path, `dossie ${cenario.tag}`);
    }
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

    // `submission-dispatch` assina cada documento e faz `throw` no primeiro que
    // não existe: um registro sem arquivo derruba o envio INTEIRO e gasta uma
    // das 5 tentativas. O diálogo pré-selecionava TUDO, inclusive esse.
    const dialogo = page.getByRole("dialog");
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

    await page.getByRole("button", { name: /enfileirar envio/i }).click();
    await expect(page.getByText("Envio na fila", { exact: true })).toBeVisible();

    const [envio] = await db.select<{ to_email: string; status: string; document_ids: string[] }>(
      `developer_submissions?deal_id=eq.${cenario.dealId}&select=to_email,status,document_ids`,
    );
    expect(envio.to_email).toBe(`dossie-${cenario.tag}@construtora.test`);
    expect(envio.status).toBe("queued");
    // Só o documento que existe entrou no envio gravado.
    expect(envio.document_ids).toEqual([docComArquivo.id]);

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
    await page.getByRole("dialog").getByRole("button", { name: /^fechar$/i }).first().click();
    const [{ cca_stages: estagio }] = await db.select<{ cca_stages: { name: string } }>(
      `cca_cases?id=eq.${casoId}&select=cca_stages(name)`,
    );
    const coluna = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: estagio.name, exact: true }) });
    await expect(coluna.getByRole("article").filter({ hasText: cenario.cliente })).toHaveCount(1);
  });
});
