/**
 * Módulo SDR IA — abas "Origens" e "WhatsApp", na visão do papel `sdr`.
 *
 * A ata de 14/07 amarra origem do lead → agente que atende → template de
 * boas-vindas ("o sistema dispara um template de WhatsApp para o lead
 * recém-chegado"). No banco isso são as colunas `lead_sources.sdr_agent_id` e
 * `lead_sources.welcome_template_id` (migration 0008).
 *
 * O SDR cadastra a origem e vincula agente/template existente. Alterar o texto
 * aprovado do template continua restrito a admin/marketing.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();

type OrigemRow = {
  id: string;
  code: string;
  label: string;
  sdr_agent_id: string | null;
  welcome_template_id: string | null;
};

const origensComRotulo = (rotulo: string) =>
  db.select<OrigemRow>(
    `lead_sources?label=eq.${encodeURIComponent(rotulo)}&select=id,code,label,sdr_agent_id,welcome_template_id`,
  );

test.afterAll(async () => {
  await db.remove(`lead_sources?label=like.*${tag}*`);
});

test.describe("SDR · origens de lead", () => {
  test("mostra as origens do banco com o agente já vinculado", async ({ page }) => {
    const doBanco = await db.select<OrigemRow>(
      "lead_sources?select=id,code,label,sdr_agent_id,welcome_template_id&order=created_at",
    );
    const comAgente = doBanco.find((o) => o.sdr_agent_id);
    expect(comAgente, "seed sem origem vinculada a agente — cenário incompleto").toBeTruthy();

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    for (const origem of doBanco) {
      await expect(painel.getByText(origem.label, { exact: true })).toBeVisible();
    }

    // Não é lista decorativa: o agente exibido é o que está gravado na coluna.
    const [agente] = await db.select<{ name: string }>(
      `sdr_agents?id=eq.${comAgente!.sdr_agent_id}&select=name`,
    );
    await expect(
      painel.locator("div.border.rounded").filter({ hasText: comAgente!.label }),
    ).toContainText(agente.name);
  });

  test("SDR cadastra uma origem simples", async ({ page }) => {
    const rotulo = `Origem ${tag}`;

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByPlaceholder("Rótulo").fill(rotulo);
    await painel.getByPlaceholder(/form_id/).fill(`form-${tag}`);
    await painel.getByRole("button", { name: /adicionar/i }).click();

    await expect(async () => {
      expect(await origensComRotulo(rotulo)).toHaveLength(1);
    }).toPass({ timeout: 10_000 });
    await expect(painel.getByText(rotulo, { exact: true })).toBeVisible();
  });

  // Regressão da 0031: o vínculo completo precisa sobreviver à gravação real.
  test("vincula agente e template de boas-vindas a uma origem", async ({ page }) => {
    const rotulo = `Origem ${tag} vinculada`;
    const [agente] = await db.select<{ id: string; name: string }>(
      "sdr_agents?select=id,name&limit=1",
    );
    const [template] = await db.select<{ id: string; name: string }>(
      "whatsapp_templates?select=id,name&limit=1",
    );

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /origens/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByPlaceholder("Rótulo").fill(rotulo);
    await painel.getByRole("combobox").filter({ hasText: /agente/i }).click();
    await page.getByRole("option", { name: agente.name }).click();
    await painel.getByRole("combobox").filter({ hasText: /template/i }).click();
    await page.getByRole("option", { name: template.name }).click();
    await painel.getByRole("button", { name: /adicionar/i }).click();

    await expect(async () => {
      const [gravada] = await origensComRotulo(rotulo);
      expect(gravada.sdr_agent_id).toBe(agente.id);
      expect(gravada.welcome_template_id).toBe(template.id);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe("SDR · template de WhatsApp", () => {
  type TemplateRow = { id: string; name: string; body: string };
  let antes: TemplateRow;

  test.beforeAll(async () => {
    [antes] = await db.select<TemplateRow>(
      "whatsapp_templates?select=id,name,body&order=created_at&limit=1",
    );
  });

  // Rede de segurança: se a RLS falhar e o corpo for mesmo alterado, o teste
  // acusa E o seed volta ao original para os outros agentes.
  test.afterAll(async () => {
    if (antes) await db.update(`whatsapp_templates?id=eq.${antes.id}`, { body: antes.body });
  });

  test("papel sem permissão não altera o template gravado", async ({ page }) => {
    expect(antes, "seed sem template de WhatsApp — cenário incompleto").toBeTruthy();

    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    await expect(painel.getByRole("textbox").first()).toHaveValue(antes.name);
    await painel.getByRole("textbox").last().fill(`corpo alterado por ${tag}`);
    await painel.getByRole("button", { name: /^salvar$/i }).click();

    // A RLS (`admin`,`marketing`) tem que segurar: o corpo do template não muda.
    await expect(async () => {
      const [depois] = await db.select<{ body: string }>(
        `whatsapp_templates?id=eq.${antes.id}&select=body`,
      );
      expect(depois.body).toBe(antes.body);
    }).toPass({ timeout: 10_000 });
  });

  // UPDATE barrado pelo `using` da RLS casa zero linhas e volta 204. A tela pede
  // representação e trata zero linhas como recusa, nunca como falso "salvo".
  test("não diz 'Configuração salva' quando o banco não gravou", async ({ page }) => {
    await page.goto("/sdr");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /whatsapp/i }).click();

    const painel = page.getByRole("tabpanel");
    await painel.getByRole("textbox").last().fill(`tentativa ${tag}`);
    await painel.getByRole("button", { name: /^salvar$/i }).click();

    await expect(page.getByText(/configuração salva/i)).toHaveCount(0);
  });
});
