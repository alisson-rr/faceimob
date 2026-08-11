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

  test("lead atribuído mostra contagem regressiva correndo", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);

    await expect(page.getByRole("heading", { name: nome })).toBeVisible();
    await expect(page.getByText("Aguardando atendimento")).toBeVisible();

    // O selo é "<ícone> 04:59": há um espaço antes do número, e casar por
    // expressão regular não normaliza espaço como o casamento por texto faz.
    const cronometro = page.getByText(/^\s*0[0-5]:[0-5]\d\s*$/);
    await expect(cronometro).toBeVisible();
    const inicial = await cronometro.textContent();
    // A tela redesenha a cada segundo enquanto houver trava correndo.
    await expect(cronometro).not.toHaveText(inicial!, { timeout: 10_000 });
  });

  test("atender trava o lead com o corretor e para o cronômetro", async ({ page }) => {
    await page.goto("/leads");
    await aguardarCarregamento(page);
    await page.getByPlaceholder(/buscar por nome/i).fill(nome);
    await expect(page.getByRole("heading", { name: nome })).toBeVisible();

    await page.getByRole("button", { name: /atender/i }).click();
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

    // E a tela para de cobrar o prazo.
    await expect(page.getByText(/^0[0-5]:[0-5]\d$/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^atender$/i })).toHaveCount(0);
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

    await expect(page.getByRole("heading", { name: nome })).toBeVisible();
    await expect(page.getByText("Atrasado", { exact: true })).toBeVisible();

    const atrasadosNoBanco = await db.select(
      `leads?assigned_to=eq.${brokerId}&status=in.(assigned,attending,in_progress)&next_action_at=lt.${new Date().toISOString()}&select=id`,
    );
    expect(atrasadosNoBanco.length).toBeGreaterThan(0);
  });
});
