import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
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

type AvisoDeFila = {
  kind: string;
  title: string;
  channel: string;
  sent_at: string | null;
};

/**
 * Só os avisos de PRAZO deste lead.
 *
 * O recorte é pelo TÍTULO, que carrega o nome do lead com a etiqueta da
 * execução. Pelo link não dá: desde a 0088 o aviso de prazo aponta para `/leads`
 * (o lead volta a ficar sem dono e a RLS não o mostra a quem foi avisado), então
 * o link é o mesmo para todos os corretores da base.
 */
const avisosDoPrazo = (titulo: string) =>
  db.select<AvisoDeFila>(
    `notifications?title=eq.${encodeURIComponent(titulo)}&kind=eq.lead_lost_timeout` +
      "&select=kind,title,channel,sent_at&order=channel",
  );

/**
 * Espera o gatilho gravar as duas linhas.
 *
 * `release_expired_leads` é síncrona, mas o cron roda em paralelo a cada 30 s e
 * pode ter fechado a atribuição antes da chamada do `beforeAll`: o poll aceita
 * as duas ordens sem depender de relógio.
 */
async function esperarAvisos(titulo: string): Promise<AvisoDeFila[]> {
  await expect
    .poll(async () => (await avisosDoPrazo(titulo)).length, { timeout: 20_000 })
    .toBe(2);
  return avisosDoPrazo(titulo);
}

/**
 * Requisito 10 (ata de 14/07): o corretor que perde o lead por prazo precisa
 * ser avisado.
 *
 * O caminho existia em partes e nenhum teste percorria as partes juntas:
 * `release_expired_leads` fecha a atribuição por prazo, o gatilho
 * `notify_lead_timeout` grava DUAS linhas (a `in_app` que o sino mostra e a
 * `whatsapp` que o `notify-dispatch` entrega) e o sino lê a primeira. Cada peça
 * tinha cobertura própria; o que ninguém provava era que o corretor VÊ o aviso.
 *
 * O cenário usa a RPC de produção, e não um UPDATE montado à mão: o que está
 * sob teste é o fluxo que o pg_cron executa a cada 30 s.
 */
test.describe.serial("corretor · aviso de lead perdido por prazo", () => {
  const tag = runTag();
  const nome = `Lead prazo ${tag}`;
  let brokerId = "";
  let grupoId = "";
  let leadId = "";
  /** Título que o gatilho grava; é por ele que as duas linhas são achadas. */
  const tituloDoAviso = `Lead devolvido à fila: ${nome}`;

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    const grupos = await db.select<{ id: string }>(
      "distribution_groups?kind=eq.general&active=eq.true&select=id&limit=1",
    );
    expect(grupos, "o catálogo precisa de um grupo de distribuição geral").toHaveLength(1);
    grupoId = grupos[0].id;

    /**
     * Tira o corretor da roleta antes de montar o cenário — mesma razão do
     * `e2e/broker/trava-atendimento.spec.ts`: `release_expired_leads` chama
     * `assign_lead` logo depois de liberar, e um lead caindo na mão do corretor
     * abre o `NewLeadNotifier`, um Dialog do Radix que deixa o resto da página
     * `aria-hidden` — inclusive o sino que este teste precisa abrir.
     */
    await db.update(
      `checkins?profile_id=eq.${brokerId}&checked_out_at=is.null`,
      { checked_out_at: new Date().toISOString() },
    );

    // Estado que `assign_lead` produz, com o prazo JÁ vencido.
    const prazo = new Date(Date.now() - 60_000).toISOString();
    const [lead] = await db.insert<{ id: string }>("leads", {
      full_name: nome,
      phone: "11977776666",
      notes: tag,
      status: "assigned",
      assigned_to: brokerId,
      assigned_at: new Date(Date.now() - 6 * 60_000).toISOString(),
      attend_deadline: prazo,
      distribution_group_id: grupoId,
    });
    leadId = lead.id;
    await db.insert("lead_assignments", {
      lead_id: leadId,
      profile_id: brokerId,
      group_id: grupoId,
      deadline: prazo,
    });

    // O caminho de produção. O cron roda a cada 30 s e pode chegar antes; não
    // faz diferença, porque a própria RPC recorta por `released_at is null`.
    await db.rpc("release_expired_leads");
  });

  test.afterAll(async () => {
    // Pelo título, e não pelo link: o aviso de prazo aponta para `/leads`, que é
    // o link de todo mundo — apagar por ele levaria avisos de outras execuções.
    await db.remove(`notifications?title=eq.${encodeURIComponent(tituloDoAviso)}`);
    // Cascata leva atribuições e eventos junto.
    await db.remove(`leads?notes=eq.${tag}`);
  });

  test("o estouro de prazo grava o aviso do sino e a mensagem da fila de saída", async () => {
    const avisos = await esperarAvisos(tituloDoAviso);

    // Uma linha por canal. Só a `in_app` chega ao sino (a policy
    // `notifications_select` recorta por canal); a `whatsapp` é a fila que o
    // worker entrega quando a credencial da Meta existir.
    expect(
      avisos.map((a) => a.channel).sort(),
      "o estouro de prazo precisa render o aviso do sino E a mensagem da fila",
    ).toEqual(["in_app", "whatsapp"]);

    for (const aviso of avisos) {
      expect(aviso.kind).toBe("lead_lost_timeout");
      // "Você perdeu um lead" sem dizer QUAL não serve para quem tem doze na mão.
      expect(aviso.title, "o aviso precisa nomear o lead").toContain(nome);
    }

    // A mensagem de WhatsApp continua ESPERANDO enquanto não sai: marcar
    // `sent_at` sem envio seria dizer que o corretor foi avisado por um canal
    // que não entregou nada.
    const naFila = avisos.find((a) => a.channel === "whatsapp")!;
    expect(naFila.sent_at, "mensagem marcada como enviada sem ter saído").toBeNull();
  });

  test("o mesmo estouro não vira dois avisos", async () => {
    const antes = (await esperarAvisos(tituloDoAviso)).length;

    /**
     * Reescreve `released_at` numa atribuição JÁ fechada por prazo.
     *
     * Medido em 05/09/2026 na homologação, antes da migration 0088: este UPDATE
     * levava `lead_lost_timeout` de 718 para 720 linhas — o gatilho disparava em
     * `after update of released_at` sem recorte de transição, então qualquer
     * reescrita duplicava o aviso do mesmo estouro. A cláusula
     * `when (old.released_at is null and new.released_at is not null)` fecha
     * isso no único ponto por onde todo escritor passa.
     */
    await db.update(
      `lead_assignments?lead_id=eq.${leadId}&release_reason=eq.timeout`,
      { released_at: new Date().toISOString() },
    );

    // Sem poll de propósito: o gatilho é síncrono, então a linha extra já
    // estaria gravada quando o UPDATE retornou. Esperar aqui só esconderia.
    const depois = (await avisosDoPrazo(tituloDoAviso)).length;
    expect(depois, "a reescrita de released_at duplicou o aviso do mesmo estouro").toBe(antes);
  });

  test("o corretor vê o aviso no sino e o clique leva à lista de leads dele", async ({ page }) => {
    await esperarAvisos(tituloDoAviso);

    await page.goto("/pipeline");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /notificações/i }).click();

    // Pelo TÍTULO do aviso de prazo, não pelo nome do lead: o mesmo lead também
    // rendeu um "Lead atribuído a você" no começo do cenário.
    const aviso = page.getByRole("button").filter({ hasText: tituloDoAviso });
    await expect(aviso, "o aviso de lead perdido por prazo não apareceu no sino").toBeVisible();
    await expect(aviso).toContainText(/voltou para a roleta/i);

    await aviso.click();

    /**
     * `/leads`, sem o parâmetro do lead.
     *
     * Até a 0088 o gatilho gravava `/leads?lead=<id>` e o corretor caía num
     * toast "Lead indisponível": o lead voltou para a roleta, fica sem dono, e a
     * policy `leads_select` só mostra lead sem dono a quem tem
     * `leads.view_queue` — que o corretor não tem. Qual lead se perdeu está no
     * título; o destino que ele pode abrir é a lista dele.
     */
    await expect(page).toHaveURL(/\/leads(\?|$)/);
    await expect(page, "o aviso voltou a apontar para um lead que o corretor não abre")
      .not.toHaveURL(new RegExp(`lead=${leadId}`));

    // Clicar marca como lido no BANCO. Pintar só na tela devolveria o aviso na
    // próxima carga.
    await expect.poll(async () => {
      const [linha] = await db.select<{ read_at: string | null }>(
        `notifications?title=eq.${encodeURIComponent(tituloDoAviso)}&kind=eq.lead_lost_timeout` +
          "&channel=eq.in_app&select=read_at",
      );
      return linha?.read_at;
    }).not.toBeNull();
  });
});
