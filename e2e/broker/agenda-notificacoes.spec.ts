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

    const aviso = page.getByRole("button").filter({ hasText: titulo });
    // Mesmo formato de data do resto do sistema (`dateTime`, src/lib/format.ts).
    // O sino tinha um formatador próprio, e o `Intl` com data e hora juntas
    // insere uma vírgula que não aparece em nenhuma outra tela.
    await expect(aviso).toContainText(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    await expect(aviso).not.toContainText(/\d{4}, \d{2}:\d{2}/);

    await aviso.click();

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

  test("o sino fecha com Esc e devolve o foco", async ({ page }) => {
    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    const sino = page.getByRole("button", { name: /notificações/i });
    await sino.click();
    await expect(page.getByRole("dialog", { name: "Notificações" })).toBeVisible();

    // O fundo de fechar era um <button> de tela inteira: um Tab a partir do
    // sino caía num controle invisível. Para teclado o caminho é Esc.
    await expect(page.getByRole("button", { name: /fechar notificações/i })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Notificações" })).toBeHidden();
    await expect(sino).toBeFocused();
  });

  /**
   * O número que o corretor mais olha.
   *
   * O badge contava `items.filter(...)` sobre a lista baixada, que tem teto de
   * 30: medido no banco de homologação, um corretor com 106 não lidas via
   * "30". Errado, e sempre para menos — o pior sentido possível para um aviso.
   */
  test("o contador do sino vem do banco, não da página carregada", async ({ page }) => {
    const extras = Array.from({ length: 35 }, (_, i) => ({
      profile_id: brokerId,
      kind: "e2e_agenda",
      title: `Contagem ${cenario.tag} ${String(i).padStart(2, "0")}`,
    }));
    await db.insert("notifications", extras);
    try {
      // A contagem sai do banco e passa pela mesma condição da policy
      // (`channel = 'in_app'`): comparar com um número montado no teste seria
      // comparar a tela com o palpite do teste.
      const naoLidas = await db.select<{ id: string }>(
        `notifications?profile_id=eq.${brokerId}&read_at=is.null&channel=eq.in_app&select=id`,
      );
      expect(naoLidas.length, "o cenário precisa passar do tamanho da página").toBeGreaterThan(30);

      await page.goto("/pipeline");
      await aguardarCarregamento(page);

      await expect(
        page.getByRole("button", { name: `Notificações (${naoLidas.length.toLocaleString("pt-BR")} não lidas)` }),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await db.remove(`notifications?profile_id=eq.${brokerId}&kind=eq.e2e_agenda&title=like.Contagem*`);
    }
  });

  test("o sino filtra só não lidas e apaga um aviso", async ({ page }) => {
    const naoLido = `Novo ${cenario.tag}`;
    const jaLido = `Antigo ${cenario.tag}`;
    // As duas linhas com as MESMAS chaves: o PostgREST recusa lote com formato
    // desigual (PGRST102, "All object keys must match"), então o não lido diz
    // `read_at: null` em vez de omitir a coluna.
    const [novo] = await db.insert<{ id: string }>("notifications", [
      { profile_id: brokerId, kind: "e2e_agenda", title: naoLido, read_at: null },
      { profile_id: brokerId, kind: "e2e_agenda", title: jaLido, read_at: new Date().toISOString() },
    ]);

    await page.goto("/pipeline");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /notificações/i }).click();

    await expect(page.getByText(jaLido, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Só não lidas" }).click();
    await expect(page.getByText(jaLido, { exact: true })).toHaveCount(0);
    await expect(page.getByText(naoLido, { exact: true })).toBeVisible();

    // `notifications_delete` já permitia apagar a própria linha; a tela é que
    // não oferecia. Apagar só na lista seria pior que não apagar: o aviso
    // voltaria na próxima carga.
    await page.getByRole("button", { name: `Apagar aviso: ${naoLido}` }).click();
    await expect(page.getByText(naoLido, { exact: true })).toHaveCount(0);

    await expect
      .poll(async () => (await db.select(`notifications?id=eq.${novo.id}&select=id`)).length)
      .toBe(0);
  });

  test("corretor não tem o seletor de pré-visualização de papel", async ({ page }) => {
    // A trava real está no AuthContext (`setPreviewRole` ignora quem não é
    // admin de verdade) e só era garantida por leitura de código: nenhum spec
    // de papel não-admin conferia que o combobox some.
    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await expect(page.getByRole("combobox", { name: /pré-visualizar como papel/i })).toHaveCount(0);
    await expect(page.getByText("prévia", { exact: true })).toHaveCount(0);
  });
});
