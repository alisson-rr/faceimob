import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

/**
 * A tela de check-in nos caminhos que `roleta.spec.ts` não cobre.
 *
 * `roleta.spec.ts` prova a gravação do check-in e a recusa por IP. O que faltava
 * — e é o que está aqui — é o outro lado do ponto:
 *
 *  1. o botão "Check-out" nunca tinha sido clicado por teste nenhum: só a RPC
 *     `perform_checkout()` era chamada direta no harness SQL, então o caminho
 *     tela → edge function (`action: "checkout"`) → banco era promessa;
 *  2. o aviso amarelo de "você tem N atrasados" só existia no ramo BLOQUEADO;
 *  3. presença fechada pelo cron do fim do turno aparecia como um check-out
 *     que o corretor não fez (a coluna `auto_checkout` existia e ninguém lia).
 *
 * Como em `roleta.spec.ts`, o cenário é montado no banco e a conferência também:
 * toast de sucesso sem linha gravada é tela mentindo.
 */

type Turno = { id: string; label: string; checkin_start: string; distribution_start: string; checkout_time: string };
type Presenca = { id: string; checked_out_at: string | null; auto_checkout: boolean };
type Elegibilidade = { allowed: boolean; reason: string | null; overdue_count: number; threshold: number };

const hhmm = (t: string) => t.slice(0, 5);

test.describe("check-in do corretor", () => {
  let brokerId = "";
  let turnos: Turno[] = [];

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
    turnos = await db.select<Turno>(
      "work_shifts?active=eq.true&select=id,label,checkin_start,distribution_start,checkout_time&order=position",
    );
    expect(turnos.length, "o catálogo precisa de turnos ativos").toBeGreaterThan(0);
  });

  test.afterEach(async () => {
    // Presença aberta sobrando faz o corretor receber lead depois do teste.
    await db.remove(`checkins?profile_id=eq.${brokerId}`);
  });

  /**
   * O check-out pela tela.
   *
   * A resposta da edge function é segurada (`route`) para a fase "em voo" durar
   * o tempo da asserção: sem `aria-busy` o leitor de tela não anuncia nada e o
   * corretor clica de novo achando que não pegou.
   */
  test("o botão Check-out encerra a presença no banco e sinaliza a gravação em voo", async ({ page }) => {
    const turnoAtual = await db.rpc<string | null>("current_shift");
    test.skip(!turnoAtual, "fora de qualquer janela de turno: não há presença aberta para encerrar");

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    // `work_date` fica com o default do banco: quem manda no dia operacional é
    // o servidor (`current_work_date()`), não o relógio de quem roda o teste.
    const [presenca] = await db.insert<Presenca>("checkins", { profile_id: brokerId, shift_id: turnoAtual });
    expect(presenca.checked_out_at, "cenário: a presença precisa começar aberta").toBeNull();

    let liberar: () => void = () => undefined;
    const preso = new Promise<void>((resolve) => { liberar = resolve; });
    await page.route("**/functions/v1/broker-checkin", async (route) => {
      await preso;
      await route.continue();
    });

    await page.goto("/checkin");
    await aguardarCarregamento(page);

    const botao = page.getByRole("button", { name: /check-out/i });
    await expect(botao).toBeEnabled();
    await botao.click();

    await expect(botao).toHaveAttribute("aria-busy", "true");
    await expect(botao, "botão clicável durante a gravação é um segundo check-out").toBeDisabled();

    liberar();
    await expect(page.getByText("Check-out realizado!")).toBeVisible();

    const [depois] = await db.select<Presenca>(
      `checkins?id=eq.${presenca.id}&select=id,checked_out_at,auto_checkout`,
    );
    expect(depois.checked_out_at, "toast de check-out sem saída gravada é tela mentindo").not.toBeNull();
    // Quem encerrou foi o corretor: o cron marcaria `auto_checkout`.
    expect(depois.auto_checkout, "check-out pela tela não é fechamento automático").toBe(false);

    // E a tela volta a oferecer o check-in do turno.
    await expect(page.getByRole("button", { name: /check-out/i })).toBeDisabled();
  });

  /**
   * Fechamento pelo cron: a hora exibida é a que ACONTECEU.
   *
   * O texto usava o `checkout_time` configurado do turno. Duas divergências
   * reais: o job roda a cada minuto (0013), então a saída é sempre depois do
   * horário do turno; e o horário do turno é editável na tela de turnos — depois
   * de uma edição, a presença antiga passaria a alegar um horário que nunca foi
   * o dela. O cenário monta exatamente essa diferença (3 min depois) e cobra as
   * duas metades: a hora gravada aparece E a hora configurada não.
   */
  test("presença encerrada pelo cron mostra a hora do fechamento, não a hora configurada do turno", async ({ page }) => {
    const turno = turnos[0];
    const workDate = await db.rpc<string>("current_work_date");
    // O cron fecha DEPOIS do horário do turno: 3 minutos, no fuso do banco.
    const fechadoEm = new Date(
      new Date(`${workDate}T${turno.checkout_time}-03:00`).getTime() + 3 * 60_000,
    );
    const horaGravada = fechadoEm.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit",
    });
    expect(horaGravada, "cenário: a hora gravada tem de diferir da configurada").not.toBe(hhmm(turno.checkout_time));

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    // O mesmo estado que `auto_checkout_expired()` deixa no fim da janela —
    // inclusive a ENTRADA. Sem `checked_in_at`, a coluna cai no default `now()`
    // e o cenário passava a alegar uma presença que entrou depois de ter saído:
    // rodando o teste às 14h, a linha era "entrou 14:00, saiu 12:03" e o banco
    // recusava com 23514 (`checkins_period`: checked_out_at >= checked_in_at).
    // O cron só fecha presença ABERTA, então quem ele fecha entrou dentro da
    // janela — aqui, no início do turno.
    await db.insert("checkins", {
      profile_id: brokerId,
      shift_id: turno.id,
      work_date: workDate,
      checked_in_at: new Date(`${workDate}T${turno.checkin_start}-03:00`).toISOString(),
      checked_out_at: fechadoEm.toISOString(),
      auto_checkout: true,
    });

    await page.goto("/checkin");
    await aguardarCarregamento(page);

    await expect(page.getByText("Encerrado pelo sistema")).toBeVisible();
    await expect(
      page.getByText(`Fechado automaticamente às ${horaGravada}, no fim da janela.`),
    ).toBeVisible();
    await expect(
      page.getByText(`Fechado automaticamente às ${hhmm(turno.checkout_time)}, no fim da janela.`),
      "a hora do turno é configuração, não o que aconteceu",
    ).toHaveCount(0);
    // Sem a distinção, o rótulo era só "Encerrado" — e o corretor lia como se
    // ele mesmo tivesse batido a saída.
    await expect(page.getByText("Encerrado", { exact: true })).toHaveCount(0);
  });

  /**
   * A comporta de carregamento tem de esperar a presença de hoje.
   *
   * `listTodayCheckins` faz DUAS idas ao banco (`current_work_date` e só então
   * `checkins`), contra uma de cada outra consulta da tela: a comporta abria
   * antes da resposta. Nesse render, quem JÁ bateu ponto via "Fazer check-in"
   * habilitado (clicar rende erro do servidor), "Check-out" desabilitado e a
   * fila dizendo "é preciso estar em check-in no turno". O `route` segura o GET
   * de `checkins` para essa fase durar o tempo da asserção.
   */
  test("enquanto a presença de hoje não responde, a tela não oferece um check-in que o servidor recusaria", async ({ page }) => {
    const turnoAtual = await db.rpc<string | null>("current_shift");
    test.skip(!turnoAtual, "fora de qualquer janela de turno: não há presença aberta para exibir");

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    await db.insert("checkins", { profile_id: brokerId, shift_id: turnoAtual });

    let liberar: () => void = () => undefined;
    const preso = new Promise<void>((resolve) => { liberar = resolve; });
    await page.route("**/rest/v1/checkins*", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await preso;
      await route.continue();
    });

    await page.goto("/checkin");

    await expect(page.getByText(/carregando o turno e a elegibilidade/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /fazer check-in/i }),
      "botão de check-in antes de saber se já há presença aberta é erro garantido",
    ).toHaveCount(0);
    await expect(page.getByText(/é preciso estar em check-in/i)).toHaveCount(0);

    liberar();
    await aguardarCarregamento(page);

    await expect(page.getByRole("button", { name: /check-out/i })).toBeEnabled();
    await expect(page.getByRole("button", { name: /fazer check-in/i })).toBeDisabled();
  });

  /**
   * "Nenhuma janela de trabalho cadastrada." é afirmação sobre CADASTRO.
   *
   * O cartão das janelas ficava fora da comporta de carregamento e lia
   * `shifts.data ?? []`: no primeiro paint e depois de `listWorkShifts` falhar,
   * os dois davam a mesma frase — a segunda logo abaixo do "Não consegui
   * carregar o check-in", duas mensagens contraditórias no mesmo render. O
   * corretor conclui que o admin não cadastrou turno nenhum e vai cobrar isso.
   *
   * O GET de `work_shifts` é segurado primeiro (fase em voo) e só então
   * respondido com erro (fase de falha): as duas leituras erradas do mesmo texto
   * num caso só.
   */
  test.describe(() => {
    test.use({ errosEsperados: [/status of 500|Failed to load resource/i] });

    test("com a leitura dos turnos fora do ar, a tela não afirma que não há turno cadastrado", async ({ page }) => {
      let liberar: () => void = () => undefined;
      const preso = new Promise<void>((resolve) => { liberar = resolve; });
      let primeira = true;
      await page.route("**/rest/v1/work_shifts*", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        // Só a primeira espera; a repetição do react-query (`retry: 1`) já falha direto.
        if (primeira) { primeira = false; await preso; }
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "erro simulado de leitura" }),
        });
      });

      await page.goto("/checkin");

      await expect(page.getByText(/carregando as janelas de trabalho/i)).toBeVisible();
      await expect(
        page.getByText(/nenhuma janela de trabalho cadastrada/i),
        "afirmar cadastro vazio antes da resposta é o defeito",
      ).toHaveCount(0);

      liberar();

      await expect(page.getByText(/não consegui carregar as janelas de trabalho/i)).toBeVisible();
      await expect(page.getByText(/vazia por falha de leitura, não porque não há turno cadastrado/i)).toBeVisible();
      await expect(
        page.getByText(/nenhuma janela de trabalho cadastrada/i),
        "vazio por erro de leitura não é vazio de cadastro",
      ).toHaveCount(0);
    });
  });

  /**
   * O aviso amarelo (ainda liberado, mas já com atraso).
   *
   * Só o ramo BLOQUEADO tinha teste (`roleta.spec.ts`). Este é o aviso que
   * chega antes da trava — e o caminho de saída, que a tela não oferecia:
   * mostrava o número e deixava o corretor sem para onde ir.
   */
  test("com atraso abaixo do limite a tela avisa e oferece o caminho para regularizar", async ({ page }) => {
    const tag = runTag();
    const antes = (await db.rpc<Elegibilidade[]>("checkin_eligibility", { who: brokerId }))[0];
    expect(antes.allowed, "o corretor já começou o teste bloqueado — cenário inválido").toBe(true);
    expect(antes.threshold - antes.overdue_count, "não há folga para um atraso a mais").toBeGreaterThan(1);

    const vencido = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await db.insert("leads", {
      full_name: `Lead atrasado aviso ${tag}`,
      status: "in_progress",
      assigned_to: brokerId,
      next_action_at: vencido,
      notes: tag,
    });

    try {
      const agora = (await db.rpc<Elegibilidade[]>("checkin_eligibility", { who: brokerId }))[0];
      expect(agora.allowed, "um atraso só não pode bloquear").toBe(true);
      expect(agora.overdue_count).toBe(antes.overdue_count + 1);

      await page.goto("/checkin");
      await aguardarCarregamento(page);

      // Número e limite vêm do banco, não de conta na tela.
      await expect(
        page.getByText(
          `Você tem ${agora.overdue_count} lead(s) atrasado(s). O check-in trava em ${agora.threshold}.`,
        ),
      ).toBeVisible();

      // `overdue_lead_count` só soma lead com `next_action_at` vencido: sem
      // esta frase o corretor procura o atraso na lista inteira, não acha e
      // conclui que a trava está errada.
      await expect(
        page.getByText(/só de lead com próxima ação marcada e já vencida/i),
      ).toBeVisible();

      const link = page.getByRole("link", { name: /regularizar meus leads/i });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", "/leads");
      await expect(page.getByText(/painel “Leads atrasados” abre no topo/i)).toBeVisible();
    } finally {
      await db.remove(`leads?notes=eq.${tag}`);
    }
  });

  /**
   * Os dois botões dividiam o mesmo estado "em voo".
   *
   * Clicar em Check-out marcava `aria-busy` também no "Fazer check-in" — um
   * botão anunciado como ocupado sem estar fazendo nada. Para quem usa leitor de
   * tela, isso é um anúncio falso; para quem enxerga, o botão pisca em estado de
   * carregamento à toa.
   */
  test("a gravação em voo marca só o botão que foi clicado", async ({ page }) => {
    const turnoAtual = await db.rpc<string | null>("current_shift");
    test.skip(!turnoAtual, "fora de qualquer janela de turno: não há presença aberta para encerrar");

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    await db.insert("checkins", { profile_id: brokerId, shift_id: turnoAtual });

    let liberar: () => void = () => undefined;
    const preso = new Promise<void>((resolve) => { liberar = resolve; });
    await page.route("**/functions/v1/broker-checkin", async (route) => {
      await preso;
      await route.continue();
    });

    await page.goto("/checkin");
    await aguardarCarregamento(page);

    const checkout = page.getByRole("button", { name: /check-out/i });
    const checkin = page.getByRole("button", { name: /fazer check-in/i });
    await checkout.click();

    await expect(checkout).toHaveAttribute("aria-busy", "true");
    await expect(
      checkin,
      "o botão que não foi clicado não está gravando nada — anunciá-lo como ocupado é anúncio falso",
    ).toHaveAttribute("aria-busy", "false");

    liberar();
    await expect(page.getByText("Check-out realizado!")).toBeVisible();
  });
});

/**
 * O check-in é a primeira tela do dia do corretor — e ele bate ponto do celular.
 * Nenhuma medida de 375 px existia para esta rota.
 */
test.describe("check-in no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("/checkin cabe em 375 px sem rolar a página na horizontal", async ({ page }) => {
    await page.goto("/checkin");
    await aguardarCarregamento(page);

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const culpado = transbordo > 1 ? await page.evaluate(() => {
      const sobra = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const trilha: string[] = [];
      let atual: Element = document.body;
      for (let nivel = 0; nivel < 25; nivel++) {
        const culpados = Array.from(atual.children).filter((filho) => {
          const el = filho as HTMLElement;
          const antes = el.style.display;
          el.style.display = "none";
          const semEle = sobra();
          el.style.display = antes;
          return semEle <= 1;
        });
        if (culpados.length !== 1) break;
        const el = culpados[0];
        trilha.push(`${el.tagName.toLowerCase()}[${typeof el.className === "string" ? el.className.slice(0, 90) : ""}]`);
        atual = el;
      }
      return trilha.length ? ` — quem estoura: ${trilha.slice(-4).join(" > ")}` : "";
    }) : "";
    expect(transbordo, `o check-in rola na horizontal em 375 px${culpado}`).toBeLessThanOrEqual(1);

    // A janela e os dois botões de ponto continuam alcançáveis no celular.
    await expect(page.getByRole("heading", { name: /check-in de corretor/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /check-out/i })).toBeVisible();
  });
});
