import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import {
  abaDoModal,
  abrirNegocio,
  criarCenario,
  limparCenario,
  type Cenario,
} from "../cca/esteira";

test.describe.serial("corretor · agenda e notificações persistentes", () => {
  let cenario: Cenario;
  let brokerId = "";

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    cenario = await criarCenario({ dono: "broker", apelido: "Agenda" });
  });

  test.afterAll(async () => {
    await db.remove(`tasks?ref_type=eq.deal&ref_id=eq.${cenario.dealId}`);
    await db.remove(`notifications?profile_id=eq.${brokerId}&kind=eq.e2e_agenda`);
    await limparCenario(cenario);
  });

  test("cria, conclui e mantém atividade e visita após recarregar", async ({ page }) => {
    const atividade = `Retornar ${cenario.tag}`;

    await abrirNegocio(page, cenario.cliente);
    await abaDoModal(page, /agenda/i).click();

    await page.getByLabel("Título da atividade").fill(atividade);
    await page.getByLabel("Prazo da atividade").fill("2020-01-01T10:00");
    await page.getByRole("button", { name: /^criar$/i }).click();

    await expect(page.getByText(atividade, { exact: true })).toBeVisible();
    await expect(page.getByText("1 vencida(s)", { exact: true })).toBeVisible();

    const [task] = await db.select<{ id: string; status: string; completed_at: string | null }>(
      `tasks?ref_type=eq.deal&ref_id=eq.${cenario.dealId}&title=eq.${encodeURIComponent(atividade)}&select=id,status,completed_at`,
    );
    expect(task, "a atividade criada pela tela precisa existir no banco").toBeTruthy();

    await page.getByRole("button", { name: `Concluir ${atividade}` }).click();
    await expect.poll(async () => {
      const [row] = await db.select<{ status: string; completed_at: string | null }>(
        `tasks?id=eq.${task.id}&select=status,completed_at`,
      );
      return row;
    }).toMatchObject({ status: "done", completed_at: expect.any(String) });

    await page.getByLabel("Data e hora da visita").fill("2030-01-15T14:30");
    await page.getByRole("button", { name: /^agendar$/i }).click();
    await expect(page.getByText("Agendada", { exact: true })).toBeVisible();

    await page.getByRole("combobox", { name: "Resultado da visita" }).click();
    await page.getByRole("option", { name: "Realizada" }).click();

    await expect.poll(async () => {
      const [row] = await db.select<{ result: string; performed_at: string | null }>(
        `visits?deal_id=eq.${cenario.dealId}&select=result,performed_at`,
      );
      return row;
    }).toMatchObject({ result: "completed", performed_at: expect.any(String) });

    await page.reload();
    await aguardarCarregamento(page);
    await abrirNegocio(page, cenario.cliente);
    await abaDoModal(page, /agenda/i).click();
    await expect(page.getByText(atividade, { exact: true })).toBeVisible();
    await expect(page.getByText("Realizada", { exact: true })).toBeVisible();
  });

  test("notificação aparece no sino e a leitura sobrevive ao reload", async ({ page }) => {
    const titulo = `Aviso ${cenario.tag}`;
    const [notification] = await db.insert<{ id: string }>("notifications", {
      profile_id: brokerId,
      kind: "e2e_agenda",
      title: titulo,
      body: "Persistência da central de notificações",
      link: "/pipeline",
    });

    await page.goto("/pipeline");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /notificações/i }).click();
    await page.getByRole("button").filter({ hasText: titulo }).click();

    await expect.poll(async () => {
      const [row] = await db.select<{ read_at: string | null }>(
        `notifications?id=eq.${notification.id}&select=read_at`,
      );
      return row?.read_at;
    }).not.toBeNull();

    await page.reload();
    await aguardarCarregamento(page);
    const [persisted] = await db.select<{ read_at: string | null }>(
      `notifications?id=eq.${notification.id}&select=read_at`,
    );
    expect(persisted.read_at).not.toBeNull();
  });
});
