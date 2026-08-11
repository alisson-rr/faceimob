import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Mês fechado trava o negócio (ata de 14/07: "congelar os dados do período
 * anterior").
 *
 * A trava é o trigger `deals_guard_closed_month`, que abre exceção só para o
 * admin. O que este teste cobra é que a trava chega à tela como recusa legível
 * E que o banco não muda — a auditoria recente achou tela mostrando "salvo"
 * sem gravação, e o inverso (mostrar erro e gravar assim mesmo) é pior ainda.
 *
 * O controle positivo em mês aberto não é enfeite: sem ele, "não salvou" seria
 * verdade por qualquer motivo — permissão, campo obrigatório, rota errada — e
 * o teste não provaria nada sobre fechamento de mês.
 */
const tag = runTag();
const MES_FECHADO_ISO = "2026-09-01";
const VGV_ORIGINAL = 400000;
const VGV_NOVO = 777000;

let negocioAberto: { id: string; cliente: string };
let negocioFechado: { id: string; cliente: string };

async function criarNegocio(rotulo: string, mesIso: string) {
  const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.proposal&select=id");
  const [construtora] = await db.select<{ id: string }>("developers?select=id&limit=1");
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    developer_id: construtora?.id ?? null,
    month_base: mesIso,
    vgv_gross: VGV_ORIGINAL,
    notes: tag,
  });
  const cliente = `${rotulo}-${tag}`;
  await db.insert("deal_clients", { deal_id: deal.id, ordinal: 1, full_name: cliente });
  // O trigger de autofill puxa gerente e diretor da equipe do corretor.
  await db.insert("deal_participants", {
    deal_id: deal.id,
    profile_id: await db.profileIdOf("broker"),
    role: "broker",
  });
  return { id: deal.id, cliente };
}

test.beforeAll(async () => {
  const jaFechado = await db.select(`closed_months?period=eq.${MES_FECHADO_ISO}&select=period`);
  if (jaFechado.length) {
    throw new Error(`09/2026 já está fechado — outro teste não limpou; reabra antes de rodar`);
  }

  // O negócio nasce ANTES do fechamento: o próprio trigger impede criar
  // negócio em mês já fechado, então a ordem aqui não é opcional.
  negocioAberto = await criarNegocio("ABERTO", "2026-08-01");
  negocioFechado = await criarNegocio("FECHADO", MES_FECHADO_ISO);

  await db.insert("closed_months", {
    period: MES_FECHADO_ISO,
    notes: `fechado pelo teste ${tag}`,
  });
});

test.afterAll(async () => {
  await db.remove(`closed_months?period=eq.${MES_FECHADO_ISO}`);
  await db.remove(`deals?notes=eq.${tag}`);
});

async function abrirNegocio(page: Page, cliente: string) {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);
  await page.getByPlaceholder(/buscar cliente/i).fill(cliente);
  await page.getByText(new RegExp(cliente, "i")).first().click();
  await expect(page.getByRole("button", { name: /confirmar alterações/i })).toBeVisible();
}

const vgvGravado = async (id: string) => {
  const [linha] = await db.select<{ vgv_gross: string }>(`deals?id=eq.${id}&select=vgv_gross`);
  return Number(linha.vgv_gross);
};

test.describe("corretor · mês fechado", () => {
  test("em mês aberto a edição do próprio negócio é gravada", async ({ page }) => {
    await abrirNegocio(page, negocioAberto.cliente);

    await page.getByPlaceholder("Inserir VGV Bruto").fill(String(VGV_NOVO));
    await page.getByRole("button", { name: /confirmar alterações/i }).click();

    await expect(page.getByText(/alterações salvas/i)).toBeVisible();
    await expect.poll(() => vgvGravado(negocioAberto.id)).toBe(VGV_NOVO);
  });

  // A recusa do mês fechado vem como 400 do banco: o console registrar isso é a
  // trava funcionando.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 400/i] });

  test("em mês fechado a edição é recusada e o banco não muda", async ({ page }) => {
    await abrirNegocio(page, negocioFechado.cliente);

    await page.getByPlaceholder("Inserir VGV Bruto").fill(String(VGV_NOVO));
    await page.getByRole("button", { name: /confirmar alterações/i }).click();

    // Mensagem de gente, com o mês e o que fazer a respeito.
    await expect(page.getByText(/está fechado/i)).toBeVisible();
    await expect(page.getByText(/administrador/i).first()).toBeVisible();

    expect(await vgvGravado(negocioFechado.id)).toBe(VGV_ORIGINAL);
  });

  });
});
