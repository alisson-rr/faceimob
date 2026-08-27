import { test, expect, db, runTag } from "../support/fixtures";
import { abrirPipelineFiltrado, criarNegocio, limparCenario } from "../matriz/cenario";

/**
 * `can_enter_stage`: mover um card para uma etapa negada tem de FALHAR na tela
 * com motivo legível e NÃO mexer no banco.
 *
 * A matriz semeada já nega "Aprovado" ao corretor (`stage_permissions` só tem
 * linha de broker para incomplete/lead/proposal/visita/análise/perdido). Testar
 * com a matriz de verdade em vez de mexer nela evita brigar com os outros
 * agentes que compartilham este banco.
 */
const tag = runTag();
let negocio: { id: string; cliente: string };
let etapaProposta: string;
let etapaAprovado: string;
let etapaVisita: string;

test.beforeAll(async () => {
  negocio = await criarNegocio(tag, "ETAPA", await db.profileIdOf("broker"));
  [{ id: etapaProposta }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.proposal&select=id",
  );
  [{ id: etapaAprovado }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.approved&select=id",
  );
  [{ id: etapaVisita }] = await db.select<{ id: string }>(
    "pipeline_stages?code=eq.visit_scheduled&select=id",
  );
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test.describe("corretor · matriz de etapas", () => {
  test("a matriz realmente nega 'Aprovado' ao corretor", async () => {
    const linhas = await db.select<{ can_enter: boolean }>(
      `stage_permissions?role=eq.broker&stage_id=eq.${etapaAprovado}&select=can_enter`,
    );
    // Sem linha = negado (o default do banco é "ninguém além de admin entra").
    expect(linhas.every((l) => !l.can_enter)).toBe(true);
  });

  test("arrastar para uma etapa negada avisa e não muda o estágio no banco", async ({ page }) => {
    await abrirPipelineFiltrado(page, tag);

    // A alternância tabela/kanban ganhou nome acessível na Tarefa H (achado
    // X03): dá para pedir pelo papel, em vez de ancorar na classe do ícone.
    await page.getByRole("button", { name: /ver em kanban/i }).click();

    const card = page.getByText(negocio.cliente, { exact: true });
    await expect(card).toBeVisible();

    // A coluna do kanban é uma div sem papel acessível; o gancho estável é a
    // largura fixa do container que carrega os handlers de drop.
    const colunaAprovado = page.locator("div.w-60").filter({ hasText: "Aprovado" });
    await expect(colunaAprovado).toHaveCount(1);

    await card.dispatchEvent("dragstart");
    await colunaAprovado.dispatchEvent("drop");

    await expect(page.getByText(/movimentação não permitida/i)).toBeVisible();

    // O que separa teste útil de teatro: o banco não pode ter mudado.
    await expect(async () => {
      const [linha] = await db.select<{ stage_id: string }>(
        `deals?id=eq.${negocio.id}&select=stage_id`,
      );
      expect(linha.stage_id).toBe(etapaProposta);
    }).toPass({ timeout: 5_000 });
  });

  // Contraprova: sem ela, um card que nunca se move faria o teste acima passar
  // por motivo errado. "Visita Agendada" é permitida ao corretor e não exige
  // documento — as etapas com `requires_document` teriam outro motivo de recusa.
  test("arrastar para uma etapa permitida move o card e grava", async ({ page }) => {
    await abrirPipelineFiltrado(page, tag);
    await page.getByRole("button", { name: /ver em kanban/i }).click();

    const card = page.getByText(negocio.cliente, { exact: true });
    await expect(card).toBeVisible();

    const colunaVisita = page.locator("div.w-60").filter({ hasText: "Visita Agendada" });
    await card.dispatchEvent("dragstart");
    await colunaVisita.dispatchEvent("drop");

    await expect(async () => {
      const [linha] = await db.select<{ stage_id: string }>(
        `deals?id=eq.${negocio.id}&select=stage_id`,
      );
      expect(linha.stage_id).toBe(etapaVisita);
    }).toPass({ timeout: 10_000 });
  });
});
