import type { Page } from "@playwright/test";
import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { criarCenario, limparCenario, type Cenario } from "../cca/esteira";

/** Faixa da agenda: o `SectionCard` é um <section> cujo <h2> é o nome da faixa. */
const faixa = (page: Page, nome: string) =>
  page.locator("section", { has: page.getByRole("heading", { name: nome, exact: true }) });

/**
 * "Atividade vencida" (CONTEXT.md): compromisso que o corretor marcou para si
 * dentro do negócio e cuja data passou. A tela existe para alguém ver que
 * venceu — e para concluir dali mesmo, sem reabrir o negócio.
 */
test.describe.serial("corretor · atividades", () => {
  let cenario: Cenario;
  let brokerId = "";
  let vencida = "";
  let futura = "";

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    cenario = await criarCenario({ dono: "broker", apelido: "Atividades" });
    vencida = `Ligar de volta ${cenario.tag}`;
    futura = `Visita ao decorado ${cenario.tag}`;
    await db.insert("tasks", [
      {
        title: vencida,
        assigned_to: brokerId,
        created_by: brokerId,
        due_at: "2020-01-01T10:00:00Z",
        ref_type: "deal",
        ref_id: cenario.dealId,
      },
      {
        title: futura,
        assigned_to: brokerId,
        created_by: brokerId,
        due_at: "2030-01-01T10:00:00Z",
        ref_type: "deal",
        ref_id: cenario.dealId,
      },
    ]);
  });

  test.afterAll(async () => {
    // `tasks.ref_id` não tem FK: apagar o negócio não leva as atividades junto.
    await db.remove(`tasks?ref_type=eq.deal&ref_id=eq.${cenario.dealId}`);
    await limparCenario(cenario);
  });

  test("a vencida aparece em Atrasadas e a futura em Depois", async ({ page }) => {
    await page.goto("/atividades");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { level: 1, name: "Atividades" })).toBeVisible();
    await expect(faixa(page, "Atrasadas").getByText(vencida, { exact: true })).toBeVisible();
    await expect(faixa(page, "Depois").getByText(futura, { exact: true })).toBeVisible();
  });

  test("Concluir grava status=done e tira a atividade da lista", async ({ page }) => {
    await page.goto("/atividades");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: `Concluir ${vencida}` }).click();

    await expect.poll(async () => {
      const [row] = await db.select<{ status: string; completed_at: string | null }>(
        `tasks?ref_id=eq.${cenario.dealId}&title=eq.${encodeURIComponent(vencida)}&select=status,completed_at`,
      );
      return row;
    }).toMatchObject({ status: "done", completed_at: expect.any(String) });

    await expect(page.getByText(vencida, { exact: true })).toHaveCount(0);
    await expect(faixa(page, "Depois").getByText(futura, { exact: true })).toBeVisible();
  });
});
