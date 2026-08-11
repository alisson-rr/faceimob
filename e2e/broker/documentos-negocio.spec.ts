import type { Page } from "@playwright/test";
import { test, expect, db } from "../support/fixtures";
import {
  abrirNegocio,
  arquivo,
  campoDeArquivo,
  criarCenario,
  documentosDoNegocio,
  limparCenario,
  tipoDocumento,
  urlSupabase,
  type Cenario,
} from "../cca/esteira";

/**
 * Documentos do negócio, pela visão de quem os anexa (o corretor).
 *
 * A ata de 23/07 pediu três coisas do anexo: um campo por TIPO de documento,
 * renomeação automática no envio e histórico de alterações para o CCA. As três
 * são conferidas em `deal_documents` depois de agir na tela — o toast não serve
 * de prova: uma auditoria recente achou tela que dizia "salvo" sem gravar nada.
 */

let negocio: Cenario;

test.beforeEach(async () => {
  // Um negócio por caso: versão e badge dependem do estado inicial, e
  // compartilhar o negócio faria a ordem de execução virar regra escondida.
  negocio = await criarCenario({ dono: "broker", apelido: "Docs" });
});

test.afterEach(async () => {
  await limparCenario(negocio);
});

const abrirAnexos = async (page: Page) => {
  await abrirNegocio(page, negocio.cliente);
  await page.getByRole("button", { name: "Anexos", exact: true }).click();
  await expect(page.getByText(/anexar documentos/i)).toBeVisible();
};

/** Cada documento vigente na lista tem seu botão "Baixar <nome>"; contá-los é
 *  o sinal estável de que o envio anterior terminou e a lista recarregou. */
const baixarBotoes = (page: Page) => page.getByRole("button", { name: /^Baixar / });

test.describe("corretor · documentos do negócio", () => {
  test("acusa quantos obrigatórios faltam e fecha quando todos entram", async ({ page }) => {
    await abrirAnexos(page);

    // O seed marca três tipos como `required_for_conversion`.
    await expect(page.getByText(/faltam 3 obrigatórios/i)).toBeVisible();

    const obrigatorios = ["RG / CPF", "Comprovante de Renda", "Comprovante de Residência"];
    for (const [i, rotulo] of obrigatorios.entries()) {
      await campoDeArquivo(page, rotulo).setInputFiles(arquivo(`obrigatorio-${i}.pdf`, `doc ${i}`));
      await expect(baixarBotoes(page)).toHaveCount(i + 1);
    }

    await expect(page.getByText(/obrigatórios completos/i)).toBeVisible();

    const docs = await documentosDoNegocio(negocio.dealId);
    expect(docs.filter((d) => !d.superseded_at)).toHaveLength(3);
  });

  test("renomeia o arquivo pelo naming_pattern do tipo e grava a linha", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "RG / CPF").setInputFiles(
      arquivo("Foto do RG (frente).PDF", "rg do titular"),
    );

    // `{tipo}-{cliente}` é o padrão do RG/CPF no seed. O nome original — com
    // espaço, parêntese e extensão em caixa alta — não pode sobreviver ao envio.
    const esperado = `rg-cpf-docs-${negocio.tag}.pdf`;
    await expect(baixarBotoes(page)).toHaveCount(1);
    await expect(page.getByText(esperado).first()).toBeVisible();

    const tipo = await tipoDocumento("rg_cpf");
    const docs = await documentosDoNegocio(negocio.dealId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      document_type_id: tipo.id,
      stored_name: esperado,
      original_name: "Foto do RG (frente).PDF",
      mime_type: "application/pdf",
      version: 1,
      superseded_at: null,
    });
    expect(docs[0].storage_path).toContain(negocio.dealId);
  });

  test("naming_pattern com {data} resolve a data do envio", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "Comprovante de Renda").setInputFiles(
      arquivo("holerite.pdf", "renda"),
    );
    await expect(baixarBotoes(page)).toHaveCount(1);

    const [doc] = await documentosDoNegocio(negocio.dealId);
    expect(doc.stored_name).toMatch(
      new RegExp(`^comprovante-renda-docs-${negocio.tag}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`),
    );
  });

  test("substituir versiona: a anterior vira histórico em vez de sumir", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "RG / CPF").setInputFiles(arquivo("rg-v1.pdf", "primeira via"));
    await expect(baixarBotoes(page)).toHaveCount(1);

    await campoDeArquivo(page, "RG / CPF").setInputFiles(arquivo("rg-v2.pdf", "segunda via"));
    // A lista de vigentes continua com um item — o que muda é qual é ele.
    await expect(page.getByText("rg-cpf-docs-" + negocio.tag + ".pdf").first()).toBeVisible();
    await expect(page.getByText(/1 versão\(ões\) no histórico/i)).toBeVisible();

    const docs = await db.select<{
      id: string;
      version: number;
      superseded_at: string | null;
      superseded_by: string | null;
      original_name: string;
    }>(
      `deal_documents?deal_id=eq.${negocio.dealId}` +
        "&select=id,version,superseded_at,superseded_by,original_name&order=version.asc",
    );

    // Quem fecha a versão anterior é o trigger `deal_documents_supersede`.
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ version: 1, original_name: "rg-v1.pdf" });
    expect(docs[0].superseded_at).not.toBeNull();
    expect(docs[0].superseded_by).toBe(docs[1].id);
    expect(docs[1]).toMatchObject({ version: 2, original_name: "rg-v2.pdf", superseded_at: null });

    // O histórico é o que o CCA pediu: some da lista curta, não do sistema.
    await page.getByRole("button", { name: /ver histórico/i }).click();
    await expect(baixarBotoes(page)).toHaveCount(2);
    await expect(page.getByText(/substituído/i).first()).toBeVisible();
  });

  test("tipo com allows_multiple aceita vários; tipo único mantém um vigente", async ({ page }) => {
    await abrirAnexos(page);

    // "Outros" é o tipo que o seed marca com allows_multiple.
    await campoDeArquivo(page, "Outros").setInputFiles([
      arquivo("anexo-a.pdf", "a"),
      arquivo("anexo-b.pdf", "b"),
    ]);
    await expect(page.getByText(/2 arquivos enviados/i)).toBeVisible();
    await expect(baixarBotoes(page)).toHaveCount(2);

    // "CTPS" não aceita múltiplos: dois envios deixam um só vigente.
    await campoDeArquivo(page, "CTPS").setInputFiles(arquivo("ctps-1.pdf", "1"));
    await expect(baixarBotoes(page)).toHaveCount(3);
    await campoDeArquivo(page, "CTPS").setInputFiles(arquivo("ctps-2.pdf", "2"));

    const outros = await tipoDocumento("outros");
    const ctps = await tipoDocumento("ctps");

    await expect(async () => {
      const docs = await documentosDoNegocio(negocio.dealId);
      expect(docs.filter((d) => d.document_type_id === ctps.id)).toHaveLength(2);

      const vigentes = docs.filter((d) => !d.superseded_at);
      expect(vigentes.filter((d) => d.document_type_id === outros.id)).toHaveLength(2);
      expect(vigentes.filter((d) => d.document_type_id === ctps.id)).toHaveLength(1);
      // Multiplicidade não versiona: os dois "Outros" ficam na v1.
      expect(
        docs.filter((d) => d.document_type_id === outros.id).every((d) => d.version === 1),
      ).toBe(true);
    }).toPass({ timeout: 15_000 });

    // Na lista curta continuam 3: dois "Outros" e o CTPS vigente.
    await expect(baixarBotoes(page)).toHaveCount(3);
  });

  test("baixar entrega o arquivo enviado por URL assinada", async ({ page }) => {
    await abrirAnexos(page);

    const conteudo = `comprovante de residencia ${negocio.tag}`;
    await campoDeArquivo(page, "Comprovante de Residência").setInputFiles(
      arquivo("conta-de-luz.pdf", conteudo),
    );
    const esperado = `comprovante-resid-docs-${negocio.tag}.pdf`;
    await expect(baixarBotoes(page)).toHaveCount(1);

    const [assinatura] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/storage/v1/object/sign/deal-documents/")),
      page.getByRole("button", { name: `Baixar ${esperado}` }).click(),
    ]);
    expect(assinatura.ok()).toBe(true);

    // Assinar sem servir seria um botão que só parece funcionar: o link tem de
    // devolver o mesmo byte que subiu.
    const { signedURL } = (await assinatura.json()) as { signedURL: string };
    const baixado = await page.request.get(`${urlSupabase()}/storage/v1${signedURL}`);
    expect(baixado.ok()).toBe(true);
    expect(await baixado.text()).toBe(conteudo);
  });

  // O placeholder precisa usar o identificador humano exibido pela operação;
  // UUID serve para armazenamento, não para o nome entregue ao cliente.
  test("naming_pattern {negocio} usa o código do negócio, não o uuid", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "Simulação de Crédito").setInputFiles(
      arquivo("simulacao.pdf", "simulacao"),
    );
    await expect(baixarBotoes(page)).toHaveCount(1);

    const [doc] = await documentosDoNegocio(negocio.dealId);
    expect(doc.stored_name).toBe(`simulacao-${negocio.dealCode.toLowerCase()}.pdf`);
  });
});
