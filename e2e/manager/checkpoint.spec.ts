import { test, expect, db, aguardarCarregamento } from "../support/fixtures";

/**
 * Checkpoint semanal pela visão do gerente.
 *
 * A tela lê `daily_reports`/`daily_entries` da semana e compara com
 * `funnel_targets`. O lançamento em si é da tela pública `/diario` (coberta em
 * `anonimo/`); aqui o diário entra direto no banco e o teste cobra que o card
 * diga exatamente o que está lá: semana sem lançamento NÃO é gargalo, e
 * lançamento abaixo da meta é — no estágio certo, com a meta certa.
 *
 * O gerente E2E lidera Alfa e Beta (`support/users.ts`), então as duas
 * aparecem para ele; a Equipe Paulista, do seed, não.
 */

type Equipe = { id: string; name: string; slug: string };

/** Dia de hoje no fuso do banco e do navegador da suíte (America/Sao_Paulo). */
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Segunda e domingo da semana de `iso` — o mesmo recorte da tela (`weekStartsOn: 1`). */
const semanaDe = (iso: string) => {
  const dia = new Date(`${iso}T12:00:00Z`);
  const desdeSegunda = (dia.getUTCDay() + 6) % 7;
  const segunda = new Date(dia);
  segunda.setUTCDate(dia.getUTCDate() - desdeSegunda);
  const domingo = new Date(segunda);
  domingo.setUTCDate(segunda.getUTCDate() + 6);
  return { inicio: segunda.toISOString().slice(0, 10), fim: domingo.toISOString().slice(0, 10) };
};

test.describe("checkpoint semanal do gerente", () => {
  let alfa: Equipe;
  let beta: Equipe;
  let managerId = "";
  let brokerId = "";
  const hoje = hojeSP();
  const semana = semanaDe(hoje);

  // Só as equipes da suíte: `daily_reports` cascateia `daily_entries`.
  const limparSemana = () =>
    db.remove(
      `daily_reports?team_id=in.(${alfa.id},${beta.id})&report_date=gte.${semana.inicio}&report_date=lte.${semana.fim}`,
    );
  const limparMeta = () => db.remove(`funnel_targets?team_id=eq.${alfa.id}`);

  test.beforeAll(async () => {
    const equipes = await db.select<Equipe>("teams?slug=in.(equipe-e2e-alfa,equipe-e2e-beta)&select=id,name,slug");
    alfa = equipes.find((t) => t.slug === "equipe-e2e-alfa")!;
    beta = equipes.find((t) => t.slug === "equipe-e2e-beta")!;
    expect(alfa && beta, "as duas equipes da suíte precisam existir").toBeTruthy();
    managerId = await db.profileIdOf("manager");
    brokerId = await db.profileIdOf("broker");
    await limparSemana();
    await limparMeta();
  });

  test.afterAll(async () => {
    await limparSemana();
    await limparMeta();
  });

  const cardDe = (page: import("@playwright/test").Page, equipe: Equipe) =>
    page.getByRole("heading", { name: equipe.name, exact: true });

  test("semana sem lançamento não vira gargalo", async ({ page }) => {
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);

    await expect(cardDe(page, alfa)).toBeVisible();
    await expect(cardDe(page, beta)).toBeVisible();
    await expect(page.getByText("Sem lançamentos nesta semana")).toHaveCount(2);
    // Zero lançamento não é "abaixo da meta": nem selo vermelho, nem verde.
    await expect(page.getByText(/gargalo/i)).toHaveCount(0);
    await expect(page.getByText("No ritmo")).toHaveCount(0);
    // Gerente só vê o que lidera.
    await expect(page.getByText(/equipe paulista/i)).toHaveCount(0);
  });

  test("o card mostra o diário da semana e aponta o estágio abaixo da meta", async ({ page }) => {
    // Meta própria da Alfa, para o cálculo não depender da meta global (que
    // outro spec pode alterar): 20% dos leads em análise.
    await db.insert("funnel_targets", {
      scope: "team",
      team_id: alfa.id,
      lead_to_analysis_pct: 20,
      analysis_to_approval_pct: 40,
      approval_to_sale_pct: 50,
    });
    const [relatorio] = await db.insert<{ id: string }>("daily_reports", {
      team_id: alfa.id,
      report_date: hoje,
      submitted_by: managerId,
      submitted_at: new Date().toISOString(),
    });
    // 2 de 20 leads em análise = 10%, abaixo dos 20%; o resto do funil bate a meta.
    await db.insert("daily_entries", {
      report_id: relatorio.id,
      profile_id: brokerId,
      leads: 20,
      calls: 7,
      doc_collections: 3,
      analyses_sent: 2,
      analyses_approved: 2,
      sales: 2,
    });

    await page.goto("/checkpoint");
    await aguardarCarregamento(page);

    await expect(page.getByText("Gargalo: Análise Enviada")).toBeVisible();
    await expect(page.getByText("faltam 10.0pp para meta 20%")).toBeVisible();
    await expect(page.getByText("m20%")).toBeVisible();
    // A Beta continua sem lançamento — o estado é por equipe, não da semana.
    await expect(page.getByText("Sem lançamentos nesta semana")).toHaveCount(1);
  });

  /**
   * Papel é N:N (`user_roles`), e a tela decidia pelo papel PRIMÁRIO.
   *
   * Quem gerencia uma equipe e dirige outra caía num ramo só: as equipes do
   * outro papel sumiam da tela, embora `auth_led_team_ids()` — que é
   * `manager_id` OU `director_id` — libere as duas no banco. O recorte agora é
   * por liderança da equipe, como no banco (`checkpoint/visibility.ts`).
   *
   * A Beta vira diretoria do gerente só durante este caso; o `finally` devolve
   * o diretor E2E, que é o que os outros specs esperam.
   */
  test("quem gerencia uma equipe e dirige outra vê as duas", async ({ page }) => {
    const [betaAntes] = await db.select<{ director_id: string }>(`teams?id=eq.${beta.id}&select=director_id`);
    await db.update(`teams?id=eq.${beta.id}`, { director_id: managerId });

    try {
      await page.goto("/checkpoint");
      await aguardarCarregamento(page);

      // A equipe que ele DIRIGE entra no bloco de diretoria...
      await expect(page.getByText("Diretor: E2E Gerente")).toBeVisible();
      await expect(page.getByRole("button", { name: /ver gerentes \(1\)/i })).toBeVisible();
      // ...e a que ele apenas gerencia continua como card de equipe.
      await expect(cardDe(page, alfa)).toBeVisible();
    } finally {
      await db.update(`teams?id=eq.${beta.id}`, { director_id: betaAntes.director_id });
    }
  });

  /**
   * Equipe desativada: o quadro some com ela e a tela precisa dizer POR QUÊ.
   *
   * `auth_led_team_ids()` exige `teams.active`, então para o gerente o banco
   * simplesmente não entrega o diário da equipe desativada — sem aviso, os
   * lançamentos dela sumiriam do total da semana e o card ficaria zerado
   * dizendo "sem lançamentos", que é a mentira mais cara desta tela.
   *
   * O texto do aviso é o de quem LIDERA a equipe. Para admin, sócio e diretor
   * (`can_read_all()`) o banco não recorta nada, e o aviso não aparece — isso
   * está coberto papel a papel em `components/checkpoint/visibility.test.ts`.
   */
  test("equipe desativada sai do quadro e o aviso diz por quê", async ({ page }) => {
    await limparSemana();
    await db.update(`teams?id=eq.${beta.id}`, { active: false });

    try {
      await page.goto("/checkpoint");
      await aguardarCarregamento(page);

      await expect(cardDe(page, alfa)).toBeVisible();
      await expect(cardDe(page, beta), "equipe desativada não pode virar card zerado").toHaveCount(0);
      await expect(page.getByText(new RegExp(`${beta.name} está desativada`))).toBeVisible();
      await expect(page.getByText(/apenas de equipe ativa para quem a lidera/i)).toBeVisible();

      // O filtro não pode oferecer uma equipe que não está no quadro: escolhê-la
      // deixaria a tela vazia sem nada explicando o filtro.
      await page.getByRole("combobox", { name: "Filtrar equipe" }).click();
      await expect(page.getByRole("option", { name: beta.name })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } finally {
      await db.update(`teams?id=eq.${beta.id}`, { active: true });
    }
  });

  /**
   * O `?equipe=<id>` é o parâmetro do "manda o link" — e é aí que ele chega em
   * quem não lidera aquela equipe, ou depois de a equipe sair do quadro.
   *
   * Sem validação, o Radix voltava ao placeholder (nada dizia que havia filtro)
   * e o quadro caía no vazio "você não lidera nenhuma delas", diagnóstico errado
   * para quem lidera duas equipes.
   */
  test("filtro desconhecido no link não vira quadro vazio", async ({ page }) => {
    await page.goto("/checkpoint?equipe=00000000-0000-0000-0000-000000000000");
    await aguardarCarregamento(page);

    await expect(page.getByText(/o link trouxe um filtro de equipe que não está neste quadro/i)).toBeVisible();
    await expect(cardDe(page, alfa)).toBeVisible();
    await expect(cardDe(page, beta)).toBeVisible();
    await expect(page.getByText(/nenhuma equipe neste quadro/i)).toHaveCount(0);

    await page.getByRole("button", { name: /limpar filtro/i }).click();
    await expect(page).not.toHaveURL(/[?&]equipe=/);
    await expect(page.getByText(/o link trouxe um filtro de equipe/i)).toHaveCount(0);
  });

  test("gerente sem diretoria não vê o bloco de diretoria", async ({ page }) => {
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);

    await expect(cardDe(page, alfa)).toBeVisible();
    await expect(page.getByText(/^Diretor:/)).toHaveCount(0);
  });

  /**
   * Os estados de espera e de erro, pelo kit de `components/shared`.
   *
   * A tela desenhava os dois à mão: um `<div>` com spinner e um `Card` de texto
   * centralizado. O spinner sozinho não avisa ninguém — é o `LoadingState` que
   * traz `role="status"` + `aria-live` + rótulo, e sem ele quem usa leitor de
   * tela não recebia anúncio nenhum durante a carga da semana. E o erro sem tom
   * nem saída ficava indistinguível de um vazio comum.
   *
   * O GET de `teams` é segurado (fase de espera) e então respondido com erro
   * (fase de falha). `console.error` é da própria tela: a mensagem crua do
   * Postgres vai para o log, não para a tela.
   */
  test.describe(() => {
    test.use({ errosEsperados: [/status of 500|Failed to load resource|checkpoint: falha ao carregar a semana/i] });

    test("a espera é anunciada e o erro de leitura oferece saída", async ({ page }) => {
      let liberar: () => void = () => undefined;
      const preso = new Promise<void>((resolve) => { liberar = resolve; });
      await page.route("**/rest/v1/teams*", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await preso;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "erro simulado de leitura" }),
        });
      });

      await page.goto("/checkpoint");

      await expect(
        page.getByRole("status").filter({ hasText: /carregando o checkpoint da semana/i }),
        "esqueleto sem role=status é espera que só existe para quem enxerga",
      ).toBeVisible();

      liberar();

      await expect(page.getByText("Não foi possível carregar o checkpoint", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /tentar novamente/i })).toBeVisible();
      // Falha de leitura não é ausência de equipe.
      await expect(page.getByText(/nenhuma equipe/i)).toHaveCount(0);
    });
  });

  test("filtrar por equipe deixa só a escolhida", async ({ page }) => {
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);
    await expect(cardDe(page, alfa)).toBeVisible();

    await page.getByRole("combobox", { name: "Filtrar equipe" }).click();
    await page.getByRole("option", { name: beta.name }).click();

    await expect(cardDe(page, alfa)).toHaveCount(0);
    await expect(cardDe(page, beta)).toBeVisible();
  });

  /**
   * A semana vivia só em `useState`.
   *
   * Numa tela de reunião isso custa caro: F5 ou link mandado para o diretor
   * abriam sempre na semana corrente, e a pessoa tinha de renavegar até a
   * semana de que se estava falando. Agora a segunda-feira exibida está na URL,
   * e é dela que a tela parte.
   */
  test("a semana escolhida fica na URL e sobrevive ao F5", async ({ page }) => {
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: "Semana anterior" }).click();
    await expect(page).toHaveURL(/[?&]semana=\d{4}-\d{2}-\d{2}/);
    const url = page.url();
    const periodo = await page.getByText(/^\d{2} \S+ — \d{2} \S+ \d{4}$/).first().textContent();

    await page.reload();
    await aguardarCarregamento(page);
    await expect(page.getByText(periodo!.trim(), { exact: true })).toBeVisible();

    // E o link aberto do zero cai na mesma semana — é o caso do "manda o link".
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);
    await expect(page.getByText(periodo!.trim(), { exact: true })).toHaveCount(0);
    await page.goto(url);
    await aguardarCarregamento(page);
    await expect(page.getByText(periodo!.trim(), { exact: true })).toBeVisible();
  });

  /**
   * Visitas são coletadas no Diário desde a 0009 e não apareciam em lugar
   * nenhum do Checkpoint — o SELECT da tela nem as pedia. Ficam como chip, fora
   * do funil: `funnel_targets` não tem meta de visita, e inventar uma coluna de
   * conversão para elas seria inventar a meta junto.
   */
  test("as visitas do diário aparecem no card da equipe", async ({ page }) => {
    await limparSemana();
    const [relatorio] = await db.insert<{ id: string }>("daily_reports", {
      team_id: alfa.id,
      report_date: hoje,
      submitted_by: managerId,
      submitted_at: new Date().toISOString(),
    });
    await db.insert("daily_entries", {
      report_id: relatorio.id,
      profile_id: brokerId,
      leads: 12, calls: 5, doc_collections: 2,
      visits_scheduled: 9, visits_done: 6,
      analyses_sent: 3, analyses_approved: 2, sales: 1,
    });

    try {
      await page.goto("/checkpoint");
      await aguardarCarregamento(page);

      // O chip é um span com rótulo e número dentro; casar os dois juntos
      // separa o valor da Alfa do zero que a Beta mostra no card ao lado.
      const chip = (rotulo: string, valor: number) =>
        page.locator("span").filter({ hasText: new RegExp(`^${rotulo}\\s*${valor}$`) }).first();
      await expect(chip("Visitas agendadas", 9)).toBeVisible();
      await expect(chip("Visitas feitas", 6)).toBeVisible();
      // Visita não entra no funil: não pode virar gargalo nem meta.
      await expect(page.getByText(/gargalo: visitas/i)).toHaveCount(0);
    } finally {
      await limparSemana();
    }
  });

  /**
   * Exportar: até aqui, levar o quadro para a ata era copiar card por card.
   *
   * O conteúdo do CSV está coberto em `components/checkpoint/export.test.ts`; o
   * que só o E2E prova é que o botão existe na tela e produz mesmo um arquivo.
   */
  test("o botão Exportar CSV entrega o arquivo da semana", async ({ page }) => {
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /exportar csv/i }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^checkpoint_\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

/**
 * A tela é de reunião e também é aberta no celular.
 *
 * O transbordo de 137 px a 375 px foi corrigido à mão em 27/08 e não deixou
 * regressão nenhuma para trás — e os controles do cabeçalho só cresceram desde
 * então (Atualizar, Exportar CSV).
 */
test.describe("checkpoint no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("/checkpoint cabe em 375 px sem rolar a página na horizontal", async ({ page }) => {
    await page.goto("/checkpoint");
    await aguardarCarregamento(page);

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // Quando estoura, dizer QUEM estoura: o número sozinho não distingue o
    // cabeçalho de um card e a investigação recomeça do zero.
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
    expect(transbordo, `o checkpoint rola na horizontal em 375 px${culpado}`).toBeLessThanOrEqual(1);
  });
});
