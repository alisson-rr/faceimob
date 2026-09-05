/**
 * Importar planilha de leads e a saúde da roleta — as duas coisas que só o
 * gestor faz na tela de Leads (`leads_insert` e `leads.view_queue`).
 *
 * Três coisas que só um teste de ponta a ponta pega:
 *
 *   · a RECUSA do `.xls` legado chega à tela. A Tarefa L trocou o `xlsx` (0.18.5,
 *     abandonado no npm com duas CVEs abertas) por `read-excel-file`, e com isso
 *     o Excel 97-2003 deixou de ser lido. O seletor **continua aceitando `.xls`
 *     de propósito**, para o usuário descobrir o motivo em vez de o arquivo
 *     sumir da janela. `importSheet.test.ts` cobre a mensagem no parser; um
 *     `catch` que virasse `console.error` passaria por lá sem ninguém ver a frase.
 *
 *   · o INSERT acontece. Nenhum teste chegava a gravar — o passo que cria os
 *     leads que a roleta vai distribuir não tinha contraprova nenhuma.
 *
 *   · a DUPLICATA é recusada na prévia. Reimportar a mesma exportação do Leadfy
 *     criava todos os leads de novo e mandava dois corretores ao mesmo cliente.
 */
import { expect } from "@playwright/test";
import { test, db, aguardarCarregamento, runTag } from "../support/fixtures";

/**
 * Assinatura OLE2 de um Excel 97-2003 — os oito bytes por onde o parser
 * reconhece o formato antigo. O resto é enchimento: a decisão sai do cabeçalho.
 */
const XLS_LEGADO = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(56),
]);

/**
 * Telefone único por execução: a prévia agora marca como repetida a linha cujo
 * telefone já existe no banco, então um número fixo faria o teste depender do
 * que sobrou de execuções anteriores.
 */
const fone = (n: number) => `11${String(Date.now()).slice(-7)}${String(n).padStart(2, "0")}`;

const csv = (linhas: string[]) => Buffer.from(linhas.join("\n"), "utf8");

async function abrirImportacao(page: import("@playwright/test").Page) {
  await page.goto("/leads");
  await aguardarCarregamento(page);
  await page.getByRole("button", { name: /importar planilha/i }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/importar leads \(csv\/xlsx\)/i)).toBeVisible();
  return dialogo;
}

test.describe("leads · importar planilha", () => {
  test("o .xls antigo é recusado com instrução na tela, não com 'formato não reconhecido'", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    // O seletor aceita `.xls` de propósito: filtrar o arquivo na janela do
    // sistema esconderia o motivo da recusa em vez de explicá-lo.
    const entrada = dialogo.locator('input[type="file"]');
    await expect(entrada).toHaveAttribute("accept", ".csv,.xlsx,.xls");

    await entrada.setInputFiles({
      name: "leads-antigos.xls",
      mimeType: "application/vnd.ms-excel",
      buffer: XLS_LEGADO,
    });

    await expect(dialogo.getByText(
      "Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx ou CSV.",
    )).toBeVisible();

    // E a recusa é mesmo uma recusa: nada de prévia, nada para importar.
    await expect(dialogo.getByRole("button", { name: /importar 0 leads/i })).toBeDisabled();
    await expect(dialogo.getByRole("table")).toHaveCount(0);
  });

  test("contraprova: um CSV válido é lido, mostra a prévia e diz de qual coluna sai cada campo", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    // Sem esta metade, o teste acima passaria também se o dropzone estivesse
    // quebrado e recusasse tudo.
    await dialogo.locator('input[type="file"]').setInputFiles({
      name: "leads-teste.csv",
      mimeType: "text/csv",
      buffer: csv(["Cliente,Telefone,E-mail", `Ana Importada,${fone(1)},ana@example.invalid`]),
    });

    await expect(dialogo.getByText(/1 leads/i).first()).toBeVisible();
    await expect(dialogo.getByRole("cell", { name: "Ana Importada" })).toBeVisible();
    await expect(dialogo.getByText(/formato antigo/i)).toHaveCount(0);
    // O mapa de colunas: a prévia repete a planilha crua, e sem ele o e-mail
    // indo para o nome só aparecia depois de gravado.
    await expect(dialogo.getByText("Nome → Cliente")).toBeVisible();
    await expect(dialogo.getByText("Telefone → Telefone")).toBeVisible();
    await expect(dialogo.getByText("E-mail → E-mail")).toBeVisible();

    // Sai sem importar: este arquivo não pode virar lead no banco compartilhado.
    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(dialogo).toBeHidden();
  });

  test("linha sem nome é descartada na prévia em vez de derrubar a importação", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    /**
     * Data na primeira coluna e uma linha sem nome: o caso que derrubava o lote
     * inteiro. O filtro aceitava a linha por `row[0]` e gravava `full_name`
     * vazio, e o CHECK do banco recusava a importação toda sem dizer qual linha.
     */
    await dialogo.locator('input[type="file"]').setInputFiles({
      name: "leads-com-buraco.csv",
      mimeType: "text/csv",
      buffer: csv([
        "Data,Cliente,Telefone",
        `12/08/2026,Bia Importada,${fone(2)}`,
        `13/08/2026,,${fone(3)}`,
      ]),
    });

    // "1 leads serão importados de 2 linhas": a diferença é a linha descartada.
    await expect(dialogo.getByText(/1 leads/i).first()).toBeVisible();
    await expect(dialogo.getByText(/de 2 linhas/i)).toBeVisible();
    await expect(dialogo.getByRole("button", { name: /importar 1 leads/i })).toBeEnabled();

    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(dialogo).toBeHidden();
  });

  /**
   * O separador do Excel em português.
   *
   * O Excel pt-BR salva CSV com `;` — é o separador de lista do Windows. Com a
   * vírgula fixa a linha inteira virava UMA coluna, todas as linhas eram
   * descartadas e a tela dizia "0 leads serão importados" sem motivo nenhum:
   * o caminho mais comum de planilha do cliente era exatamente o que não
   * funcionava.
   */
  test("CSV salvo pelo Excel em português (ponto e vírgula) é lido como planilha", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    await dialogo.locator('input[type="file"]').setInputFiles({
      name: "leads-excel-ptbr.csv",
      mimeType: "text/csv",
      buffer: csv([
        "Cliente;Telefone;E-mail",
        `Ana do Excel;${fone(6)};ana.excel@example.invalid`,
        `Bruno do Excel;${fone(7)};bruno.excel@example.invalid`,
      ]),
    });

    await expect(dialogo.getByText(/2 leads/i).first()).toBeVisible();
    await expect(dialogo.getByRole("cell", { name: "Ana do Excel" })).toBeVisible();
    await expect(dialogo.getByText("Nome → Cliente")).toBeVisible();
    await expect(dialogo.getByText("Telefone → Telefone")).toBeVisible();

    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(dialogo).toBeHidden();
  });

  test("planilha de uma coluna só explica o motivo em vez de dizer '0 leads'", async ({ page }) => {
    const dialogo = await abrirImportacao(page);

    // Arquivo de texto colado sem separador nenhum: 0 leads é o resultado
    // correto, mas sem o motivo o usuário só vê o botão apagado.
    await dialogo.locator('input[type="file"]').setInputFiles({
      name: "colado-do-bloco-de-notas.csv",
      mimeType: "text/csv",
      buffer: csv(["Cliente Telefone", `Ana Sem Separador ${fone(8)}`]),
    });

    // A frase inteira, não a palavra: a prévia repete a planilha CRUA, e a
    // linha de teste se chama "Ana Sem Separador" — `/separador/i` casava a
    // explicação e a célula, e o strict mode derrubava o teste. Os dois textos
    // estão certos na tela; quem estava frouxo era o seletor.
    await expect(dialogo.getByText(/CSV salvo com outro separador/i)).toBeVisible();
    await expect(dialogo.getByRole("button", { name: /importar 0 leads/i })).toBeDisabled();

    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
  });

  /**
   * O grupo de distribuição do lote.
   *
   * Sem o seletor, tudo caía na Fila Geral e os outros grupos configurados eram
   * inalcançáveis por planilha — não havia como importar uma lista de um
   * empreendimento para a fila desse empreendimento.
   */
  test("o grupo escolhido no diálogo é o grupo do lead importado", async ({ page }) => {
    const [grupo] = await db.select<{ id: string; name: string }>(
      "distribution_groups?active=eq.true&kind=neq.general&select=id,name&order=name&limit=1",
    );
    test.skip(!grupo, "o catálogo não tem grupo específico para escolher");

    const tag = runTag();
    try {
      const dialogo = await abrirImportacao(page);

      await dialogo.getByLabel(/grupo de distribuição/i).click();
      await page.getByRole("option", { name: grupo.name }).click();

      await dialogo.locator('input[type="file"]').setInputFiles({
        name: "leads-do-grupo.csv",
        mimeType: "text/csv",
        buffer: csv(["Cliente,Telefone,Observação", `Carla do Grupo ${tag},${fone(9)},${tag}`]),
      });

      await dialogo.getByRole("button", { name: /importar 1 leads/i }).click();
      await expect(page.getByText(/1 leads importados/i)).toBeVisible();

      await expect(async () => {
        const [lead] = await db.select<{ distribution_group_id: string | null }>(
          `leads?notes=eq.${tag}&select=distribution_group_id`,
        );
        expect(lead?.distribution_group_id, "o lead entra na fila escolhida").toBe(grupo.id);
      }).toPass({ timeout: 10_000 });
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });

  test("importa de verdade, e reimportar a mesma planilha não duplica o lead", async ({ page }) => {
    const tag = runTag();
    const planilha = csv([
      "Cliente,Telefone,Observação",
      `Ana Importada ${tag},${fone(4)},${tag}`,
      `Bruno Importado ${tag},${fone(5)},${tag}`,
    ]);

    try {
      const dialogo = await abrirImportacao(page);
      await dialogo.locator('input[type="file"]').setInputFiles({
        name: "leads-novos.csv", mimeType: "text/csv", buffer: planilha,
      });
      await dialogo.getByRole("button", { name: /importar 2 leads/i }).click();

      // O toast só pode aparecer depois de o banco ter as duas linhas.
      await expect(page.getByText(/2 leads importados/i)).toBeVisible();
      await expect(async () => {
        const gravados = await db.select<{ status: string }>(
          `leads?notes=eq.${tag}&select=status,full_name`,
        );
        expect(gravados).toHaveLength(2);
        // Lead importado entra na fila da roleta — quem distribui é o banco.
        // Se a roleta já o pegou, ele sai de `queued` legitimamente.
        expect(gravados.every((l) => ["queued", "assigned"].includes(l.status))).toBe(true);
      }).toPass({ timeout: 10_000 });

      // Segunda passada com o MESMO arquivo: as duas linhas são repetidas.
      const segunda = await abrirImportacao(page);
      await segunda.locator('input[type="file"]').setInputFiles({
        name: "leads-novos.csv", mimeType: "text/csv", buffer: planilha,
      });
      await expect(segunda.getByText(/2 linha\(s\) com telefone já cadastrado/i)).toBeVisible();
      await expect(segunda.getByRole("button", { name: /importar 0 leads/i })).toBeDisabled();
      await segunda.getByRole("button", { name: /^cancelar$/i }).click();

      const depois = await db.select(`leads?notes=eq.${tag}&select=id`);
      expect(depois, "reimportar não pode criar lead novo").toHaveLength(2);
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });
});

/**
 * Saúde da roleta com a distribuição PAUSADA.
 *
 * `assign_lead` devolve null antes de olhar a fila quando
 * `automation_settings.leads_paused` está ligado. O card mostrava "N pronto(s)"
 * e o botão respondia "ninguém com check-in aberto dentro do horário": quem
 * tinha pausado a roleta em Admin era mandado procurar ponto de corretor. É a
 * única causa que a tela pode antecipar sem chamar o banco — e por isso o botão
 * some do caminho em vez de falhar depois do clique.
 */
test.describe("leads · saúde da roleta", () => {
  const religar = () => db.update("automation_settings?id=eq.true", { leads_paused: false });

  test.afterEach(religar);

  test("distribuição pausada: o card diz onde religar e o botão Distribuir não engana", async ({ page }) => {
    const tag = runTag();
    // Pausar ANTES de criar o lead: com a roleta ligada o próprio insert já o
    // entrega a alguém e ele não chega a esperar na fila.
    await db.update("automation_settings?id=eq.true", { leads_paused: true });

    try {
      await db.insert("leads", {
        full_name: `Lead parado ${tag}`,
        phone: `11${String(Date.now()).slice(-9)}`,
        notes: tag,
      });

      await page.goto("/leads");
      await aguardarCarregamento(page);

      await expect(page.getByText(/a distribuição está pausada/i)).toBeVisible();
      await expect(page.getByText(/automação de leads/i).first()).toBeVisible();

      const distribuir = page.getByRole("button", { name: /distribuir/i });
      expect(await distribuir.count(), "o lead recém-criado precisa estar esperando na fila")
        .toBeGreaterThan(0);
      await expect(distribuir.first()).toBeDisabled();

      // Contraprova: religada, a tela volta a oferecer a distribuição.
      await religar();
      await page.reload();
      await aguardarCarregamento(page);
      await expect(page.getByText(/a distribuição está pausada/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /distribuir/i }).first()).toBeEnabled();
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });
});


/**
 * A bandeja "sem atendimento".
 *
 * Havia leads no catálogo com 23 entregas e 22 prazos vencidos: a roleta girava
 * em falso e ninguém era avisado. Com o teto da 0074 o lead PARA — e parar em
 * `queued`, misturado com quem acabou de chegar, seria trocar um silêncio por
 * outro. A tela precisa separar os dois e continuar oferecendo a saída manual.
 */
test.describe("leads · lead sem atendimento", () => {
  test("lead que estourou o teto de voltas aparece separado, com as voltas na tela", async ({ page }) => {
    const tag = runTag();
    const [config] = await db.select<{ roulette_max_rounds: number }>(
      "automation_settings?id=eq.true&select=roulette_max_rounds",
    );
    test.skip(!config, "a 0074 precisa estar aplicada para este cenário existir");

    const teto = config.roulette_max_rounds;
    try {
      await db.insert("leads", {
        full_name: `Lead sem atendimento ${tag}`,
        phone: `11${String(Date.now()).slice(-9)}`,
        notes: tag,
        status: "queued",
        roulette_misses: teto,
      });

      await page.goto("/leads");
      await aguardarCarregamento(page);

      // O card de saúde da roleta separa quem espera a roleta de quem já rodou
      // o máximo — são dois problemas com conserto diferente.
      await expect(page.getByText(/sem atendimento \(/i).first()).toBeVisible();
      await expect(page.getByText(`${teto} voltas`).first()).toBeVisible();

      // E a linha do lead diz o mesmo, para quem chega pela lista.
      await page.getByPlaceholder(/buscar por nome/i).fill(`Lead sem atendimento ${tag}`);
      const linha = page.getByRole("row").filter({ hasText: tag });
      await expect(linha.getByText(/sem atendimento/i).first()).toBeVisible();
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });
});


/**
 * Cadastro manual, edição, realocação e exclusão.
 *
 * As quatro ações que só o gestor tem na tela de Leads (`leads_insert`,
 * `leads.reassign`, `leads.delete`) e que não tinham teste de tela nenhum —
 * o mesmo motivo pelo qual a importação mora neste arquivo. Cada passo é
 * conferido no banco: `updateLead` e `deleteLead` passaram a pedir a linha de
 * volta porque uma escrita recusada pela RLS casa 0 linhas e volta 204 sem
 * erro, e o toast dizia "salvo" com nada gravado.
 */
test.describe("leads · cadastro manual do gestor", () => {
  test("novo lead, editar, realocar e excluir — com o banco conferindo cada passo", async ({ page }) => {
    const tag = runTag();
    const nome = `Lead manual ${tag}`;
    const renomeado = `Lead manual renomeado ${tag}`;
    // Telefone e e-mail com formato de gente: é por eles que a busca da tela é
    // cobrada mais abaixo, e os dois têm armadilha própria — o banco normaliza
    // o telefone com DDI (`normalize_phone`) e o e-mail carrega pontos, que a
    // sanitização do termo chegou a remover.
    const digitos = `11${String(Date.now()).slice(-9)}`;
    const telefoneComMascara = `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
    const email = `manual.${tag}@exemplo.com.br`;
    const brokerId = await db.profileIdOf("broker");
    const [corretor] = await db.select<{ full_name: string }>(
      `profiles?id=eq.${brokerId}&select=full_name`,
    );

    try {
      await page.goto("/leads");
      await aguardarCarregamento(page);

      // 1. Novo lead: nasce na fila, sem corretor — quem distribui é a roleta.
      //
      // Nome EXATO, não `/novo lead/i`: a base de homologação tem um lead
      // chamado "novo lead teste", e cada linha da lista publica o nome do
      // cliente em seis controles ("Editar X", "Realocar X", "Converter X em
      // negócio"…). Os nomes acessíveis da tela são todos distintos — quem
      // casava sete elementos era a expressão por substring, não a tela.
      await page.getByRole("button", { name: "Novo lead", exact: true }).click();
      const formulario = page.getByRole("dialog").filter({ hasText: /novo lead/i });
      await formulario.getByLabel(/^nome \*$/i).fill(nome);
      await formulario.getByLabel(/telefone/i).fill(digitos);
      await formulario.getByLabel(/^e-mail$/i).fill(email);
      await formulario.getByLabel(/observações/i).fill(tag);
      await formulario.getByRole("button", { name: /criar lead/i }).click();
      await expect(page.getByText(/lead criado/i)).toBeVisible();

      let leadId = "";
      await expect(async () => {
        const [lead] = await db.select<{ id: string; status: string }>(
          `leads?notes=eq.${tag}&select=id,status`,
        );
        expect(lead, "o lead criado na tela precisa existir no banco").toBeTruthy();
        leadId = lead.id;
      }).toPass({ timeout: 10_000 });

      // 1b. A busca do rodapé cumpre o que promete.
      //
      // O termo vai ao BANCO (a lista trunca em 1.000 linhas), e são justamente
      // os dois formatos naturais que quebravam: o telefone digitado com
      // máscara — que o banco grava normalizado com DDI — e o e-mail inteiro,
      // porque a sanitização trocava o ponto por espaço e "…@exemplo.com.br"
      // virava um termo que não casa com e-mail nenhum.
      const busca = page.getByPlaceholder(/buscar por nome/i);
      for (const termo of [telefoneComMascara, email]) {
        await busca.fill(termo);
        await expect(
          page.getByRole("row").filter({ hasText: nome }).getByRole("button", { name: nome, exact: true }),
          `buscar por "${termo}" precisa achar o lead`,
        ).toBeVisible({ timeout: 15_000 });
      }

      // 2. Editar: o toast só vale depois de a linha mudar no banco.
      await page.getByPlaceholder(/buscar por nome/i).fill(nome);
      const linha = page.getByRole("row").filter({ hasText: nome });
      await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();
      await linha.getByRole("button", { name: `Editar ${nome}` }).click();
      const edicao = page.getByRole("dialog").filter({ hasText: /editar lead/i });
      await edicao.getByLabel(/^nome \*$/i).fill(renomeado);
      await edicao.getByRole("button", { name: /^salvar$/i }).click();
      await expect(page.getByText(/lead atualizado/i)).toBeVisible();

      await expect(async () => {
        const [lead] = await db.select<{ full_name: string }>(`leads?id=eq.${leadId}&select=full_name`);
        expect(lead.full_name).toBe(renomeado);
      }).toPass({ timeout: 10_000 });

      // 3. Realocar: põe o lead na mão de um corretor e reinicia a trava.
      await page.getByPlaceholder(/buscar por nome/i).fill(renomeado);
      const linhaNova = page.getByRole("row").filter({ hasText: renomeado });
      await expect(linhaNova.getByRole("button", { name: renomeado, exact: true })).toBeVisible();
      await linhaNova.getByRole("button", { name: `Realocar ${renomeado}` }).click();
      const realocacao = page.getByRole("dialog").filter({ hasText: /realocar lead/i });
      await realocacao.getByLabel(/^corretor$/i).click();
      await page.getByRole("option", { name: new RegExp(`^${corretor.full_name}`) }).click();
      await realocacao.getByRole("button", { name: /^realocar$/i }).click();
      await expect(page.getByText(/lead realocado/i)).toBeVisible();

      await expect(async () => {
        const [lead] = await db.select<{ assigned_to: string; attend_deadline: string | null }>(
          `leads?id=eq.${leadId}&select=assigned_to,attend_deadline`,
        );
        expect(lead.assigned_to, "o lead vai para o corretor escolhido").toBe(brokerId);
        expect(lead.attend_deadline, "realocar reinicia a trava de atendimento").not.toBeNull();
      }).toPass({ timeout: 10_000 });

      // 4. Excluir: destrutivo, confirmado por nome, e conferido no banco.
      await linhaNova.getByRole("button", { name: `Excluir ${renomeado}` }).click();
      const confirmacao = page.getByRole("alertdialog");
      await expect(confirmacao.getByText(new RegExp(`excluir ${renomeado}`, "i"))).toBeVisible();
      await confirmacao.getByRole("button", { name: /excluir lead/i }).click();
      await expect(page.getByText(/lead excluído/i)).toBeVisible();

      await expect(async () => {
        const restou = await db.select(`leads?id=eq.${leadId}&select=id`);
        expect(restou, "excluir precisa apagar a linha, não só a linha da tela").toHaveLength(0);
      }).toPass({ timeout: 10_000 });
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });
});
