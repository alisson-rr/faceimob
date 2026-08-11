/**
 * Módulo SDR IA — CRUD de agentes e playground, na visão do papel `sdr`.
 *
 * A ata de 14/07 pede "um grupo especial para SDR atendido por IA" que qualifica
 * o lead antes de devolvê-lo à roleta. O agente é a peça configurável desse
 * fluxo: se a tela diz "Agente salvo" e `sdr_agents` não muda, a configuração da
 * IA é decorativa. Por isso toda asserção de gravação termina no banco.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();

type AgenteRow = {
  id: string;
  name: string;
  role: string;
  model: string;
  temperature: number;
  system_prompt: string | null;
  active: boolean;
};

const porNome = (nome: string) =>
  db.select<AgenteRow>(
    `sdr_agents?name=eq.${encodeURIComponent(nome)}&select=id,name,role,model,temperature,system_prompt,active`,
  );

/** A linha da lista de agentes não tem papel acessível próprio (é um `div`
 *  clicável) e o botão de excluir é só um ícone sem nome — por isso o filtro
 *  pelo texto do nome. Ver achado de acessibilidade no relatório. */
const linhaDoAgente = (page: import("@playwright/test").Page, nome: string) =>
  page.getByRole("tabpanel").locator("div.border.rounded-md").filter({ hasText: nome });

test.afterAll(async () => {
  await db.remove(`sdr_agents?name=like.*${tag}*`);
});

test.describe("SDR · agentes", () => {
  test("cria agente pela tela e grava em sdr_agents", async ({ page }) => {
    const nome = `Qualificador ${tag}`;
    const prompt = "Pergunte renda, urgência, cidade e FGTS. Nunca prometa aprovação.";

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByRole("button", { name: /novo/i }).click();
    await painel.getByPlaceholder(/Orquestrador Face/).fill(nome);
    await painel.getByPlaceholder(/Você é um SDR da Faceimob/).fill(prompt);
    await painel.locator('input[type="number"]').fill("0.3");
    await painel.getByRole("button", { name: /^salvar$/i }).click();

    await expect(page.getByText(/agente salvo/i)).toBeVisible();
    await expect(painel.getByText(nome, { exact: true })).toBeVisible();

    // O que importa: virou linha no banco com a configuração que foi digitada.
    const [gravado] = await porNome(nome);
    expect(gravado, "agente não chegou em sdr_agents").toBeTruthy();
    expect(gravado.system_prompt).toBe(prompt);
    expect(Number(gravado.temperature)).toBe(0.3);
    expect(gravado.role).toBe("qualifier");
    expect(gravado.active).toBe(true);
  });

  test("edita agente existente e a alteração persiste", async ({ page }) => {
    const nome = `Reengajador ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "reengager", system_prompt: "antes" });

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByText(nome, { exact: true }).click();
    await expect(painel.getByRole("heading", { name: /editar agente/i })).toBeVisible();

    await painel.getByPlaceholder(/Você é um SDR da Faceimob/).fill("depois da edição");
    await painel.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/agente salvo/i)).toBeVisible();

    await expect(async () => {
      const [gravado] = await porNome(nome);
      expect(gravado.system_prompt).toBe("depois da edição");
    }).toPass({ timeout: 10_000 });
  });

  test("exclui agente e ele some de sdr_agents", async ({ page }) => {
    const nome = `Descartável ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "custom" });

    page.on("dialog", (d) => void d.accept());
    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const linha = linhaDoAgente(page, nome);
    await expect(linha).toBeVisible();
    await linha.getByRole("button").click();

    await expect(linha).toHaveCount(0);
    expect(await porNome(nome)).toHaveLength(0);
  });

  // Era defeito: `<SelectItem value="">Nenhum` derrubava o editor de agente
  // inteiro (o Radix recusa valor vazio, que é o valor de "limpar seleção"), e
  // com isso encadear agentes — o orquestrador multi-agente da ata — não
  // existia pela tela. Corrigido com o sentinela `SEM_SELECAO`.
  test("permite escolher o agente de handoff sem quebrar a tela", async ({ page }) => {
    const nome = `Com handoff ${tag}`;
    await db.insert("sdr_agents", { name: nome, role: "qualifier" });

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    await painel.getByText(nome, { exact: true }).click();
    await painel.getByRole("combobox").filter({ hasText: /nenhum/i }).click();
    await expect(page.getByRole("option", { name: "Orquestrador FACEIMOB" })).toBeVisible();
  });
});

test.describe("SDR · playground", () => {
  // A edge function responde 5xx sem a credencial: é o cenário. O que se cobra é
  // que a tela avise e continue utilizável.
  test.use({ errosEsperados: [/status of 5\d\d/i] });

  test("sem chave da OpenAI o chat avisa o erro e a tela continua de pé", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /playground/i }).click();

    const painel = page.getByRole("tabpanel");
    // Enter envia (onKeyDown do input): o botão é só ícone, sem nome acessível.
    await painel.getByPlaceholder(/Simule o lead/).fill("Quero um apartamento de 2 quartos");
    await painel.getByPlaceholder(/Simule o lead/).press("Enter");

    // "Apareceu um aviso" é o comportamento em teste; o texto exato do aviso é
    // cobrado no caso seguinte. O sonner não expõe papel próprio no toast.
    await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 20_000 });
    await expect(painel.getByText(/agente pensando/i)).toBeHidden();
    // A mensagem do usuário continua no log e o campo volta a aceitar texto.
    await expect(painel.getByText("Quero um apartamento de 2 quartos")).toBeVisible();
    await expect(painel.getByPlaceholder(/Simule o lead/)).toBeEnabled();
  });

  // Regressão: a tela extrai o corpo da FunctionsHttpError para dizer qual
  // credencial falta, em vez de mostrar apenas o erro genérico do SDK.
  test("o aviso diz qual credencial falta", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /playground/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByPlaceholder(/Simule o lead/).fill("oi");
    await painel.getByPlaceholder(/Simule o lead/).press("Enter");

    await expect(page.getByText(/credencial|openai|integrações/i)).toBeVisible({ timeout: 20_000 });
  });

  // Mesma causa do handoff, mesma correção: o seletor "Automático
  // (orquestrador)" também usava valor vazio.
  test("permite escolher o agente inicial da simulação", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /playground/i }).click();

    await page.getByRole("tabpanel").getByRole("combobox").click();
    await expect(page.getByRole("option", { name: /automático/i })).toBeVisible();
  });
});
