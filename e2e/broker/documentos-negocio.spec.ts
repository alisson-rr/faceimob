import type { Page } from "@playwright/test";
import { test, expect, db } from "../support/fixtures";
import {
  abrirNegocio,
  apagarDoBucket,
  arquivo,
  botaoAnexar,
  cabecalhosDe,
  campoDeArquivo,
  criarCenario,
  documentosDoNegocio,
  existeNoBucket,
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
  await page.getByRole("tab", { name: "Anexos", exact: true }).click();
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
    // O sufixo `-holerite` é do nome original: "Comprovante de Renda" aceita
    // vários, e nenhum placeholder do padrão distingue dois envios do mesmo dia.
    expect(doc.stored_name).toMatch(
      new RegExp(`^comprovante-renda-docs-${negocio.tag}-\\d{4}-\\d{2}-\\d{2}-holerite\\.pdf$`),
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

    // Nomes DIFERENTES entre si. Enquanto o padrão só usava tipo, cliente e
    // data, os dois "Outros" do mesmo dia viravam o mesmo nome: a lista mostrava
    // duas linhas idênticas e os dois "Baixar" entregavam arquivos diferentes
    // com o mesmo nome — e o e2e antigo só contava linhas.
    const docs = await documentosDoNegocio(negocio.dealId);
    const nomes = docs.filter((d) => d.document_type_id === outros.id).map((d) => d.stored_name);
    expect(new Set(nomes).size).toBe(2);
    expect(nomes.some((n) => n.endsWith("-anexo-a.pdf"))).toBe(true);
    expect(nomes.some((n) => n.endsWith("-anexo-b.pdf"))).toBe(true);
  });

  /**
   * Depois de "Enviar ao gerente" o dossiê é prova.
   *
   * A 0059 fechou o DELETE ('draft'/'returned') e deixou o INSERT aberto: o
   * corretor trocava a versão que o gerente estava conferindo — e que o analista
   * ia baixar — sem deixar rastro, com o banco aceitando calado. A 0077 leva a
   * mesma cláusula para o INSERT, e o botão sai da tela junto: as duas pontas
   * precisam concordar, senão vira "os dois falham em silêncio".
   */
  test("dossiê em conferência não recebe mais arquivo — nem pela tela, nem direto", async ({ page }) => {
    await abrirAnexos(page);
    await campoDeArquivo(page, "RG / CPF").setInputFiles(arquivo("rg.pdf", "documento"));
    await expect(baixarBotoes(page)).toHaveCount(1);

    await db.update(`deals?id=eq.${negocio.dealId}`, {
      document_review_status: "pending",
      document_review_requested_at: new Date().toISOString(),
      document_review_requested_by: await db.profileIdOf("broker"),
    });

    // Reabre pelo caminho normal: a aba recarrega o estado da conferência.
    await abrirAnexos(page);
    await expect(page.getByRole("button", { name: /^Anexar / })).toHaveCount(0);
    await expect(page.getByText(/peça a devolução para anexar de novo/i)).toBeVisible();
    // Baixar continua: o dossiê fica visível, o que some é a escrita.
    await expect(baixarBotoes(page)).toHaveCount(1);

    const tipo = await tipoDocumento("ctps");
    const recusado = await fetch(`${urlSupabase()}/rest/v1/deal_documents`, {
      method: "POST",
      headers: await cabecalhosDe("broker"),
      body: JSON.stringify({
        deal_id: negocio.dealId,
        document_type_id: tipo.id,
        storage_path: `${negocio.dealId}/${Date.now()}-fora-de-hora.pdf`,
        original_name: "fora-de-hora.pdf",
        stored_name: "fora-de-hora.pdf",
      }),
    });
    expect(recusado.ok, await recusado.text()).toBe(false);
    expect(await documentosDoNegocio(negocio.dealId)).toHaveLength(1);
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
      arquivo("Banco X.pdf", "simulacao"),
    );
    await expect(baixarBotoes(page)).toHaveCount(1);

    const [doc] = await documentosDoNegocio(negocio.dealId);
    // "Simulação de Crédito" aceita várias (uma por banco), daí o sufixo com o
    // nome original — é o que separa uma simulação da outra na lista.
    expect(doc.stored_name).toBe(`simulacao-${negocio.dealCode.toLowerCase()}-banco-x.pdf`);
  });

  // A validação de fronteira não existia: qualquer FileList era aceita e o
  // arquivo só era recusado (quando era) depois de subir.
  test("recusa extensão fora da lista antes de subir qualquer coisa", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "Outros").setInputFiles({
      name: "instalador.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("MZ-nao-e-documento"),
    });

    await expect(page.getByText("Arquivo recusado", { exact: true })).toBeVisible();
    await expect(page.getByText(/\.exe/)).toBeVisible();
    // Recusar na tela e gravar mesmo assim seria pior que não validar.
    expect(await documentosDoNegocio(negocio.dealId)).toHaveLength(0);
  });

  // O caminho que a pessoa usa é o BOTÃO; o input fica escondido atrás dele e
  // era o único exercitado até aqui.
  test("o botão visível abre o seletor e envia o arquivo escolhido", async ({ page }) => {
    await abrirAnexos(page);

    const [seletor] = await Promise.all([
      page.waitForEvent("filechooser"),
      botaoAnexar(page, "CTPS").click(),
    ]);
    await seletor.setFiles(arquivo("ctps.pdf", "carteira"));

    await expect(baixarBotoes(page)).toHaveCount(1);
    const docs = await documentosDoNegocio(negocio.dealId);
    expect(docs).toHaveLength(1);
    expect(docs[0].document_type_id).toBe((await tipoDocumento("ctps")).id);
  });

  // `allows_multiple` não versiona: sem exclusão o arquivo errado ficava lá
  // para sempre, e `deal_documents_delete` era só admin (corrigido na 0059).
  test("corretor exclui o documento errado enquanto o dossiê é dele", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "Outros").setInputFiles(arquivo("errado.pdf", "arquivo trocado"));
    await expect(baixarBotoes(page)).toHaveCount(1);
    const [doc] = await documentosDoNegocio(negocio.dealId);

    await page.getByRole("button", { name: `Excluir ${doc.stored_name}` }).click();
    await expect(page.getByText("Documento excluído", { exact: true })).toBeVisible();
    await expect(baixarBotoes(page)).toHaveCount(0);

    expect(await documentosDoNegocio(negocio.dealId)).toHaveLength(0);
    // Linha apagada e arquivo no bucket seria exclusão pela metade.
    expect(await existeNoBucket(doc.storage_path)).toBe(false);
  });

  /**
   * A cópia do anexo do lead, que a 0059 quase fechou de fora.
   *
   * `promoteLeadAttachments` copia o objeto para `deal-documents` com a MESMA
   * chave — e a chave do lead é `<lead_id>/...`. Como o `with_check` do bucket
   * cobra `can_edit_deal(<primeiro segmento>)`, o prefixo de LEAD não é negócio
   * nenhum: sem o ramo de `lead_attachments` toda conversão com anexo passaria a
   * falhar para corretor e gerente, com a linha em `deal_documents` apontando
   * para um arquivo que nunca chegou ao bucket.
   *
   * Aqui a cópia é feita com o JWT REAL do corretor — a mesma chamada que o
   * `supabase.storage.copy` da tela dispara. Passar pelo diálogo de conversão
   * (arquivo de outra frente) testaria a mesma policy por um caminho mais longo
   * e mais frágil.
   */
  test("o corretor copia o anexo do próprio lead para o bucket do negócio", async () => {
    const corretor = await db.profileIdOf("broker");
    const [lead] = await db.insert<{ id: string }>("leads", {
      full_name: `Lead com anexo ${negocio.tag}`,
      phone: `1195555${Math.floor(1000 + Math.random() * 8999)}`,
      status: "in_progress",
      assigned_to: corretor,
    });

    const caminho = `${lead.id}/${Date.now()}-anexo.pdf`;
    const cabecalhos = await cabecalhosDe("broker");
    const envio = await fetch(`${urlSupabase()}/storage/v1/object/lead-attachments/${caminho}`, {
      method: "POST",
      headers: { ...cabecalhos, "Content-Type": "application/pdf", "x-upsert": "true" },
      body: "anexo do lead",
    });
    expect(envio.ok, await envio.text()).toBe(true);
    await db.insert("lead_attachments", {
      lead_id: lead.id,
      storage_path: caminho,
      original_name: "anexo.pdf",
      stored_name: "anexo.pdf",
      mime_type: "application/pdf",
      size_bytes: 13,
      uploaded_by: corretor,
    });

    const copia = await fetch(`${urlSupabase()}/storage/v1/object/copy`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({
        bucketId: "lead-attachments",
        sourceKey: caminho,
        destinationBucket: "deal-documents",
        destinationKey: caminho,
      }),
    });
    expect(copia.ok, await copia.text()).toBe(true);
    expect(await existeNoBucket(caminho)).toBe(true);

    // Conhecer a chave não dá leitura — e a chave circula: `promoteLeadAttachments`
    // copia o objeto para `deal-documents` com a MESMA chave, então quem lê a
    // linha promovida (CCA, gerência) aprende o caminho no bucket do lead. Hoje o
    // `using` do bucket recusa por dois caminhos (o prefixo `<lead_id>/` e a RLS
    // da própria `lead_attachments`); este assert é o que falha se um deles
    // afrouxar, e a policy é FOR ALL — o mesmo `using` governa leitura E exclusão.
    const rival = await cabecalhosDe("brokerRival");
    const leituraAlheia = await fetch(
      `${urlSupabase()}/storage/v1/object/lead-attachments/${caminho}`,
      { headers: rival },
    );
    expect(leituraAlheia.ok).toBe(false);

    // E o outro lado da regra: gravar na pasta de um negócio que o corretor não
    // edita continua recusado — o ramo do lead não virou prefixo livre.
    const alheio = `${crypto.randomUUID()}/${Date.now()}-intruso.pdf`;
    const recusada = await fetch(`${urlSupabase()}/storage/v1/object/copy`, {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({
        bucketId: "lead-attachments",
        sourceKey: caminho,
        destinationBucket: "deal-documents",
        destinationKey: alheio,
      }),
    });
    expect(recusada.ok).toBe(false);

    await apagarDoBucket("deal-documents", caminho);
    await apagarDoBucket("lead-attachments", caminho);
    await db.remove(`leads?id=eq.${lead.id}`);
  });

  /**
   * O escape do ramo do lead — o caso difícil, que o teste acima não cobria.
   *
   * `lead_attachments.storage_path` é `text unique` escolhido por quem insere e
   * não tem vínculo nenhum com `lead_id`; `lead_attachments_insert` só cobra
   * `uploaded_by = auth.uid()` e `can_see_lead(lead_id)`. Enquanto o `with_check`
   * do bucket aceitasse só "existe uma linha com este caminho", bastava o
   * corretor registrar no PRÓPRIO lead uma linha apontando para
   * `<negócio alheio>/x.pdf` para gravar — e, com `x-upsert`, sobrescrever —
   * arquivo na pasta de um negócio que ele não edita. O prefixo aleatório do
   * teste anterior é o caso fácil: passa mesmo com o furo aberto.
   */
  test("linha de anexo forjada não abre a pasta de um negócio alheio", async () => {
    const alvo = await criarCenario({ dono: "brokerRival", apelido: "Alvo" });
    const corretor = await db.profileIdOf("broker");
    const [lead] = await db.insert<{ id: string }>("leads", {
      full_name: `Lead do intruso ${negocio.tag}`,
      phone: `1195556${Math.floor(1000 + Math.random() * 8999)}`,
      status: "in_progress",
      assigned_to: corretor,
    });

    // Caminho do NEGÓCIO ALHEIO gravado numa linha do lead do próprio corretor.
    const forjado = `${alvo.dealId}/${Date.now()}-forjado.pdf`;
    await db.insert("lead_attachments", {
      lead_id: lead.id,
      storage_path: forjado,
      original_name: "forjado.pdf",
      stored_name: "forjado.pdf",
      mime_type: "application/pdf",
      size_bytes: 17,
      uploaded_by: corretor,
    });

    const recusado = await fetch(`${urlSupabase()}/storage/v1/object/deal-documents/${forjado}`, {
      method: "POST",
      headers: {
        ...(await cabecalhosDe("broker")),
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: "documento intruso",
    });
    expect(recusado.ok, await recusado.text()).toBe(false);
    expect(await existeNoBucket(forjado)).toBe(false);

    await db.remove(`leads?id=eq.${lead.id}`);
    await limparCenario(alvo);
  });

  /**
   * Excluir a versão vigente não pode deixar o tipo SEM vigente.
   *
   * A FK `superseded_by` é `on delete set null`, mas `superseded_at` não era
   * limpo por ninguém: apagando a v2, a v1 continuava marcada como substituída,
   * sumia da lista padrão e o obrigatório voltava a contar como faltando — com
   * o arquivo v1 ainda no bucket e visível só em "Ver histórico". O botão
   * Excluir só aparece na linha vigente, então este é o caminho normal.
   */
  test("apagar a versão vigente devolve a anterior ao dossiê", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "RG / CPF").setInputFiles(arquivo("rg-v1.pdf", "primeira via"));
    await expect(baixarBotoes(page)).toHaveCount(1);
    await campoDeArquivo(page, "RG / CPF").setInputFiles(arquivo("rg-v2.pdf", "segunda via"));
    await expect(page.getByText("+1 versão(ões) no histórico")).toBeVisible();
    await expect(page.getByText(/faltam 2 obrigatórios/i)).toBeVisible();

    const antes = await documentosDoNegocio(negocio.dealId);
    const v2 = antes.find((d) => !d.superseded_at)!;
    const v1 = antes.find((d) => d.superseded_at)!;
    expect(v2.version).toBe(2);

    await page.getByRole("button", { name: `Excluir ${v2.stored_name}` }).click();
    await expect(page.getByText("Documento excluído", { exact: true })).toBeVisible();

    // A v1 volta a ser a vigente: um arquivo na lista padrão, nada no histórico
    // e o obrigatório continua atendido.
    await expect(baixarBotoes(page)).toHaveCount(1);
    await expect(page.getByText("+1 versão(ões) no histórico")).toHaveCount(0);
    await expect(page.getByText(/faltam 2 obrigatórios/i)).toBeVisible();

    const depois = await documentosDoNegocio(negocio.dealId);
    expect(depois).toHaveLength(1);
    expect(depois[0].id).toBe(v1.id);
    expect(depois[0].superseded_at).toBeNull();
    expect(await existeNoBucket(v2.storage_path)).toBe(false);
    expect(await existeNoBucket(v1.storage_path)).toBe(true);
  });

  // O negativo do armazenamento: até aqui nenhum teste provava que o documento
  // de um negócio alheio NÃO é acessível — só que o próprio dono baixa.
  test("corretor de outra equipe não lê nem assina o documento alheio", async ({ page }) => {
    await abrirAnexos(page);

    await campoDeArquivo(page, "RG / CPF").setInputFiles(arquivo("rg.pdf", "documento sigiloso"));
    await expect(baixarBotoes(page)).toHaveCount(1);
    const [doc] = await documentosDoNegocio(negocio.dealId);

    const rival = await cabecalhosDe("brokerRival");

    const linha = await fetch(
      `${urlSupabase()}/rest/v1/deal_documents?id=eq.${doc.id}&select=id`,
      { headers: rival },
    );
    expect(await linha.json()).toEqual([]);

    const assinatura = await fetch(
      `${urlSupabase()}/storage/v1/object/sign/deal-documents/${doc.storage_path}`,
      { method: "POST", headers: rival, body: JSON.stringify({ expiresIn: 60 }) },
    );
    expect(assinatura.ok).toBe(false);
  });
});
