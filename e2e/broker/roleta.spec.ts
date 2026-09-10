/**
 * Roleta, check-in e fila — a operação da ata de 14/07 pela visão do corretor.
 *
 * Tudo aqui parte de um princípio: a tela não pode inventar regra. Turno,
 * elegibilidade, posição na fila e contagem de leads têm dono no banco
 * (`current_shift`, `checkin_eligibility`, `distribution_queue`,
 * `lead_assignments`) — o teste monta o cenário por lá e cobra que a tela
 * mostre exatamente aquilo. Onde há gravação (o check-in em si), a conferência
 * é no banco: toast de sucesso sem linha gravada é tela mentindo.
 *
 * Um arquivo só, de propósito: os casos disputam o mesmo check-in do corretor,
 * e o Playwright serializa testes dentro de um arquivo — separá-los em arquivos
 * faria dois workers brigarem pela mesma linha de `checkins`.
 */
import { test, expect, db, comoAdmin, aguardarCarregamento, runTag } from "../support/fixtures";

type Turno = {
  id: string;
  code: string;
  label: string;
  checkin_start: string;
  distribution_start: string;
  checkout_time: string;
};
type Elegibilidade = { allowed: boolean; reason: string | null; overdue_count: number; threshold: number };
type LinhaDaFila = { profile_id: string; full_name: string; queue_position: number };
type Presenca = { id: string; shift_id: string; ip_address: string | null; checked_out_at: string | null };

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Data e hora no fuso que o banco usa para decidir turno (America/Sao_Paulo).
 * O `Intl` resolve isso sem depender do fuso da máquina que roda a suíte.
 */
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const agoraSP = () => new Date().toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour12: false });

/** Valor de um período do LeadCounter ("Hoje", "Semana", "Mês"). */
const contador = (page: import("@playwright/test").Page, rotulo: string) =>
  page.getByText(rotulo, { exact: true }).locator("xpath=following-sibling::p");

test.describe("roleta, check-in e fila", () => {
  let brokerId = "";
  let grupoGeral: { id: string; name: string };

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    const grupos = await db.select<{ id: string; name: string }>(
      "distribution_groups?kind=eq.general&active=eq.true&select=id,name&limit=1",
    );
    expect(grupos, "o catálogo precisa de um grupo de distribuição geral").toHaveLength(1);
    grupoGeral = grupos[0];
  });

  test.afterAll(async () => {
    // Presença aberta sobrando faz o corretor receber lead da roleta depois do
    // teste — e aí o próximo cenário começa sujo.
    await db.remove(`checkins?profile_id=eq.${brokerId}`);
  });

  /** Turno cuja distribuição já começou: é o requisito de `distribution_queue`. */
  const turnoQueJaDistribui = async (): Promise<Turno | null> => {
    const agora = agoraSP();
    const turnos = await db.select<Turno>(
      "work_shifts?active=eq.true&select=id,code,label,checkin_start,distribution_start,checkout_time&order=position",
    );
    return turnos.find((t) => t.distribution_start <= agora && agora <= t.checkout_time) ?? null;
  };

  /** Coloca o corretor no grupo geral. Devolve true se a linha foi criada aqui. */
  const garantirMembroDoGrupo = async (): Promise<boolean> => {
    const atual = await db.select<{ active: boolean }>(
      `distribution_group_members?group_id=eq.${grupoGeral.id}&profile_id=eq.${brokerId}&select=active`,
    );
    if (atual.length) {
      if (!atual[0].active) {
        await db.update(
          `distribution_group_members?group_id=eq.${grupoGeral.id}&profile_id=eq.${brokerId}`,
          { active: true },
        );
      }
      return false;
    }
    await db.insert("distribution_group_members", {
      group_id: grupoGeral.id,
      profile_id: brokerId,
      active: true,
    });
    return true;
  };

  // ───────────────────────────────────────────────────────────────────────────

  test("a janela de trabalho na tela é a que o banco define", async ({ page }) => {
    const turnos = await db.select<Turno>(
      "work_shifts?active=eq.true&select=id,code,label,checkin_start,distribution_start,checkout_time&order=position",
    );
    const turnoAtual = await db.rpc<string | null>("current_shift");

    await page.goto("/checkin");
    await aguardarCarregamento(page);

    // Toda janela configurada aparece com os horários do banco — a versão
    // anterior desta tela calculava a janela em JS e ignorava o fuso.
    for (const t of turnos) {
      await expect(page.getByText(t.label, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(`${hhmm(t.checkin_start)} → ${hhmm(t.checkout_time)}`)).toBeVisible();
      await expect(page.getByText(`Distribui a partir de ${hhmm(t.distribution_start)}`)).toBeVisible();
    }

    if (turnoAtual) {
      const turno = turnos.find((t) => t.id === turnoAtual);
      expect(turno, "current_shift devolveu um turno que não está em work_shifts").toBeTruthy();
      // O texto da janela atual foi reescrito na Tarefa G (era
      // "Check-in: HH:MM · Distribuição inicia: HH:MM · Check-out: HH:MM").
      // O que importa continua sendo o mesmo: os TRÊS horários da janela vêm de
      // `work_shifts`, não de constante no front.
      await expect(
        page.getByText(
          new RegExp(
            `Check-in ${hhmm(turno!.checkin_start)}.*distribuição a partir de ${hhmm(turno!.distribution_start)}.*check-out ${hhmm(turno!.checkout_time)}`,
            "i",
          ),
        ),
      ).toBeVisible();
      await expect(page.getByText("Fora do expediente")).toHaveCount(0);
    } else {
      // Fora de qualquer janela o check-in não é oferecido — é o primeiro
      // impedimento da ata: só se marca presença dentro do turno.
      await expect(page.getByText("Fora do expediente")).toBeVisible();
      await expect(page.getByText(/Nenhuma janela ativa agora/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /fazer check-in/i })).toBeDisabled();
    }
  });

  test("acima do limite de leads atrasados o check-in trava e a tela diz por quê", async ({ page }) => {
    const tag = runTag();
    const antes = (await db.rpc<Elegibilidade[]>("checkin_eligibility", { who: brokerId }))[0];
    const faltam = antes.threshold - antes.overdue_count;
    expect(faltam, "o corretor já começou o teste bloqueado — cenário inválido").toBeGreaterThan(0);

    // "Atrasado" tem definição única no banco (`overdue_lead_count`): lead vivo
    // com `next_action_at` vencido. É essa conta que trava o check-in.
    const vencido = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db.insert(
      "leads",
      Array.from({ length: faltam }, (_, i) => ({
        full_name: `Lead atrasado ${i + 1} ${tag}`,
        status: "in_progress",
        assigned_to: brokerId,
        next_action_at: vencido,
        notes: tag,
      })),
    );

    try {
      const bloqueado = (await db.rpc<Elegibilidade[]>("checkin_eligibility", { who: brokerId }))[0];
      expect(bloqueado.allowed, "cenário: o banco precisava recusar o check-in").toBe(false);
      expect(bloqueado.overdue_count).toBeGreaterThanOrEqual(bloqueado.threshold);

      await page.goto("/checkin");
      await aguardarCarregamento(page);

      // O motivo exibido é o texto do banco, não uma frase da tela.
      await expect(page.getByText(bloqueado.reason!)).toBeVisible();
      await expect(
        page.getByText(new RegExp(`lead\\(s\\) atrasado\\(s\\); o limite é ${bloqueado.threshold}`)),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /fazer check-in/i })).toBeDisabled();
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });

  // A segunda metade provoca a recusa por IP de propósito: a edge function
  // responde 400 e o navegador registra. É a prova da trava, não defeito.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 400/i] });

  test("a trava por IP decide o check-in: liberado grava presença, bloqueado recusa", async ({ page }) => {
    const turnoAtual = await db.rpc<string | null>("current_shift");
    test.skip(!turnoAtual, "fora de qualquer janela de turno: o botão de check-in não fica ativo");

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    // `bypass_ip_check` é a liberação de IP dinâmico que o admin concede — é o
    // caminho suportado para um corretor fora da faixa da loja.
    await comoAdmin.update(`profiles?id=eq.${brokerId}`, { bypass_ip_check: true });

    let ipDoServidor: string | null = null;
    try {
      await page.goto("/checkin");
      await aguardarCarregamento(page);
      await page.getByRole("button", { name: /fazer check-in/i }).click();
      // Pelo cabeçalho: a frase de incentivo do diálogo é sorteada e algumas
      // repetem "Check-in confirmado", o que deixaria o texto ambíguo.
      await expect(page.getByRole("heading", { name: /check-in confirmado/i })).toBeVisible();
      await page.getByRole("button", { name: /bora atender/i }).click();

      const presencas = await db.select<Presenca>(
        `checkins?profile_id=eq.${brokerId}&select=id,shift_id,ip_address,checked_out_at&order=checked_in_at.desc`,
      );
      expect(presencas, "check-in confirmado na tela tem que existir no banco").toHaveLength(1);
      expect(presencas[0].shift_id, "a presença é gravada no turno vigente").toBe(turnoAtual);
      expect(presencas[0].checked_out_at).toBeNull();
      // Migration 0020: sem IP identificado a RPC recusa. A linha gravada com
      // `ip_address` preenchido prova que a tela passou pela edge function.
      expect(presencas[0].ip_address, "0020 exige IP identificado no check-in").toBeTruthy();
      ipDoServidor = presencas[0].ip_address;

      // A tela reflete a presença aberta: não dá para bater ponto duas vezes.
      await expect(page.getByRole("button", { name: /fazer check-in/i })).toBeDisabled();
      await expect(page.getByRole("button", { name: /check-out/i })).toBeEnabled();
    } finally {
      await comoAdmin.update(`profiles?id=eq.${brokerId}`, { bypass_ip_check: false });
    }

    // Segunda metade: mesmo IP, agora sem bypass e fora das faixas cadastradas.
    const cobreOIp = await db.rpc<boolean>("ip_is_allowed", { candidate: ipDoServidor, who: brokerId });
    test.skip(
      cobreOIp,
      `o IP visto pelo servidor (${ipDoServidor}) já está numa faixa liberada — a recusa não pode ser provada aqui`,
    );

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    await page.goto("/checkin");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /fazer check-in/i }).click();

    await expect(page.getByText(/não autorizado para check-in/i)).toBeVisible();
    const depois = await db.select(`checkins?profile_id=eq.${brokerId}&select=id`);
    expect(depois, "recusa por IP não pode deixar presença gravada").toHaveLength(0);
  });

  });

  test("a posição na fila é a que distribution_queue devolve", async ({ page }) => {
    const turno = await turnoQueJaDistribui();
    test.skip(!turno, "nenhum turno com distribuição aberta agora — por regra a fila fica vazia");

    const membroCriadoAqui = await garantirMembroDoGrupo();
    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    // `work_date` fica com o default do banco: quem manda na data do dia
    // operacional é o servidor, não o relógio de quem roda o teste.
    await db.insert("checkins", { profile_id: brokerId, shift_id: turno!.id });

    try {
      // A fila é compartilhada e muda quando qualquer corretor recebe lead:
      // relê banco e tela juntos até baterem, em vez de congelar um número.
      await expect(async () => {
        const fila = await db.rpc<LinhaDaFila[]>("distribution_queue", { p_group_id: grupoGeral.id });
        const minha = fila.find((e) => e.profile_id === brokerId);
        expect(minha, "com check-in aberto o corretor tem que estar na fila do grupo").toBeTruthy();

        await page.goto("/checkin");
        await expect(
          page.getByText(`você é o ${minha!.queue_position}º de ${fila.length}`),
        ).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 30_000 });

      await expect(page.getByText(`${grupoGeral.name}:`)).toBeVisible();

      // A ordem sem o critério não explica nada: quem perde a vez precisa ler
      // por quê. É a regra da 0014 (`last_turn_at`), confirmada em 30/07.
      await expect(page.getByText(/deixar o prazo de atendimento vencer conta como vez usada/i))
        .toBeVisible();

      // Sem check-in aberto o corretor sai da roleta — regra da ata de 14/07.
      await db.remove(`checkins?profile_id=eq.${brokerId}`);
      await page.goto("/checkin");
      await expect(page.getByText(/fora da fila agora/i)).toBeVisible();
    } finally {
      await db.remove(`checkins?profile_id=eq.${brokerId}`);
      if (membroCriadoAqui) {
        await db.remove(
          `distribution_group_members?group_id=eq.${grupoGeral.id}&profile_id=eq.${brokerId}`,
        );
      }
    }
  });

  test("o contador de leads recebidos bate com lead_assignments do corretor", async ({ page }) => {
    const tag = runTag();
    const leads = await db.insert<{ id: string }>(
      "leads",
      [1, 2, 3].map((n) => ({ full_name: `Lead contador ${n} ${tag}`, notes: tag })),
    );
    const prazo = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await db.insert(
      "lead_assignments",
      leads.map((l) => ({
        lead_id: l.id,
        profile_id: brokerId,
        group_id: grupoGeral.id,
        deadline: prazo,
      })),
    );

    try {
      // Meia-noite em America/Sao_Paulo — o mesmo recorte que a tela usa, já que
      // o navegador da suíte roda nesse fuso (playwright.config.ts).
      const inicioDoDia = `${hojeSP()}T00:00:00-03:00`;
      let doDia = 0;

      await expect(async () => {
        doDia = (
          await db.select(
            `lead_assignments?profile_id=eq.${brokerId}&assigned_at=gte.${inicioDoDia}&select=id`,
          )
        ).length;
        expect(doDia, "as três atribuições do cenário precisam estar no banco").toBeGreaterThanOrEqual(3);

        await page.goto("/checkin");
        await expect(contador(page, "Hoje")).toHaveText(String(doDia), { timeout: 5_000 });
      }).toPass({ timeout: 30_000 });

      // Semana e mês contêm o dia: se algum período estivesse contando outra
      // coisa (leads em mãos, por exemplo), esta relação quebraria.
      const noMes = Number(await contador(page, "Mês").innerText());
      const naSemana = Number(await contador(page, "Semana").innerText());
      expect(naSemana).toBeGreaterThanOrEqual(doDia);
      expect(noMes).toBeGreaterThanOrEqual(naSemana);
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });

  test("check-in continua visível quando o dia do navegador diverge do banco", async ({ page }) => {
    const [turno] = await db.select<Turno>(
      "work_shifts?active=eq.true&select=id,code,label,checkin_start,distribution_start,checkout_time&order=position&limit=1",
    );
    expect(turno, "o catálogo precisa de ao menos um turno ativo").toBeTruthy();

    const workDate = await db.rpc<string>("current_work_date");
    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    await db.insert("checkins", {
      profile_id: brokerId,
      shift_id: turno.id,
      work_date: workDate,
      leads_received: 7,
    });

    try {
      // Simula deterministicamente a divergência que ocorre no limite noturno:
      // o navegador diz outro dia, mas a presença pertence ao dia do banco.
      await page.clock.setFixedTime(Date.now() - 24 * 60 * 60 * 1000);
      await page.goto("/checkin");
      await aguardarCarregamento(page);

      const browserDate = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
      expect(browserDate).not.toBe(workDate);
      // O selo do turno virou "Pela roleta neste turno: N" no card de janelas
      // de trabalho (Tarefa G) — o texto mudou, o que ele prova não.
      await expect(page.getByText(/pela roleta neste turno/i)).toContainText("7");
    } finally {
      await db.remove(`checkins?profile_id=eq.${brokerId}`);
    }
  });
});
