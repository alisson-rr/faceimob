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

type Lead = { id: string; status: string; attend_deadline: string | null; first_contact_at: string | null };

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
});
