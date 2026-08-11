/**
 * Aporte de marketing por construtora e mês — visão do papel `marketing`.
 *
 * Ata de 14/07: "o administrador seleciona a construtora e registra o valor
 * aportado mensalmente para monitorar entradas de recursos e custos". No banco
 * é `marketing_investments`, com `unique (developer_id, period)` e `period`
 * travado no primeiro dia do mês.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();

type AporteRow = { id: string; developer_id: string; period: string; amount: number; notes: string | null };

const inicioDoMes = () => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
};

const aportesDoMes = () =>
  db.select<AporteRow>(
    `marketing_investments?period=gte.${inicioDoMes()}&select=id,developer_id,period,amount,notes`,
  );

const emReais = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

test.afterAll(async () => {
  await db.remove(`marketing_investments?notes=like.*${tag}*`);
  await db.remove(`developers?name=like.*${tag}*`);
});

test.describe("Marketing · aportes", () => {
  test("o botão soma os aportes do mês exatamente como o banco", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const total = (await aportesDoMes()).reduce((s, r) => s + Number(r.amount), 0);
    await expect(page.getByRole("button", { name: /aporte/i })).toContainText(emReais(total));
  });

  test("o resumo por construtora reflete marketing_investments", async ({ page }) => {
    const linhas = await aportesDoMes();
    expect(linhas.length, "seed sem aporte no mês corrente — cenário incompleto").toBeGreaterThan(0);

    const construtoras = await db.select<{ id: string; name: string }>("developers?select=id,name");
    const porConstrutora = new Map<string, number>();
    for (const linha of linhas) {
      const nome = construtoras.find((d) => d.id === linha.developer_id)?.name ?? "Sem construtora";
      porConstrutora.set(nome, (porConstrutora.get(nome) ?? 0) + Number(linha.amount));
    }

    await page.goto("/marketing");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /aporte/i }).click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    for (const [nome, valor] of porConstrutora) {
      await expect(dialogo.getByText(nome, { exact: false }).first()).toBeVisible();
      await expect(dialogo).toContainText(emReais(valor));
    }
    // A lista detalhada tem uma linha por aporte do mês.
    await expect(dialogo.getByText(/nenhum aporte cadastrado/i)).toHaveCount(0);
  });

  // A interface usa a mesma decisão da RLS: admin e marketing editam; diretor
  // continua somente leitura.
  test("marketing registra aporte por construtora e mês", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora ${tag}`,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /aporte/i }).click();

    const dialogo = page.getByRole("dialog");
    await dialogo.getByPlaceholder("5000").fill("7300");
    await dialogo.getByRole("combobox").click();
    await page.getByRole("option", { name: construtora.name }).click();
    await dialogo.getByPlaceholder("opcional").fill(`aporte ${tag}`);
    await dialogo.getByRole("button", { name: /salvar/i }).click();

    await expect(async () => {
      const [gravado] = await db.select<AporteRow>(
        `marketing_investments?developer_id=eq.${construtora.id}&select=id,developer_id,period,amount,notes`,
      );
      expect(Number(gravado.amount)).toBe(7300);
      expect(gravado.period).toBe(inicioDoMes());
    }).toPass({ timeout: 10_000 });
  });
});
