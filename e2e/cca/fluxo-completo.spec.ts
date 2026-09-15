import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { subirArquivo } from "../helpers/negocio";
import { resolveTarget } from "../support/target";
import {
  abaDoModal,
  abrirNegocio,
  comSessao,
  criarCenario,
  estagioCca,
  limparCenario,
  semearCasoCca,
  semearDocumento,
  urlSupabase,
  type Cenario,
  type DocumentoDoNegocio,
} from "./esteira";


test.describe.serial("CCA · análise, decisão e envio", () => {
  let cenario: Cenario;
  let casoId = "";
  let documento: DocumentoDoNegocio;

  test.beforeAll(async () => {
    cenario = await criarCenario({ dono: "broker", etapa: "under_analysis", apelido: "Credito" });
    await db.update(`deals?id=eq.${cenario.dealId}`, { document_review_status: "approved" });
    const etapa = await estagioCca("under_review");
    const [caso] = await semearCasoCca(cenario, "under_review", etapa.id);
    casoId = caso.id;
    documento = await semearDocumento(cenario, "rg_cpf");
  });

  test.afterAll(async () => {
    await limparCenario(cenario);
  });

  test("registra análise, aprova com histórico e reprocessa o dossiê", async ({ page }) => {
    await comSessao(page, "cca");

    await abrirNegocio(page, cenario.cliente);
    await abaDoModal(page, /^cca$/i).click();
    // Os campos da aba CCA ganharam `useId` + `<Label htmlFor>` na Tarefa H
    // (achado X04): o placeholder deixou de ser a única pista do que é o campo.
    await page.getByLabel("Renda aprovada", { exact: true }).fill("R$ 8.500,00");
    await page.getByRole("button", { name: /confirmar alterações/i }).click();
    await expect(page.getByText("Alterações salvas", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const [row] = await db.select<{ analysis: Record<string, string> }>(
        `cca_cases?id=eq.${casoId}&select=analysis`,
      );
      return row?.analysis?.renda_aprovada;
    }).toBe("R$ 8.500,00");

    await page.goto("/cca");
    await aguardarCarregamento(page);
    // O cartão virou `<article>` e o "Mover p/ X" — que só aparecia no hover,
    // em 8 px (achado X02) — virou um `<Select>` **sempre visível**, com nome
    // acessível. Sem hover: quem usa no celular não tem hover para dar.
    const card = page.getByRole("article").filter({ hasText: cenario.cliente });
    await expect(card).toHaveCount(1);
    await card.getByRole("combobox", { name: `Mover ${cenario.cliente} para outro estágio` }).click();
    // As 19 colunas da 0150: cada uma grava o próprio Status 2 no negócio.
    await page.getByRole("option", { name: "APROVADO TOTAL", exact: true }).click();
    // A mensagem abre VAZIA e é obrigatória: é o aviso que chega à equipe.
    const mensagem = page.getByLabel("Mensagem para a equipe", { exact: true });
    const textoMovimento = `Crédito aprovado no teste E2E ${cenario.tag}`;
    await expect(mensagem).toHaveValue("");
    await expect(page.getByRole("button", { name: /^confirmar$/i })).toBeDisabled();
    await mensagem.fill(textoMovimento);
    await page.getByRole("button", { name: /^confirmar$/i }).click();
    await expect(page.getByText("Caso movido para APROVADO TOTAL", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const [row] = await db.select<{ status: string }>(`cca_cases?id=eq.${casoId}&select=status`);
      return row?.status;
    }).toBe("approved");

    const [deal] = await db.select<{ pipeline_stages: { code: string } }>(
      `deals?id=eq.${cenario.dealId}&select=pipeline_stages(code)`,
    );
    expect(deal.pipeline_stages.code).toBe("approved");
    expect(await db.select(`cca_case_events?case_id=eq.${casoId}&kind=eq.status_changed&to_value=eq.approved&select=id`)).toHaveLength(1);
    expect(await db.select(`deal_history?deal_id=eq.${cenario.dealId}&kind=eq.cca_status_changed&to_value=eq.approved&select=id`)).toHaveLength(1);
    // A coluna gravou o Status 2 dela, e a mensagem virou comentário no negócio.
    const [rotulo] = await db.select<{ status_detail: string | null }>(
      `deals?id=eq.${cenario.dealId}&select=status_detail`,
    );
    expect(rotulo.status_detail).toBe("09. APROV. TOTAL");
    const comentario = encodeURIComponent(`STATUS: APROVADO TOTAL — ${textoMovimento}`);
    expect(
      await db.select(`deal_history?deal_id=eq.${cenario.dealId}&kind=eq.comment&to_value=eq.${comentario}&select=id`),
    ).toHaveLength(1);

    await card.getByRole("button", { name: /enviar à construtora/i }).click();
    // Este cenário usa construtora de fluxo INTERNO (o padrão de `criarCenario`):
    // a análise é do próprio CCA e não há e-mail no cadastro. O cartão oferece o
    // botão assim mesmo, então o diálogo tem de dizer o que o cadastro afirma —
    // em vez de o analista descobrir digitando um endereço de memória. O envio
    // com construtora externa, que é o caminho normal, está em
    // `leitura-e-envio.spec.ts`.
    await expect(page.getByText(/cadastrada como fluxo interno/i)).toBeVisible();
    await page.getByPlaceholder("analise@construtora.com.br").fill("credito@construtora.test");
    await page.getByRole("button", { name: /enfileirar envio/i }).click();
    await expect(page.getByText("Envio na fila", { exact: true })).toBeVisible();

    const [submission] = await db.select<{
      id: string;
      status: string;
      attempts: number;
      document_ids: string[];
    }>(`developer_submissions?deal_id=eq.${cenario.dealId}&select=id,status,attempts,document_ids`);
    expect(submission.status).toBe("queued");
    expect(submission.document_ids).toEqual([documento.id]);

    await db.update(`developer_submissions?id=eq.${submission.id}`, {
      status: "failed",
      attempts: 3,
      last_error: "SMTP indisponível",
    });
    // Dois "Fechar" na página: o do rodapé do diálogo e o "×" do primitivo
    // `dialog.tsx`, que ganhou `sr-only` "Fechar" (achado X03). Ancorar no
    // diálogo aberto resolve sem depender de qual dos dois vem primeiro.
    await page.getByRole("dialog").getByRole("button", { name: /^fechar$/i }).first().click();
    await card.getByRole("button", { name: /enviar à construtora/i }).click();
    await page.getByRole("button", { name: /reenviar/i }).click();
    await expect(page.getByText("Reenfileirado", { exact: true })).toBeVisible();

    await expect.poll(async () => {
      const [row] = await db.select<{ status: string; attempts: number; last_error: string | null }>(
        `developer_submissions?id=eq.${submission.id}&select=status,attempts,last_error`,
      );
      return row;
    }).toEqual({ status: "queued", attempts: 0, last_error: null });
  });

  // O bucket é privado e a assinatura passa pela policy de storage.objects. Até
  // a 0047 ela só aceitava `can_see_deal`, e o CCA não participa de negócio
  // nenhum: listava todo documento e não baixava nenhum.
  test("analista de CCA baixa o documento do dossiê por URL assinada", async ({ page }) => {
    const conteudo = `dossie cca ${cenario.tag}`;
    await subirArquivo(documento.storage_path, conteudo);

    await comSessao(page, "cca");
    await abrirNegocio(page, cenario.cliente);
    await abaDoModal(page, /^anexos$/i).click();

    const [assinatura] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/storage/v1/object/sign/deal-documents/")),
      page.getByRole("button", { name: `Baixar ${documento.stored_name}` }).click(),
    ]);
    expect(assinatura.ok()).toBe(true);
    await expect(page.getByText("Não foi possível baixar", { exact: true })).toHaveCount(0);

    // Assinar sem servir seria um botão que só parece funcionar.
    const { signedURL } = (await assinatura.json()) as { signedURL: string };
    const baixado = await page.request.get(`${urlSupabase()}/storage/v1${signedURL}`);
    expect(baixado.ok()).toBe(true);
    expect(await baixado.text()).toBe(conteudo);
  });

  /**
   * O laço de volta, que morria no meio.
   *
   * Até a 0059 mover o caso para "Pendência de Documentos" só trocava o rótulo:
   * `deals.document_review_status` continuava 'approved', ninguém era avisado e
   * `submit_deal_for_manager_review` recusava o reenvio com "A documentação
   * deste negócio já foi aprovada". O corretor via o rótulo mudar e não tinha
   * ação nenhuma.
   */
  test("devolver por documento reabre a conferência e avisa o corretor", async ({ page }) => {
    const motivo = `Falta comprovante legível ${cenario.tag}`;
    await comSessao(page, "cca");

    await page.goto("/cca");
    await aguardarCarregamento(page);
    const card = page.getByRole("article").filter({ hasText: cenario.cliente });
    await expect(card).toHaveCount(1);
    await card.getByRole("combobox", { name: `Mover ${cenario.cliente} para outro estágio` }).click();
    await page.getByRole("option", { name: "PENDENTE", exact: true }).click();
    await page.getByLabel("Mensagem para a equipe", { exact: true }).fill(motivo);
    await page.getByRole("button", { name: /^confirmar$/i }).click();
    await expect(page.getByText("Caso movido para PENDENTE", { exact: true })).toBeVisible();

    // Desde a 0150 o rótulo é o Status 2 da coluna ("16. PENDENTE"), não o
    // "RET. ESTEIRA AGIL", que é o da coluna RETORNO À ESTEIRA ÁGIL.
    await expect.poll(async () => {
      const [row] = await db.select<{ document_review_status: string; status_detail: string | null }>(
        `deals?id=eq.${cenario.dealId}&select=document_review_status,status_detail`,
      );
      return row;
    }).toEqual({ document_review_status: "returned", status_detail: "16. PENDENTE" });

    const corretor = await db.profileIdOf("broker");
    await expect.poll(async () => {
      const linhas = await db.select(
        `notifications?profile_id=eq.${corretor}&kind=eq.document_review_returned` +
          `&body=like.*${cenario.tag}*&select=id`,
      );
      return linhas.length;
    }).toBe(1);
  });

  // 12 casos cabem na tela; 200 viram rolagem. A busca não existia.
  test("a busca filtra o quadro e explica quando não acha", async ({ page }) => {
    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);

    const busca = page.getByLabel("Buscar caso na esteira", { exact: true });
    await busca.fill(cenario.cliente);
    await expect(page.getByRole("article")).toHaveCount(1);

    await busca.fill(`nao-existe-${cenario.tag}`);
    await expect(page.getByText(/nenhum caso para esta busca/i)).toBeVisible();

    await page.getByRole("button", { name: /limpar busca/i }).click();
    await expect(page.getByRole("article").filter({ hasText: cenario.cliente })).toHaveCount(1);
  });

  // `CcaStageSettingsDialog` não tinha teste nenhum — nem vitest nem e2e.
  test("gerencia os estágios da esteira: cria, renomeia e exclui", async ({ page }) => {
    const nome = `Conferencia ${cenario.tag}`;
    const renomeado = `Conferencia final ${cenario.tag}`;
    const quantosChamados = (valor: string) =>
      db.select(`cca_stages?name=eq.${encodeURIComponent(valor)}&select=id`).then((l) => l.length);

    await comSessao(page, "cca");
    await page.goto("/cca");
    await aguardarCarregamento(page);

    const [pendente] = await db.select<{ id: string }>(
      `deal_statuses?value=eq.${encodeURIComponent("16. PENDENTE")}&select=id`,
    );

    await page.getByRole("button", { name: /gerenciar estágios/i }).click();
    await page.getByLabel("Nome", { exact: true }).fill(nome);
    // O Status 2 que a coluna grava (0150). Com a lista ABERTA — a ausência só
    // prova algo depois de uma opção válida aparecer —, rótulo de envio e
    // desfecho não são oferecidos: o gatilho da esteira os gravaria por cima
    // das travas. "RET. ESTEIRA AGIL" é oferecido (coluna RETORNO À ESTEIRA
    // ÁGIL, 15/09), com o nome do catálogo.
    const [retorno] = await db.select<{ label: string }>(
      `deal_statuses?value=eq.${encodeURIComponent("RET. ESTEIRA AGIL")}&select=label`,
    );
    await page.getByRole("combobox", { name: "Status 2 gravado" }).click();
    await expect(page.getByRole("option", { name: "PENDENTE", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: retorno.label, exact: true })).toBeVisible();
    for (const proibido of ["ESTEIRA AGIL", "ANÁLISE P/ VIRAR NEGÓCIO", "OFF", "QUEDA", "DISTRATO"]) {
      await expect(page.getByRole("option", { name: proibido, exact: true })).toHaveCount(0);
    }
    await page.getByRole("option", { name: "PENDENTE", exact: true }).click();
    await page.getByRole("button", { name: /criar estágio/i }).click();
    await expect(page.getByText("Estágio criado", { exact: true })).toBeVisible();
    await expect.poll(() => quantosChamados(nome)).toBe(1);
    const [criado] = await db.select<{ deal_status_id: string | null }>(
      `cca_stages?name=eq.${encodeURIComponent(nome)}&select=deal_status_id`,
    );
    expect(criado.deal_status_id).toBe(pendente.id);

    await page.getByRole("button", { name: `Editar o estágio ${nome}` }).click();
    await page.getByLabel("Nome", { exact: true }).fill(renomeado);
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText("Estágio atualizado", { exact: true })).toBeVisible();
    await expect.poll(() => quantosChamados(renomeado)).toBe(1);

    await page.getByRole("button", { name: `Excluir o estágio ${renomeado}` }).click();
    await page.getByRole("button", { name: /^excluir$/i }).click();
    await expect(page.getByText("Estágio excluído", { exact: true })).toBeVisible();
    await expect.poll(() => quantosChamados(renomeado)).toBe(0);
  });
});
