import { test, expect, db, runTag } from "../support/fixtures";

/**
 * Checkpoint da diretoria sem sessão — `/diretor/:slug`.
 *
 * A terceira RPC da superfície anônima (`public_director_checkpoint`) devolve o
 * funil da semana por equipe do diretor e os dias sem preenchimento — é o que
 * sustenta a cobrança da reunião de segunda-feira.
 */

const PIN = "123456";
const PIN_HASH = "$2a$06$On6loHaQgXqIOl9PmZJkGewH/uNU0GARZ.qwUqc.irdujr38Di1xi";

// A diretora do seed, dona da Equipe Paulista e da Equipe Sul. O link do seed
// (`seed-diretoria-daniela`) NÃO é usado aqui: os quatro links públicos ganharam
// PIN (decisão de 26/08 — o slug era, na prática, a senha), e o PIN de um link do
// seed não pode ser versionado. Todo cenário abre o link próprio criado abaixo.
const DIRETORA = "Daniela Diretora";
const DIRETORA_ID = "10000000-0000-0000-0000-000000000002";

// Gerente do seed (Equipe Paulista); vira gerente das equipes temporárias.
const GERENTE_ID = "10000000-0000-0000-0000-000000000003";

const tag = runTag();
const slugComPin = `diretoria-${tag}`;
// Duas equipes só deste teste, sob a mesma diretora: uma sem link e sem
// checkpoint (pendência garantida), outra com um lançamento de hoje (visitas).
const equipeSemLink = `Equipe Sem Link ${tag}`;
const equipeComDados = `Equipe Com Dados ${tag}`;
// Link só do cenário de trava: cinco PINs errados fecham o link por 15 minutos.
const slugTrava = `diretoria-trava-${tag}`;
// Link com validade curta: é o que faz a tela avisar ANTES de o link parar de
// abrir. Vencido, ele cairia na mesma recusa NULL de PIN errado (0033/0062).
const slugVence = `diretoria-vence-${tag}`;
/**
 * Link do Diário da MESMA equipe que aparece no checkpoint.
 *
 * É o que permite comparar os dois caminhos que somam os mesmos 8 números do
 * mês: `aggregateMonth` no cliente (Diário) e `sum()` no SQL (checkpoint).
 */
const slugDiario = `diario-cruzado-${tag}`;
/** Meta DA EQUIPE (0062): `funnel_targets.team_id` estava no banco e ninguém lia. */
const META_EQUIPE = { analises: 17, aprovados: 47, vendas: 57 };
let gerenteNome = "";
let idsEquipes: string[] = [];
let idEquipeComDados = "";

test.beforeAll(async () => {
  // As TRÊS linhas repetem as MESMAS chaves, `expires_at` inclusive: num insert
  // em lote o PostgREST monta um `INSERT` só e recusa com PGRST102 quando um
  // objeto traz chave que os outros não têm.
  await db.insert("public_links", [
    {
      kind: "director_checkpoint", director_id: DIRETORA_ID, slug: slugComPin,
      pin_hash: PIN_HASH, active: true, expires_at: null,
    },
    {
      kind: "director_checkpoint", director_id: DIRETORA_ID, slug: slugTrava,
      pin_hash: PIN_HASH, active: true, expires_at: null,
    },
    {
      kind: "director_checkpoint", director_id: DIRETORA_ID, slug: slugVence,
      pin_hash: PIN_HASH, active: true,
      expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    },
  ]);

  const [gerente] = await db.select<{ full_name: string }>(`profiles?id=eq.${GERENTE_ID}&select=full_name`);
  gerenteNome = gerente.full_name;

  const equipes = await db.insert<{ id: string; name: string }>("teams", [
    { name: equipeSemLink, slug: `equipe-sem-link-${tag}`, director_id: DIRETORA_ID, manager_id: GERENTE_ID },
    { name: equipeComDados, slug: `equipe-com-dados-${tag}`, director_id: DIRETORA_ID, manager_id: GERENTE_ID },
  ]);
  idsEquipes = equipes.map((e) => e.id);

  const hoje = await db.rpc<string>("current_work_date");
  const comDados = equipes.find((e) => e.name === equipeComDados)!;
  idEquipeComDados = comDados.id;

  // `funnel_targets` cascateia com a equipe; o afterAll já a remove.
  await db.insert("funnel_targets", {
    scope: "team",
    team_id: comDados.id,
    lead_to_analysis_pct: META_EQUIPE.analises,
    analysis_to_approval_pct: META_EQUIPE.aprovados,
    approval_to_sale_pct: META_EQUIPE.vendas,
  });
  const [relatorio] = await db.insert<{ id: string }>("daily_reports", {
    team_id: comDados.id, report_date: hoje, submitted_at: new Date().toISOString(),
  });
  await db.insert("daily_entries", {
    report_id: relatorio.id, profile_id: GERENTE_ID, visits_scheduled: 3, visits_done: 2,
  });

  // Insert à parte: `daily_team` traz `team_id` onde os três de cima trazem
  // `director_id`, e num insert em lote o PostgREST recusa com PGRST102 quando
  // as chaves não batem entre os objetos.
  await db.insert("public_links", {
    kind: "daily_team", team_id: comDados.id, slug: slugDiario,
    pin_hash: PIN_HASH, active: true, expires_at: null,
  });
});

test.afterAll(async () => {
  await db.remove(`public_links?slug=eq.${slugComPin}`);
  await db.remove(`public_links?slug=eq.${slugTrava}`);
  await db.remove(`public_links?slug=eq.${slugVence}`);
  // teams cascateia daily_reports e daily_entries.
  if (idsEquipes.length) await db.remove(`teams?id=in.(${idsEquipes.join(",")})`);
});

/**
 * Valor de um dos oito quadros do "Resumo do mês".
 *
 * A tela formata com `num` (pt-BR): "1.234,5" é mil duzentos e trinta e quatro
 * e meio, não 1,234.
 */
async function valorDoMes(page: import("@playwright/test").Page, rotulo: string) {
  const texto = await page.getByText(rotulo, { exact: true }).locator("xpath=following-sibling::p").innerText();
  return Number(texto.replace(/\./g, "").replace(",", "."));
}

async function abrirComPin(page: import("@playwright/test").Page) {
  await page.goto(`/diretor/${slugComPin}`);
  await page.getByLabel("PIN da diretoria").fill(PIN);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByText(DIRETORA)).toBeVisible();
}

/**
 * Abre as pendências da SEMANA ANTERIOR, que é o único recorte com os cinco
 * dias úteis garantidos.
 *
 * A semana corrente não serve de fixture: a RPC para em `current_date - 1`
 * (hoje ainda está aberto para preencher), e na SEGUNDA-FEIRA isso deixa a
 * semana sem nenhum dia cobrável — o botão nem é renderizado e o cenário
 * estouraria por timeout um dia em sete, justamente no dia da reunião.
 */
async function abrirPendencias(page: import("@playwright/test").Page) {
  await abrirComPin(page);
  await page.getByRole("button", { name: /semana anterior/i }).click();
  await page.getByRole("button", { name: /não efetuados na semana/i }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo.getByText(/pendências da semana/i)).toBeVisible();
  return dialogo;
}

test.describe("checkpoint público da diretoria", () => {
  test("link real abre sem sessão e sem desvio para o login", async ({ page }) => {
    // Link protegido por PIN de propósito: sem PIN a RPC responde 200 com
    // `pin_required`, sem 4xx no console — a tela mostra o cabeçalho e o cartão
    // de PIN, não a tela de login.
    await page.goto(`/diretor/${slugComPin}`);

    await expect(page.getByRole("heading", { name: /checkpoint semanal — diretor/i })).toBeVisible();
    expect(page.url()).not.toContain("/login");
  });

  test("slug inexistente pede PIN igual a slug existente — sem oráculo", async ({ page }) => {
    // Antes o slug existente respondia `pin_required` e o inexistente `null`:
    // a diferença confirmava, para um anônimo, quais links existem — e confirmar
    // o slug é entregar metade do segredo (0033). A 0062 igualou as respostas.
    //
    // A asserção que separa os dois mundos é a da PRIMEIRA carga: sem a 0062 o
    // slug inexistente cai no `null` e a tela já escreve "Não abriu" antes de
    // qualquer PIN, enquanto o slug existente só pede o PIN. Cobrar apenas a
    // segunda tela (depois do PIN) passava com ou sem a migration, porque a
    // tela mapeia `null` e `pin_required` para o mesmo cartão.
    await page.goto(`/diretor/nao-existe-${tag}`);

    await expect(page.getByLabel("PIN da diretoria")).toBeVisible();
    await expect(page.getByText(/não abriu/i)).toHaveCount(0);
    await expect(page.getByText(DIRETORA)).toHaveCount(0);
    await expect(page.getByText(/equipe paulista/i)).toHaveCount(0);

    // O slug que existe tem de responder exatamente igual na primeira carga.
    await page.goto(`/diretor/${slugComPin}`);
    await expect(page.getByLabel("PIN da diretoria")).toBeVisible();
    await expect(page.getByText(/não abriu/i)).toHaveCount(0);

    // E com PIN os dois recusam pela mesma porta: NULL, sem dizer qual é qual.
    await page.goto(`/diretor/nao-existe-${tag}`);
    await page.getByLabel("PIN da diretoria").fill(PIN);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByText(/não abriu/i)).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);
  });

  test("PIN curto demais não gasta uma das cinco tentativas", async ({ page }) => {
    // 6 a 10 dígitos é a regra do servidor (0062): abaixo disso o PIN não pode
    // existir, e a tentativa impossível ainda era contada pelo lockout da 0033.
    const tentativas = async () => {
      const [link] = await db.select<{ failed_attempts: number }>(
        `public_links?slug=eq.${slugComPin}&select=failed_attempts`,
      );
      return link.failed_attempts;
    };
    const antes = await tentativas();

    await page.goto(`/diretor/${slugComPin}`);
    await page.getByLabel("PIN da diretoria").fill("99999");

    await expect(page.getByRole("button", { name: /entrar/i })).toBeDisabled();
    expect(await tentativas()).toBe(antes);
  });

  test("link desativado recusa com a mesma mensagem do slug inexistente", async ({ page }) => {
    // Sem oráculo: quem tenta adivinhar slug não descobre quais existem.
    await db.update(`public_links?slug=eq.${slugComPin}`, { active: false });
    await page.goto(`/diretor/${slugComPin}`);

    await expect(page.getByLabel("PIN da diretoria")).toBeVisible();
    await page.getByLabel("PIN da diretoria").fill(PIN);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByText(/não abriu/i)).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);

    await db.update(`public_links?slug=eq.${slugComPin}`, { active: true });
  });

  test("cinco PINs errados travam o link e a tela explica a espera", async ({ page }) => {
    // Depois do quinto erro nem o PIN certo abre por 15 minutos, e a tela dizia
    // só "PIN incorreto": o diretor redigitava um PIN válido sem entender.
    await page.goto(`/diretor/${slugTrava}`);
    const campo = page.getByLabel("PIN da diretoria");
    await expect(campo).toBeVisible();

    // O contador do banco é o relógio deste laço: esperar só a mensagem não
    // prova que a tentativa chegou ao servidor.
    for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
      await campo.fill("999999");
      await page.getByRole("button", { name: /entrar/i }).click();
      await expect(async () => {
        const [link] = await db.select<{ failed_attempts: number; locked_until: string | null }>(
          `public_links?slug=eq.${slugTrava}&select=failed_attempts,locked_until`,
        );
        // No quinto erro a 0033 zera a contagem junto com a trava.
        if (tentativa < 5) expect(link.failed_attempts).toBe(tentativa);
        else expect(link.locked_until, "o quinto erro tem de gravar a trava").not.toBeNull();
      }).toPass({ timeout: 15_000 });
    }
    await expect(page.getByText(/bloqueado por 15 minutos/i)).toBeVisible();

    await campo.fill(PIN);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByText(/bloqueado por 15 minutos/i)).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);
  });

  // Regressões da migration 0009 cobertas pela 0026: volatilidade correta,
  // contrato director/team_id/team_name e PIN antes de qualquer dado sensível.
  test("depois do PIN mostra o diretor, as equipes e o funil da semana", async ({ page }) => {
    // `abrirComPin` já cobre o diretor visível; o que este cenário guarda é o
    // conteúdo: as duas equipes do seed e o resumo do funil.
    await abrirComPin(page);

    // Equipe com link é LINK, não botão: "Preencher meu daily" navega para
    // `/daily/:slug`. Antes era um `<button>` dentro de um `<a>` — inválido em
    // HTML, com uma parada de tabulação a mais que não fazia nada.
    await expect(page.getByRole("link", { name: /equipe paulista/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /equipe sul/i })).toBeVisible();
    await expect(page.getByText(/nenhuma equipe vinculada/i)).toHaveCount(0);

    // O funil da semana é o motivo da tela existir.
    await expect(page.getByText(/leads → análises/i)).toBeVisible();
  });

  test("link com PIN pede o PIN antes de mostrar o funil", async ({ page }) => {
    // O payload `pin_required` não inclui diretor, equipes nem totais.
    await page.goto(`/diretor/${slugComPin}`);

    const campoPin = page.getByLabel("PIN da diretoria");
    await expect(campoPin).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);

    await campoPin.fill(PIN);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByText(DIRETORA)).toBeVisible();
    await expect(page.getByRole("link", { name: /equipe paulista/i })).toBeVisible();
  });

  test("equipe sem link público não ganha botão que leva a uma URL morta", async ({ page }) => {
    // O slug é sorteado no banco (0033): derivá-lo do nome mandava o diretor
    // para uma tela de PIN que nunca aceita PIN nenhum.
    await abrirComPin(page);

    // Sem link não há para onde ir: segue botão, e desabilitado.
    await expect(page.getByRole("button", { name: new RegExp(equipeSemLink, "i") })).toBeDisabled();
    await expect(page.getByRole("link", { name: /equipe paulista/i })).toHaveAttribute("href", /^\/daily\//);
  });

  test("cada equipe é cobrada pela meta dela, com a origem escrita", async ({ page }) => {
    // A RPC só lia `scope='director'`/`'global'` e a tela aplicava a mesma régua
    // a todas as equipes: as metas por equipe do seed nunca apareciam.
    await abrirComPin(page);

    await expect(
      page.getByText(new RegExp(`meta da equipe: ${META_EQUIPE.analises}% → ${META_EQUIPE.aprovados}% → ${META_EQUIPE.vendas}%`)),
    ).toBeVisible();
    // E a equipe sem meta própria continua na régua do diretor (ou da empresa).
    await expect(page.getByText(/meta da (diretoria|empresa)/i).first()).toBeVisible();
  });

  test("pendências da semana só cobram dia útil", async ({ page }) => {
    // Fim de semana entrava na cobrança e a lista abria cheia de dias em que
    // ninguém deveria lançar; cobrança que sempre acusa deixa de ser lida.
    const dialogo = await abrirPendencias(page);

    await expect(dialogo.getByText(/\(sábado\)|\(domingo\)/i)).toHaveCount(0);
  });

  test("pendências da semana dizem qual gerente cobrar", async ({ page }) => {
    const dialogo = await abrirPendencias(page);

    await expect(dialogo.getByText(gerenteNome).first()).toBeVisible();
    await expect(dialogo.getByText(equipeSemLink).first()).toBeVisible();
  });

  test("resumo do mês soma o mês inteiro, visitas incluídas", async ({ page }) => {
    await abrirComPin(page);

    await expect(page.getByText(/funil acumulado — mês de/i)).toBeVisible();
    await expect(page.getByText(/resumo do mês/i)).toBeVisible();

    // Os dois quadros de visita ficavam em 0 para sempre: a RPC mandava e a
    // tela descartava. Só o lançamento de hoje da equipe temporária já dá 3/2.
    expect(await valorDoMes(page, "Visita Agend.")).toBeGreaterThanOrEqual(3);
    expect(await valorDoMes(page, "Visita Real.")).toBeGreaterThanOrEqual(2);
  });

  test("o mês do Diário e o mês do Checkpoint somam a mesma coisa para a mesma equipe", async ({ page }) => {
    // As MESMAS 8 métricas são somadas por dois caminhos independentes — no
    // cliente pelo `aggregateMonth` do Diário e no SQL pelo `sum()` da RPC da
    // diretoria — e nada comparava um resultado com o outro. Divergir aqui é a
    // pior falha do módulo: a diretoria cobra em cima de um número que a equipe
    // não vê na tela dela.
    //
    // A comparação é por DELTA, não por valor absoluto: o resumo da diretoria é
    // a soma de TODAS as equipes do diretor e o Diário é de uma só. O que tem
    // que bater é o quanto cada lado se mexe quando entra um lançamento.
    const hoje = await db.rpc<string>("current_work_date");
    const [ano, mes, dia] = hoje.split("-").map(Number);
    const ocupados = new Set(
      (await db.select<{ report_date: string }>(
        `daily_reports?team_id=eq.${idEquipeComDados}&select=report_date`,
      )).map((r) => r.report_date),
    );
    // Um dia útil já passado do mês corrente e ainda sem relatório desta
    // equipe: é o que prova que os dois lados cobrem a MESMA janela (dia 1 até
    // hoje), e não só o dia de hoje.
    let alvo = "";
    for (let d = 1; d < dia; d += 1) {
      const data = new Date(Date.UTC(ano, mes - 1, d));
      const semana = data.getUTCDay();
      const iso = data.toISOString().slice(0, 10);
      if (semana !== 0 && semana !== 6 && !ocupados.has(iso)) { alvo = iso; break; }
    }
    test.skip(!alvo, "não sobrou dia útil livre no mês para o lançamento do cruzamento");

    const VISITAS = 7;

    const mesDoDiario = async () => {
      await page.goto(`/daily/${slugDiario}`);
      await page.getByLabel("PIN da equipe").fill(PIN);
      await page.getByRole("button", { name: /entrar na missão/i }).click();
      // O mesmo título aparece no funil compacto e no card do mês: `.first()`.
      await expect(page.getByText(/funil do mês — acumulado/i).first()).toBeVisible();
      return valorDoMes(page, "Visita Agend.");
    };

    const antesDiretoria = await (async () => { await abrirComPin(page); return valorDoMes(page, "Visita Agend."); })();
    const antesDiario = await mesDoDiario();

    const [extra] = await db.insert<{ id: string }>("daily_reports", {
      team_id: idEquipeComDados, report_date: alvo, submitted_at: new Date().toISOString(),
      filled_by_name: `Cruzamento ${tag}`,
    });
    try {
      await db.insert("daily_entries", {
        report_id: extra.id, profile_id: GERENTE_ID, visits_scheduled: VISITAS,
      });

      const depoisDiretoria = await (async () => { await abrirComPin(page); return valorDoMes(page, "Visita Agend."); })();
      const depoisDiario = await mesDoDiario();

      expect(depoisDiario - antesDiario).toBe(VISITAS);
      // A asserção do módulo: os dois caminhos enxergam o mesmo lançamento, na
      // mesma janela, com o mesmo peso.
      expect(depoisDiretoria - antesDiretoria).toBe(depoisDiario - antesDiario);
    } finally {
      // O relatório sai daqui e não do afterAll: sem isso, uma segunda execução
      // no mesmo dia esbarraria no unique (team_id, report_date) e o delta viria
      // zero — o cenário passaria a medir nada.
      await db.remove(`daily_reports?id=eq.${extra.id}`);
    }
  });

  test("desativar uma equipe não apaga o que ela produziu no mês", async ({ page }) => {
    // O acumulado do mês filtrava `t.active`: desativar a equipe em 20/09
    // apagava retroativamente tudo o que ela lançou desde o dia 1. O mês é
    // histórico — a soma não pode encolher.
    await abrirComPin(page);
    const antes = await valorDoMes(page, "Visita Agend.");

    await db.update(`teams?id=eq.${idEquipeComDados}`, { active: false });
    try {
      await page.reload();
      await page.getByLabel("PIN da diretoria").fill(PIN);
      await page.getByRole("button", { name: /entrar/i }).click();
      await expect(page.getByText(DIRETORA)).toBeVisible();

      // Nunca menor: outro agente pode ter somado algo no intervalo, mas o que
      // a equipe desativada produziu continua contado.
      expect(await valorDoMes(page, "Visita Agend.")).toBeGreaterThanOrEqual(antes);
      await expect(page.getByText(/inclui 1 equipe já desativada/i)).toBeVisible();
      // E a equipe sai da lista da semana: a cobrança é do time atual.
      await expect(page.getByRole("button", { name: new RegExp(equipeComDados, "i") })).toHaveCount(0);
    } finally {
      await db.update(`teams?id=eq.${idEquipeComDados}`, { active: true });
    }
  });

  test("avisa que o link vence antes de ele parar de abrir", async ({ page }) => {
    // Só o Diário da equipe avisava (0062). Deste lado o diretor descobria o
    // vencimento pelo mesmo "PIN incorreto" de PIN errado, e ficava
    // redigitando um PIN válido. O aviso vem de `expires_at` na RPC (0080).
    await page.goto(`/diretor/${slugVence}`);
    await page.getByLabel("PIN da diretoria").fill(PIN);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByText(DIRETORA)).toBeVisible();

    await expect(page.getByText(/este link vence em \d+ dias?/i)).toBeVisible();
    await expect(page.getByText(/peça a renovação à administração/i)).toBeVisible();
  });

  test("o link do Diário não promete o mês que está na tela", async ({ page }) => {
    // "Mês" quer dizer coisas diferentes nas duas telas: aqui acompanha a
    // semana navegada, no Diário público é sempre o corrente. Navegar para
    // agosto e clicar em "Abrir Diário" mostrava setembro, sem uma palavra.
    //
    // O aviso sai do recorte que a RPC devolveu (`month.start`), não do começo
    // da semana: os dois divergem justamente na semana que atravessa a virada
    // do mês (em 02/09, semana de 31/08, a RPC ancora em 01/09), e a versão
    // anterior acusava divergência na visão PADRÃO, sem ninguém ter navegado —
    // ~12 semanas por ano em que esta primeira asserção falharia.
    await abrirComPin(page);
    await expect(page.getByText(/o diário abre sempre no mês corrente/i)).toHaveCount(0);

    // Cinco semanas atrás cai em outro mês em qualquer dia do calendário.
    for (let volta = 0; volta < 5; volta += 1) {
      await page.getByRole("button", { name: /semana anterior/i }).click();
    }
    await expect(page.getByText(DIRETORA)).toBeVisible();

    await expect(page.getByText(/o diário abre sempre no mês corrente/i)).toBeVisible();

    await page.getByRole("button", { name: /^hoje$/i }).click();
    await expect(page.getByText(/o diário abre sempre no mês corrente/i)).toHaveCount(0);
  });

  test.describe("sem rede", () => {
    // A falha da RPC é registrada no console (diagnóstico: 42501 e PGRST202 não
    // podem virar "erro de rede" no log também) e declarada aqui. Os dois padrões
    // vão em UM RegExp com alternância dentro de uma lista de um item: `[/a/, /b/]`
    // seria lido pelo Playwright como a tupla `[valor, opções]` e o segundo padrão
    // sumiria em silêncio (ver `errosEsperados` em support/fixtures.ts).
    test.use({ errosEsperados: [/falha na RPC|Failed to fetch/i] });

    test("erro de rede não vira 'link inválido'", async ({ page, context }) => {
      // Rede e link inválido seguem mensagens diferentes; nenhum erro interno do
      // Postgres é exibido ao visitante.
      await abrirComPin(page);
      await context.setOffline(true);
      await page.getByRole("button", { name: /semana anterior/i }).click();

      await expect(page.getByText(/erro de conexão|tente novamente/i)).toBeVisible();
      await expect(page.getByText(/link inválido ou inativo/i)).toHaveCount(0);

      await context.setOffline(false);
    });
  });
});
