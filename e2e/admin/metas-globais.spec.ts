import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Meta global cadastrada PELA TELA.
 *
 * `dashboard-meta.spec.ts` insere a linha em `goals` pelo banco e confere o
 * medidor; aqui é o contrário: o admin preenche o cartão "Meta global do mês"
 * em /equipes e o banco é que confere. Toast verde sem linha gravada é a tela
 * mentindo — por isso a asserção final é sempre `db.select`.
 *
 * Mês escolhido: 12/2099, longe de qualquer meta real da homologação. A linha
 * de `goals` não influencia o seletor de mês do Dashboard (que sai de deals e
 * closed_months), então um mês futuro aqui não muda o padrão de ninguém.
 */
type Meta = { id: string; target: number };

const tag = runTag();
const MES = "2099-12";
const ISO = "2099-12-01";
// Único por execução e com centavos: prova que o decimal do VGV chega inteiro
// ao numeric(14,2). Os dígitos vêm do runTag para não repetir entre execuções.
const VGV = 1_000_000 + (parseInt(tag.replace(/\D/g, "").slice(-6), 10) || 0) + 0.37;

const metaGravada = (metric: "sales" | "vgv") =>
  db.select<Meta>(`goals?scope=eq.global&period_type=eq.month&period=eq.${ISO}&metric=eq.${metric}&select=id,target`);

const formulario = (page: Page) => page.getByRole("form", { name: "Meta global do mês" });

async function abrirCartaoDoMes(page: Page) {
  await page.goto("/equipes");
  await aguardarCarregamento(page);
  await page.getByLabel("Mês", { exact: true }).fill(MES);
  // O campo fica desabilitado enquanto a meta do mês carrega; "Cadastrado:"
  // preenchido é o sinal de que o formulário já reflete 12/2099.
  await expect(formulario(page).getByText(/^Cadastrado: /).first()).not.toContainText("…");
}

test.beforeAll(async () => {
  const sobra = await metaGravada("vgv");
  if (sobra.length) throw new Error(`já existe meta global de VGV para ${MES}; sobrou de uma execução interrompida — apague e rode de novo`);
});

test.afterAll(async () => {
  await db.remove(`goals?scope=eq.global&period_type=eq.month&period=eq.${ISO}&metric=in.(sales,vgv)`);
});

test.describe("equipes · meta global do mês", () => {
  test("admin preenche o VGV do mês e a linha aparece em goals com scope global", async ({ page }) => {
    await abrirCartaoDoMes(page);
    const form = formulario(page);
    const salvar = form.getByRole("button", { name: "Salvar" });

    // Sem nada digitado não há o que salvar.
    await expect(salvar).toBeDisabled();
    await expect(form.getByText("Cadastrado: —").first()).toBeVisible();

    await form.getByLabel("VGV (R$)").fill(String(VGV));
    await expect(salvar).toBeEnabled();
    await salvar.click();

    await expect(page.getByText("Meta global salva")).toBeVisible();

    const linhas = await metaGravada("vgv");
    expect(linhas, "toast de sucesso sem linha gravada é tela mentindo").toHaveLength(1);
    expect(Number(linhas[0].target)).toBeCloseTo(VGV, 2);
    // Só o campo alterado grava: vendas continua sem meta.
    expect(await metaGravada("sales")).toHaveLength(0);
  });

  test("salvar de novo atualiza a mesma linha em vez de duplicar", async ({ page }) => {
    // Índice único de scope global é parcial e o PostgREST não faz upsert nele;
    // o caminho é select + update, e este é o caso que provaria uma duplicata.
    await abrirCartaoDoMes(page);
    const form = formulario(page);
    await expect(form.getByText(`Cadastrado: R$ ${VGV.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`)).toBeVisible();

    await form.getByLabel("VGV (R$)").fill(String(VGV + 1));
    await form.getByLabel("Vendas (quantidade)").fill("7");
    await form.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText("Meta global salva")).toBeVisible();

    const vgv = await metaGravada("vgv");
    expect(vgv).toHaveLength(1);
    expect(Number(vgv[0].target)).toBeCloseTo(VGV + 1, 2);
    const vendas = await metaGravada("sales");
    expect(vendas).toHaveLength(1);
    expect(Number(vendas[0].target)).toBe(7);
  });

  test("meta negativa não habilita o botão nem chega ao banco", async ({ page }) => {
    await abrirCartaoDoMes(page);
    const form = formulario(page);

    const campo = form.getByLabel("VGV (R$)");
    await campo.fill("-5");
    await expect(campo).toHaveAttribute("aria-invalid", "true");
    // Botão desabilitado sozinho não explica nada: o motivo é escrito e ligado
    // ao campo por aria-describedby, para quem vê e para quem ouve.
    await expect(form.getByText("Use um número maior ou igual a zero")).toBeVisible();
    await expect(campo).toHaveAccessibleDescription(/maior ou igual a zero/);
    await expect(form.getByRole("button", { name: "Salvar" })).toBeDisabled();

    const [linha] = await metaGravada("vgv");
    expect(Number(linha.target), "valor inválido não pode ter sobrescrito a meta").toBeCloseTo(VGV + 1, 2);
  });

  test("mês apagado avisa por escrito e trava o Salvar", async ({ page }) => {
    await abrirCartaoDoMes(page);
    const mes = page.getByLabel("Mês", { exact: true });

    await mes.fill("");
    await expect(mes).toHaveAttribute("aria-invalid", "true");
    await expect(mes).toHaveAccessibleDescription("Informe um mês válido");
    await expect(formulario(page).getByRole("button", { name: "Salvar" })).toBeDisabled();
  });
});
