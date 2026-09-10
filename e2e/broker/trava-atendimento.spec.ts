/**
 * Trava de atendimento (ata de 14/07): o lead atribuído tem prazo, e "Atender"
 * congela o lead com o corretor.
 *
 * Dois pontos que só um teste de ponta a ponta pega:
 *   · o cronômetro precisa CORRER na tela — um rótulo estático não avisa o
 *     corretor de que ele está prestes a perder o lead;
 *   · "Atender" precisa gravar. `claim_lead` zera `attend_deadline` e marca
 *     `responded_at` na atribuição; sem conferir no banco, um toast de sucesso
 *     esconderia um lead que continua correndo contra o relógio.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

type Lead = {
  id: string;
  status: string;
  funnel_stage: string;
  attend_deadline: string | null;
  first_contact_at: string | null;
  next_action_at: string | null;
  converted_deal_id: string | null;
};

/**
 * Linha do lead na tabela.
 *
 * Tudo aqui é cobrado DENTRO da linha, e não na página inteira, porque a tela
 * tem um segundo lugar que fala de trava: o popup `NewLeadNotifier`, com o
 * próprio cronômetro e o próprio botão "Atender agora".
 */
const linhaDoLead = (page: import("@playwright/test").Page, nome: string) =>
  page.getByRole("row").filter({ hasText: nome });

test.describe("trava de atendimento de 5 minutos", () => {
  const tag = runTag();
  const nome = `Lead trava ${tag}`;
  let brokerId = "";
  let grupoId = "";
  let leadId = "";

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    const grupos = await db.select<{ id: string }>(
      "distribution_groups?kind=eq.general&active=eq.true&select=id&limit=1",
    );
    expect(grupos, "o catálogo precisa de um grupo de distribuição geral").toHaveLength(1);
    grupoId = grupos[0].id;
  });

  test.beforeEach(async () => {
    /**
     * Tira o corretor da roleta antes de montar o cenário.
     *
     * **Causa medida do flaky** (era o par de testes que falhava só na execução
     * completa): a cada 30 s `release_expired_leads()` devolve à fila o lead de
     * QUALQUER pessoa cujo prazo estourou e chama `assign_lead()`, que entrega o
     * lead a quem estiver na `distribution_queue`. Se o corretor E2E ficou com
     * presença aberta de um spec anterior, ele é candidato — e o lead que cai
     * para ele abre o popup `NewLeadNotifier` por cima da tela de Leads.
     *
     * O popup é um `Dialog` do Radix: enquanto está aberto, o resto da página
     * fica `aria-hidden`. Medido com a tela aberta e o popup em cima: o botão do
     * lead na linha some da árvore de acessibilidade (0 por papel, 1 por texto),
     * e o único botão que casa `/atender/i` passa a ser o "Atender agora" do
     * popup — de outro lead. O teste não perdia o lead; perdia a página.
     *
     * `distribution_queue` exige `checked_out_at is null`; fechar a presença
     * fecha a porta. Não é mascarar defeito: o popup é comportamento pedido na
     * ata de 23/07, e este cenário é sobre a trava, não sobre a roleta.
     */
    await db.update(
      `checkins?profile_id=eq.${brokerId}&checked_out_at=is.null`,
      { checked_out_at: new Date().toISOString() },
    );

    // Estado exatamente igual ao que `assign_lead` produz: status 'assigned',
    // prazo aberto e uma atribuição em aberto na roleta.
    const prazo = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const [lead] = await db.insert<{ id: string }>("leads", {
      full_name: nome,
      phone: "11988887777",
      notes: tag,
      status: "assigned",
      assigned_to: brokerId,
      assigned_at: new Date().toISOString(),
      attend_deadline: prazo,
      distribution_group_id: grupoId,
    });
    leadId = lead.id;
    await db.insert("lead_assignments", {
      lead_id: leadId,
      profile_id: brokerId,
      group_id: grupoId,
      deadline: prazo,
    });
  });

  test.afterEach(async () => {
    // Cascata leva atribuições e eventos junto.
    await db.remove(`leads?notes=eq.${tag}`);
  });

  // O nome do cliente deixou de ser um cabeçalho e virou o BOTÃO que abre o
  // histórico do lead (achado X06, Tarefa G): a linha inteira clicável não era
  // alcançável por teclado.
  test("lead atribuído mostra contagem regressiva correndo", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);

    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();
    await expect(linha.getByText("Aguardando atendimento")).toBeVisible();

    // O selo é "<ícone> 04:59": há um espaço antes do número, e casar por
    // expressão regular não normaliza espaço como o casamento por texto faz.
    const cronometro = linha.getByText(/^\s*0[0-5]:[0-5]\d\s*$/);
    await expect(cronometro).toBeVisible();
    const inicial = await cronometro.textContent();
    // A tela redesenha a cada segundo enquanto houver trava correndo.
    await expect(cronometro).not.toHaveText(inicial!, { timeout: 10_000 });
  });

  test("atender trava o lead com o corretor e para o cronômetro", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();

    await linha.getByRole("button", { name: /^atender$/i }).click();
    await expect(page.getByText(/lead em atendimento/i)).toBeVisible();

    // Persistência: é o banco que define se o lead está travado.
    await expect(async () => {
      const [lead] = await db.select<Lead>(
        `leads?id=eq.${leadId}&select=id,status,attend_deadline,first_contact_at`,
      );
      expect(lead.status).toBe("attending");
      expect(lead.attend_deadline, "claim_lead zera o prazo: o lead é do corretor").toBeNull();
      expect(lead.first_contact_at, "assumir o lead marca o primeiro contato").not.toBeNull();
    }).toPass({ timeout: 10_000 });

    const [atribuicao] = await db.select<{ responded_at: string | null }>(
      `lead_assignments?lead_id=eq.${leadId}&select=responded_at`,
    );
    expect(atribuicao.responded_at, "a atribuição na roleta registra a resposta").not.toBeNull();

    // E a linha do lead para de cobrar o prazo.
    await expect(linha.getByText(/^\s*0[0-5]:[0-5]\d\s*$/)).toHaveCount(0);
    await expect(linha.getByRole("button", { name: /^atender$/i })).toHaveCount(0);
  });

  /**
   * A próxima ação é o que faz o lead "atrasar" (`overdue_lead_count`) e o que
   * bloqueia o check-in em 20 atrasados. Antes da 0056 ela só nascia de uma
   * tarefa com data na aba Agenda: quem nunca criava tarefa nunca era barrado,
   * e o bloqueio era opcional na prática.
   */
  test("atender faz nascer a próxima ação e a tela pede a data ao corretor", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();

    await linha.getByRole("button", { name: /^atender$/i }).click();
    await expect(page.getByText(/lead em atendimento/i)).toBeVisible();

    // 1. `claim_lead` já grava um padrão: sem ele, o lead atendido e esquecido
    //    nunca contaria como atrasado.
    let padrao = "";
    await expect(async () => {
      const [lead] = await db.select<Lead>(`leads?id=eq.${leadId}&select=id,status,next_action_at`);
      expect(lead.next_action_at, "atender sem data marcada deixa um prazo padrão").not.toBeNull();
      padrao = lead.next_action_at!;
    }).toPass({ timeout: 10_000 });

    // 2. E a tela pergunta ao corretor, que é quem sabe quando volta a falar
    //    com o cliente.
    const dialogo = page.getByRole("dialog").filter({ hasText: /próxima ação/i });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: /amanhã, 9h/i }).click();
    await dialogo.getByRole("button", { name: /^marcar$/i }).click();
    await expect(page.getByText(/próxima ação marcada/i)).toBeVisible();

    await expect(async () => {
      const [lead] = await db.select<Lead>(`leads?id=eq.${leadId}&select=id,status,next_action_at`);
      expect(lead.next_action_at, "a data escolhida substitui o padrão").not.toBe(padrao);
      const escolhida = new Date(lead.next_action_at!);
      expect(escolhida.getTime()).toBeGreaterThan(Date.now());
      expect(escolhida.getTime()).toBeLessThan(Date.now() + 48 * 60 * 60 * 1000);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * Conversão: o passo que cria o negócio, o rateio e a base da comissão. Não
   * tinha teste nenhum — nem unitário nem de tela.
   */
  test("converter cria o negócio com o cliente e o corretor no rateio", async ({ page }) => {
    const [construtora] = await db.select<{ id: string; name: string }>(
      "developers?active=eq.true&select=id,name&order=name&limit=1",
    );
    test.skip(!construtora, "nenhuma construtora ativa no catálogo: a conversão exige uma");

    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();
    await linha.getByRole("button", { name: /converter/i }).click();

    const dialogo = page.getByRole("dialog").filter({ hasText: /converter em negócio/i });
    // Quem vira o corretor do negócio — e portanto entra no rateio — aparece
    // antes do clique: `convert_lead_to_deal` usa `coalesce(assigned_to, auth.uid())`.
    await expect(dialogo.getByText(/corretor do negócio/i)).toBeVisible();

    await dialogo.getByRole("combobox").first().click();
    await page.getByRole("option", { name: construtora.name }).click();
    await dialogo.getByLabel(/vgv bruto/i).fill("500.000,00");
    await dialogo.getByRole("button", { name: /^converter$/i }).click();

    await expect(page.getByText(/lead convertido em negócio/i)).toBeVisible();

    let dealId = "";
    try {
      await expect(async () => {
        const [lead] = await db.select<Lead>(
          `leads?id=eq.${leadId}&select=id,status,converted_deal_id`,
        );
        expect(lead.status, "o lead sai da operação como convertido").toBe("converted");
        expect(lead.converted_deal_id, "o lead aponta para o negócio criado").not.toBeNull();
        dealId = lead.converted_deal_id!;
      }).toPass({ timeout: 15_000 });

      const [negocio] = await db.select<{ vgv_gross: string | null; developer_id: string }>(
        `deals?id=eq.${dealId}&select=vgv_gross,developer_id`,
      );
      expect(Number(negocio.vgv_gross), "o VGV digitado é o do negócio").toBe(500000);
      expect(negocio.developer_id).toBe(construtora.id);

      const clientes = await db.select<{ full_name: string }>(
        `deal_clients?deal_id=eq.${dealId}&select=full_name`,
      );
      expect(clientes.map((c) => c.full_name), "o cliente do negócio vem do lead").toContain(nome);

      const participantes = await db.select<{ profile_id: string; role: string }>(
        `deal_participants?deal_id=eq.${dealId}&select=profile_id,role`,
      );
      expect(
        participantes.some((p) => p.profile_id === brokerId && p.role === "broker"),
        "o corretor do lead entra no rateio como corretor",
      ).toBe(true);
    } finally {
      // O negócio leva clientes, participantes e histórico por cascata.
      if (dealId) await db.remove(`deals?id=eq.${dealId}`);
    }
  });

  test("o corretor não recebe as ações que o banco recusa para ele", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);

    // `leads_insert` não aceita corretor, `reassign_lead` exige leads.reassign e
    // `distribution_queue` de outro grupo exige leads.view_queue: os três
    // apareciam para qualquer papel e falhavam depois do clique.
    await expect(page.getByRole("button", { name: /importar planilha/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /novo lead/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /saúde da roleta/i })).toHaveCount(0);

    // E o KPI que era estruturalmente zero para ele dá lugar ao que é dele:
    // `leads_select` só mostra lead sem dono a quem tem leads.view_queue.
    await expect(page.getByText("Aguardando você", { exact: true })).toBeVisible();
    await expect(page.getByText("Na fila", { exact: true })).toHaveCount(0);

    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();
    await expect(linha.getByRole("button", { name: /^realocar/i })).toHaveCount(0);
    await expect(linha.getByRole("button", { name: /^excluir/i })).toHaveCount(0);
    // O que é dele continua na mão: o lead está atribuído a este corretor.
    await expect(linha.getByRole("button", { name: /^editar/i })).toHaveCount(1);
  });

  test("mover de etapa pelo detalhe só diz 'movido' depois de o banco gravar", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    await linhaDoLead(page, nome).getByRole("button", { name: nome, exact: true }).click();

    const modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "Lead Quente", exact: true }).click();
    await expect(page.getByText(/movido para lead quente/i)).toBeVisible();

    // `updateLead` passou a pedir a linha de volta: UPDATE que a RLS recusa
    // casa 0 linhas e vira erro, não toast de sucesso. Aqui o corretor é dono
    // do lead, então o toast tem que corresponder a uma linha gravada.
    await expect(async () => {
      const [lead] = await db.select<Lead>(`leads?id=eq.${leadId}&select=id,status,funnel_stage,attend_deadline,first_contact_at`);
      expect(lead.funnel_stage).toBe("hot");
    }).toPass({ timeout: 10_000 });
    const eventos = await db.select(`lead_events?lead_id=eq.${leadId}&kind=eq.stage_changed&to_value=eq.hot&select=id`);
    expect(eventos, "a troca de etapa entra no histórico do lead").toHaveLength(1);
  });

  /**
   * `next_action_at` tinha dois donos e o outro apagava.
   *
   * O gatilho `tasks_sync_lead_deadline` (0011) recalculava o campo a cada
   * tarefa e o ZERAVA quando não sobrava nenhuma aberta com data. Bastava o
   * corretor criar e concluir uma atividade para o prazo do lead sumir — junto
   * com ele, a contagem de atrasados e o bloqueio dos 20 no check-in. Só um
   * teste que passa pelas duas telas pega isso: a tarefa é criada na aba
   * Agenda do detalhe e o efeito aparece na coluna do lead.
   */
  test("concluir a atividade não apaga a próxima ação do lead", async ({ page }) => {
    const prazoDaTarefa = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    // `datetime-local` não tem fuso: o campo carrega a hora local do navegador,
    // que o Playwright fixa em America/Sao_Paulo.
    const noCampo = new Date(prazoDaTarefa.getTime() - prazoDaTarefa.getTimezoneOffset() * 60_000)
      .toISOString().slice(0, 16);
    const titulo = `Retornar ligação ${tag}`;

    /**
     * Envelhece a atribuição ANTES de abrir a tela.
     *
     * `NewLeadNotifier` anuncia "Lead atribuído a você!" em QUALQUER update de
     * um lead meu que chegue até 20 s depois de `assigned_at` (`isFresh`) — e
     * criar a atividade dispara um desses updates, porque
     * `tasks_sync_lead_deadline` reescreve `leads.next_action_at`. Medido no
     * trace da rodada: o popup abriu por cima do detalhe do lead e o overlay do
     * Dialog (modal do Radix) interceptou o clique em "Concluir" até o teste
     * estourar 45 s.
     *
     * Um corretor que está criando atividade num lead não o recebeu há 20
     * segundos: a atribuição envelhecida é o cenário REAL, e tira do caminho um
     * aviso que não é o que está sob teste. Anunciar como NOVA qualquer
     * alteração feita dentro da janela é defeito do próprio notificador, e o
     * conserto é em `src/components/NewLeadNotifier.tsx` — arquivo de outra
     * frente, então aqui fica só o registro.
     */
    await db.update(`leads?id=eq.${leadId}`, {
      assigned_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    await linhaDoLead(page, nome).getByRole("button", { name: nome, exact: true }).click();

    const modal = page.getByRole("dialog");
    await modal.getByRole("tab", { name: /agenda/i }).click();
    await modal.getByLabel("Título da atividade").fill(titulo);
    await modal.getByLabel("Prazo da atividade").fill(noCampo);
    await modal.getByRole("button", { name: /^criar$/i }).click();

    // A tarefa aberta É o prazo do lead: essa metade sempre funcionou.
    await expect(async () => {
      const [lead] = await db.select<Lead>(`leads?id=eq.${leadId}&select=id,next_action_at`);
      expect(lead.next_action_at, "tarefa com data manda na próxima ação").not.toBeNull();
    }).toPass({ timeout: 10_000 });

    await modal.getByRole("button", { name: `Concluir ${titulo}` }).click();

    // E agora a metade que apagava: sem tarefa aberta, o prazo continua.
    await expect(async () => {
      const [tarefa] = await db.select<{ status: string }>(
        `tasks?ref_id=eq.${leadId}&select=status`,
      );
      expect(tarefa?.status, "a conclusão precisa ter chegado ao banco").toBe("done");
      const [lead] = await db.select<Lead>(`leads?id=eq.${leadId}&select=id,next_action_at`);
      expect(lead.next_action_at, "concluir a tarefa não pode zerar o prazo do lead").not.toBeNull();
    }).toPass({ timeout: 10_000 });

    await db.remove(`tasks?ref_id=eq.${leadId}`);
  });

  /**
   * O lead que sai da mão do corretor com a tela aberta.
   *
   * O cronômetro chegava a 00:00 e a linha mudava sozinha quando o cron
   * passava, sem nada dizer que o lead tinha voltado para a fila: quem estava
   * em outra aba perdia o lead em silêncio. O toast existia e não tinha teste
   * nenhum — nem e2e nem unitário cobriam a expiração VISTA DA TELA.
   *
   * O cenário reproduz exatamente o que `release_expired_leads` faz (fecha a
   * atribuição por prazo e devolve o lead à fila), em vez de esperar os 30 s do
   * cron: o que está sob teste é a reação da tela, não o relógio do banco.
   */
  test("lead que vence com a tela aberta avisa que saiu da mão do corretor", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    await expect(linhaDoLead(page, nome).getByRole("button", { name: nome, exact: true }))
      .toBeVisible();

    /**
     * O lead sai da mão PRIMEIRO, a atribuição fecha DEPOIS.
     *
     * `release_expired_leads` faz as duas coisas na mesma transação, e quem
     * observa de fora só vê o estado final. Aqui são dois PATCH separados, e a
     * ordem decide o que a tela consegue enxergar: `leads_select` exige
     * `assigned_to` visível, então o UPDATE que devolve o lead à fila é
     * justamente o que o Realtime NÃO entrega a quem acabou de perdê-lo. Quem
     * chega é o de `lead_assignments` (o `profile_id` continua sendo dele) — e
     * ele precisa ser o último, para a recarga que ele provoca já encontrar o
     * lead fora da mão do corretor. Invertido, a tela recarregava cedo demais e
     * ficava sem nenhum outro evento para reagir.
     */
    await db.update(`leads?id=eq.${leadId}`, {
      status: "queued", assigned_to: null, assigned_at: null, attend_deadline: null,
    });
    await db.update(
      `lead_assignments?lead_id=eq.${leadId}&released_at=is.null`,
      { released_at: new Date().toISOString(), release_reason: "timeout" },
    );

    // O aviso precisa nomear o lead: "um lead saiu" sem dizer qual não serve
    // para quem tem doze na mão.
    await expect(page.getByText(/lead fora da sua mão/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(new RegExp(`${nome}.*voltou para a roleta`, "i"))).toBeVisible();
  });

  /**
   * Encerrar o lead como perdido — a saída que faltava.
   *
   * `next_action_at` vencido é o que conta em `overdue_lead_count` e trava o
   * check-in em 20 atrasados. Só reagendar ou converter tirava o lead da conta:
   * na prática o bloqueio era contornável por reagendamento infinito, e um lead
   * que nunca vai responder ficava atrasado para sempre.
   */
  test("encerrar o lead como perdido tira ele da contagem de atrasados", async ({ page }) => {
    await db.update(`leads?id=eq.${leadId}`, {
      status: "in_progress",
      next_action_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    const antes = await db.select(
      `leads?assigned_to=eq.${brokerId}&status=in.(assigned,attending,in_progress)` +
      `&next_action_at=lt.${new Date().toISOString()}&select=id`,
    );

    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();
    await linha.getByRole("button", { name: /^encerrar .* como perdido$/i }).click();

    const dialogo = page.getByRole("dialog").filter({ hasText: /encerrar lead/i });
    // Nada pré-selecionado: um clique distraído não pode gravar um motivo que
    // ninguém escolheu.
    await expect(dialogo.getByRole("button", { name: /^encerrar lead$/i })).toBeDisabled();

    await dialogo.getByLabel(/como encerrar/i).click();
    await page.getByRole("option", { name: /^Perdido/ }).click();
    await dialogo.getByLabel(/^motivo$/i).click();
    await page.getByRole("option", { name: "Sem interesse" }).click();
    await dialogo.getByRole("button", { name: /^encerrar lead$/i }).click();

    await expect(page.getByText(/lead marcado como perdido/i)).toBeVisible();

    // O toast só vale se o banco gravou: `close_lead` recusa por RLS e um
    // "encerrado" com o lead intacto seria pior que o erro.
    await expect(async () => {
      const [lead] = await db.select<Lead & { lost_reason: string | null }>(
        `leads?id=eq.${leadId}&select=id,status,next_action_at,lost_reason`,
      );
      expect(lead.status, "o lead encerrado sai da operação").toBe("lost");
      expect(lead.lost_reason, "o motivo fica gravado para o relatório").toBe("Sem interesse");
      expect(lead.next_action_at, "encerrado não tem próxima ação pendente").toBeNull();
    }).toPass({ timeout: 10_000 });

    const depois = await db.select(
      `leads?assigned_to=eq.${brokerId}&status=in.(assigned,attending,in_progress)` +
      `&next_action_at=lt.${new Date().toISOString()}&select=id`,
    );
    expect(depois.length, "encerrar tira uma unidade da conta que bloqueia o check-in")
      .toBe(antes.length - 1);

    // UMA linha de mudança de status, não duas. O gatilho `leads_log_changes`
    // (0005) já grava o `status_changed` de toda troca de status; enquanto
    // `close_lead` gravava o dele também, o histórico do lead mostrava a mesma
    // frase duplicada e o relatório "quantos perdemos por preço" — a razão de a
    // lista de motivos ser fixa — contava em dobro.
    const eventos = await db.select(
      `lead_events?lead_id=eq.${leadId}&kind=eq.status_changed&to_value=eq.lost&select=id`,
    );
    expect(eventos, "a perda entra no histórico UMA vez").toHaveLength(1);

    const encerramento = await db.select<{ detail: { reason?: string } | null }>(
      `lead_events?lead_id=eq.${leadId}&kind=eq.closed&select=detail`,
    );
    expect(encerramento, "o encerramento tem evento próprio").toHaveLength(1);
    expect(encerramento[0].detail?.reason, "e é ele que carrega o motivo")
      .toBe("Sem interesse");
  });

  test("próxima ação vencida marca o lead como atrasado na tela", async ({ page }) => {
    // Mesma definição de `overdue_lead_count`, que é o que trava o check-in em
    // 20 leads. Se a tela usasse outro critério, ela mentiria para o corretor.
    await db.update(`leads?id=eq.${leadId}`, {
      next_action_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);

    const linha = linhaDoLead(page, nome);
    await expect(linha.getByRole("button", { name: nome, exact: true })).toBeVisible();
    await expect(linha.getByText("Atrasado", { exact: true })).toBeVisible();

    const atrasadosNoBanco = await db.select(
      `leads?assigned_to=eq.${brokerId}&status=in.(assigned,attending,in_progress)&next_action_at=lt.${new Date().toISOString()}&select=id`,
    );
    expect(atrasadosNoBanco.length).toBeGreaterThan(0);
  });

  /**
   * A busca recorta a TABELA, não o panorama.
   *
   * O termo passou a ir ao banco, e os cards acima da lista — régua de KPIs,
   * atrasados, saúde da roleta — eram derivados da mesma consulta. Digitar três
   * letras sem correspondência fazia o card de atrasados virar o estado verde
   * "Tudo em dia · nada aqui bloqueia o seu check-in" para um corretor que está
   * atrasado — o oposto da verdade, no card que a tela de Check-in aponta como
   * o lugar de regularizar.
   */
  test("buscar não zera o card de leads atrasados", async ({ page }) => {
    await db.update(`leads?id=eq.${leadId}`, {
      status: "in_progress",
      next_action_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });

    await page.goto("/leads");
    await aguardarCarregamento(page);

    const cardAtrasados = page.getByText(/^Leads atrasados \(/);
    await expect(cardAtrasados).toBeVisible();
    const antes = await cardAtrasados.textContent();
    expect(antes, "o cenário precisa de pelo menos um atrasado").not.toMatch(/\(0\)/);

    // Termo que não casa com nada: o banco devolve lista vazia para a tabela.
    await page.getByPlaceholder(/buscar por nome/i).fill("zzzzznaoexistezzzzz");
    await expect(page.getByText(/nenhum lead com esses filtros/i)).toBeVisible();

    await expect(cardAtrasados, "o panorama não muda porque alguém digitou na busca")
      .toHaveText(antes ?? "");
    await expect(page.getByText(/nada aqui bloqueia o seu check-in/i)).toHaveCount(0);
  });
});
