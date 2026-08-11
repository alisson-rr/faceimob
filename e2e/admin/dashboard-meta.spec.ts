import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Meta do Dashboard.
 *
 * Decisão de 08/08 (`docs/sprints/decisoes.md`): a meta global sai de `goals`
 * (`scope='global'`, `period_type='month'`, `metric='sales'`) e a tela mostra
 * "—" enquanto a linha não existir. Não há UI para cadastrar a meta global —
 * é pendência declarada —, então quem cria a linha aqui é o banco, de propósito.
 *
 * O ponto do teste é o "—": o medidor antigo trazia um alvo chumbado, e um
 * número inventado no lugar de "não sei" é pior do que espaço em branco, porque
 * a diretoria decide em cima dele.
 *
 * Mês escolhido: 01/2026 é passado, está aberto e não tem meta no seed. Usar um
 * mês futuro faria `pickOpenMonth` mudar o padrão do dashboard de todo mundo.
 */
const tag = runTag();
const MES = "01/2026";
const ISO = "2026-01-01";
const META = 4;

let negocioId: string;
let adminId: string;

test.beforeAll(async () => {
  adminId = await db.profileIdOf("admin");

  const jaTem = await db.select(
    `goals?scope=eq.global&period_type=eq.month&period=eq.${ISO}&metric=eq.sales&select=id`,
  );
  if (jaTem.length) throw new Error(`já existe meta global de vendas para ${MES}; o cenário do teste supõe que não`);

  const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.closed&select=id");
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    month_base: ISO,
    outcome: "won",
    closed_at: new Date().toISOString(),
    vgv_gross: 500000,
    status_detail: "VENDA",
    notes: tag,
  });
  negocioId = deal.id;
  await db.insert("deal_clients", { deal_id: negocioId, ordinal: 1, full_name: `META-${tag}` });
});

test.afterAll(async () => {
  await db.remove(`goals?scope=eq.global&period_type=eq.month&period=eq.${ISO}&metric=eq.sales`);
  await db.remove(`deals?notes=eq.${tag}`);
});

/** Valor do cartão de KPI: o rótulo e o número são irmãos, sem rótulo acessível. */
const valorDoKpi = (page: Page, rotulo: string) =>
  page.getByText(rotulo, { exact: true }).locator("xpath=../following-sibling::p[1]");

async function abrirMetasDe(page: Page, mes: string) {
  await page.goto("/dashboard");
  await aguardarCarregamento(page);

  // A barra do topo tem o seu próprio combobox ("Pré-visualizar como papel"):
  // o seletor de mês é o que mostra MM/AAAA.
  const seletorDeMes = page.getByRole("combobox").filter({ hasText: /\d{2}\/\d{4}/ });
  await seletorDeMes.click();
  await page.getByRole("option", { name: new RegExp(`^${mes.replace("/", "\\/")}`) }).click();
  await expect(seletorDeMes).toContainText(mes);

  await page.getByRole("button", { name: "Metas", exact: true }).click();
}

test.describe("dashboard · meta mensal", () => {
  test("sem linha em goals o medidor mostra '—', não um alvo inventado", async ({ page }) => {
    await abrirMetasDe(page, MES);

    await expect(page.getByText("Sem meta cadastrada para o período")).toBeVisible();
    await expect(page.getByText("—", { exact: true }).first()).toBeVisible();
    await expect(valorDoKpi(page, "Meta")).toHaveText("—");
  });

  test("cadastrada a meta em goals, o medidor passa a usá-la", async ({ page }) => {
    await db.insert("goals", {
      scope: "global",
      period_type: "month",
      period: ISO,
      metric: "sales",
      target: META,
      created_by: adminId,
    });

    await abrirMetasDe(page, MES);

    // Uma venda no mês contra a meta de quatro: 25%.
    await expect(page.getByText(`1 de ${META} vendas`)).toBeVisible();
    // O medidor aparece no cartão e no KPI; o KPI é a asserção precisa.
    await expect(valorDoKpi(page, "Meta")).toHaveText("25%");
  });
});
