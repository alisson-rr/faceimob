/**
 * Dados (/data) na visão do papel `marketing`.
 *
 * As duas caixas de upload eram decorativas: recebiam o arquivo, diziam
 * "carregado" e o descartavam — a do Leadfy ainda mandava procurar um botão
 * que não existia em /leads. O que se prova aqui: o Leadfy abre o diálogo de
 * importação de verdade, e a planilha de aportes tem prévia, separa a linha
 * ruim da boa, mostra o valor que vai substituir e não apaga a nota quando a
 * planilha não traz a coluna.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();

type AporteRow = { id: string; developer_id: string; period: string; amount: number; notes: string | null };

const csv = (linhas: string[]) => Buffer.from(linhas.join("\n"), "utf8");

const aportesDe = (developerId: string) =>
  db.select<AporteRow>(
    `marketing_investments?developer_id=eq.${developerId}&select=id,developer_id,period,amount,notes`,
  );

test.afterAll(async () => {
  await db.remove(`marketing_investments?notes=like.*${tag}*`);
  await db.remove(`developers?name=like.*${tag}*`);
});

test.describe("Marketing · Dados", () => {
  test("a caixa do Leadfy abre o diálogo de importação, sem mandar para outra tela", async ({ page }) => {
    await page.goto("/data");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: /gestão de dados/i, level: 1 })).toBeVisible();

    await page.getByRole("button", { name: /importar planilha/i }).click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText(/importar leads \(csv\/xlsx\)/i)).toBeVisible();
    await expect(dialogo.locator('input[type="file"]')).toHaveAttribute("accept", ".csv,.xlsx,.xls");
  });

  /**
   * O card "Formato esperado" prometia `Empreendimento` e `Status`, que o
   * importador ignora em silêncio: quem montasse a planilha com essas colunas
   * perdia as duas sem aviso nenhum. Agora a lista sai de `COLUMN_LABELS`, a
   * MESMA fonte que o parser usa para casar cabeçalho — escrever a lista à mão
   * é o que deixou as duas versões se afastarem.
   */
  test("o card de formato lista só as colunas que o importador lê, e avisa do resto", async ({ page }) => {
    await page.goto("/data");
    await aguardarCarregamento(page);

    const card = page.getByText(/colunas lidas:/i);
    await expect(card).toBeVisible();
    for (const coluna of ["Nome", "Telefone", "E-mail", "Origem", "Observação"]) {
      await expect(card).toContainText(coluna);
    }
    // O que ele NÃO lê não pode aparecer como promessa.
    await expect(card).not.toContainText("Empreendimento");
    await expect(card).not.toContainText("Status");
    await expect(page.getByText(/é .*ignorada/i)).toBeVisible();
  });

  /**
   * O `.xls` (Excel 97-2003) é recusado pelo parser desde a troca de biblioteca:
   * oferecê-lo no seletor era convidar para o arquivo que a tela vai negar.
   */
  test("o seletor de planilha de aportes não oferece o .xls que o parser recusa", async ({ page }) => {
    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    await expect(page.locator('input[type="file"]')).toHaveAttribute("accept", ".csv,.xlsx");
    await expect(page.getByText(/\.xls antigo não é lido/i)).toBeVisible();
  });

  /**
   * Antes era tudo-ou-nada: uma linha ruim travava as boas. Agora a prévia
   * separa as duas e o botão importa só o que dá para importar — e o banco
   * recebe UMA linha, não duas.
   */
  test("planilha de aportes: recusa a linha ruim, importa a boa e grava em reais", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Planilha ${tag}`,
      slug: `construtora-planilha-${tag}`,
    });

    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    const arquivo = page.locator('input[type="file"]');
    await arquivo.setInputFiles({
      name: "aportes.csv",
      mimeType: "text/csv",
      buffer: csv([
        "Mês,Construtora,Valor,Nota",
        `07/2026,${construtora.name},"7.500,00",planilha ${tag}`,
        `07/2026,Construtora Inexistente ${tag},100,planilha ${tag}`,
      ]),
    });

    await expect(page.getByText("construtora não cadastrada")).toBeVisible();
    await page.getByRole("button", { name: /importar 1 válida/i }).click();
    await expect(page.getByText(/1 aporte importado/i)).toBeVisible({ timeout: 15_000 });

    const gravados = await aportesDe(construtora.id);
    expect(gravados, "só a linha válida podia entrar").toHaveLength(1);
    expect(Number(gravados[0].amount)).toBe(7500);
    expect(gravados[0].period).toBe("2026-07-01");
    expect(gravados[0].notes).toContain(tag);

    // A lista do mês escolhido mostra o que acabou de entrar.
    await page.getByLabel("Mês", { exact: true }).fill("2026-07");
    await expect(page.getByRole("row").filter({ hasText: construtora.name })).toContainText("R$ 7.500");
  });

  /**
   * O caminho que APAGAVA: reimportar sem a coluna Nota gravava `notes = null`
   * por cima. O upsert só sobrescreve coluna enviada, então a nota sobrevive —
   * e a prévia mostra o valor antigo que vai ser substituído.
   */
  test("reimportar sem a coluna Nota substitui o valor e preserva a nota", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Nota ${tag}`,
      slug: `construtora-nota-${tag}`,
    });
    await db.insert("marketing_investments", {
      developer_id: construtora.id,
      period: "2026-05-01",
      amount: 1000,
      notes: `nota original ${tag}`,
    });

    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    await page.locator('input[type="file"]').setInputFiles({
      name: "aportes-sem-nota.csv",
      mimeType: "text/csv",
      buffer: csv(["Mês,Construtora,Valor", `05/2026,${construtora.name},3000`]),
    });

    // A prévia deixa de prometer substituição no vazio: mostra o valor antigo.
    const linha = page.getByRole("row").filter({ hasText: construtora.name });
    await expect(linha).toContainText("R$ 1.000,00");
    await expect(page.getByText("substitui", { exact: true })).toBeVisible();
    await expect(page.getByText(/nota já gravada é preservada/i)).toBeVisible();

    await page.getByRole("button", { name: /importar 1 aporte$/i }).click();
    await expect(page.getByText(/1 aporte importado/i)).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      const linhas = await aportesDe(construtora.id);
      expect(linhas).toHaveLength(1);
      expect(Number(linhas[0].amount)).toBe(3000);
      expect(linhas[0].notes, "a nota foi apagada pela planilha sem a coluna").toBe(`nota original ${tag}`);
    }).toPass({ timeout: 10_000 });
  });

  /**
   * O caminho que APAGAVA pelo formulário: `/data` mandava `notes` em todo
   * salvamento, então salvar de novo com o campo Nota em branco — o estado
   * normal do formulário vazio — gravava `notes = null` por cima da nota já
   * lançada, com toast de sucesso. A mesma regra que a importação já respeitava
   * ao omitir a coluna tinha dois comportamentos dentro do mesmo arquivo.
   */
  test("salvar com a Nota em branco preserva a nota gravada; Editar é quem a troca", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Preserva ${tag}`,
      slug: `construtora-preserva-${tag}`,
    });
    await db.insert("marketing_investments", {
      developer_id: construtora.id,
      period: "2026-04-01",
      amount: 1000,
      notes: `nota do banco ${tag}`,
    });

    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();
    await page.getByLabel("Mês", { exact: true }).fill("2026-04");
    await expect(page.getByRole("row").filter({ hasText: construtora.name })).toBeVisible();

    // Formulário vazio, sem Editar: corrige o VALOR e não toca na nota.
    await page.getByLabel("Valor do aporte").fill("2000");
    await page.getByLabel("Construtora", { exact: true }).click();
    await page.getByRole("option", { name: construtora.name }).click();
    await page.getByRole("button", { name: /salvar aporte/i }).click();

    await expect(async () => {
      const [linha] = await aportesDe(construtora.id);
      expect(Number(linha.amount)).toBe(2000);
      expect(linha.notes, "salvar com o campo em branco apagou a nota já gravada").toBe(`nota do banco ${tag}`);
    }).toPass({ timeout: 10_000 });

    // Editar traz a linha inteira para o formulário — só assim o branco vira
    // ordem explícita de apagar, e corrigir não obriga a redigitar a nota.
    await page.getByRole("button", { name: `Editar aporte de ${construtora.name}` }).click();
    await expect(page.getByLabel("Nota do aporte")).toHaveValue(`nota do banco ${tag}`);
    await page.getByLabel("Nota do aporte").fill("");
    await page.getByRole("button", { name: /salvar aporte/i }).click();

    await expect(async () => {
      const [linha] = await aportesDe(construtora.id);
      expect(Number(linha.amount)).toBe(2000);
      expect(linha.notes).toBeNull();
    }).toPass({ timeout: 10_000 });

    // A limpeza global filtra por `notes like tag`, e esta linha ficou sem nota:
    // sem isto, a FK RESTRICT impediria de remover a construtora do teste.
    await db.remove(`marketing_investments?developer_id=eq.${construtora.id}`);
  });

  // O formulário de /data não tinha campo Nota e o popup de /marketing tinha:
  // a mesma regra com duas interfaces diferentes.
  test("o formulário de aporte grava a nota, como o popup de /marketing", async ({ page }) => {
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Form ${tag}`,
      slug: `construtora-form-${tag}`,
    });

    await page.goto("/data");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Marketing" }).click();

    await page.getByLabel("Valor do aporte").fill("4200");
    await page.getByLabel("Construtora", { exact: true }).click();
    await page.getByRole("option", { name: construtora.name }).click();
    await page.getByLabel("Nota do aporte").fill(`nota do form ${tag}`);
    await page.getByRole("button", { name: /salvar aporte/i }).click();

    await expect(async () => {
      const [gravado] = await aportesDe(construtora.id);
      expect(gravado).toBeTruthy();
      expect(Number(gravado.amount)).toBe(4200);
      expect(gravado.notes).toBe(`nota do form ${tag}`);
    }).toPass({ timeout: 10_000 });
  });
});
