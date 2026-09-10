import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";
import { opcoesDe, seletor } from "../helpers/negocio";

/**
 * Fechamento de mês — ata de 14/07: "fechamento que não dependa do calendário
 * tradicional… essa ação deverá congelar os dados do período anterior e
 * preparar o sistema para o novo ciclo".
 *
 * O botão fazia três operações soltas no navegador (mover propostas, gravar o
 * mês, encerrar o jogo). Uma falha no meio deixava proposta migrada com o mês
 * ainda aberto. Hoje é `close_month_and_season()`, uma transação só — então o
 * teste cobra os TRÊS efeitos no banco, não o toast.
 *
 * **Como o mês é escolhido mudou (migration `0032` + Tarefa H).** Antes o mês
 * saía do campo de texto do filtro; hoje sai da **temporada aberta do game**, e
 * o diálogo mostra qual período vai congelar antes de confirmar. Digitar no
 * filtro deixou de ter efeito aqui — de propósito: fechar um mês diferente do
 * ciclo deixaria o ciclo aberto para sempre com os negócios dele fora do
 * congelamento. Por isso o cenário passou a mover a temporada, não o filtro.
 *
 * Mês escolhido de propósito: 10/2026 é futuro e não tem negócio de ninguém.
 * Fechar 08/2026 travaria a edição de negócios para os outros specs que rodam
 * ao mesmo tempo neste banco.
 */
/**
 * **O fechamento não roda no alvo remoto — de propósito. A REABERTURA roda.**
 *
 * O `test.skip` era do ARQUIVO inteiro, e por isso o alvo remoto não tinha
 * nenhuma cobertura de fim de mês: nem a que arrisca o pódio (fechar) nem a que
 * não arrisca nada (reabrir). Ele passou para dentro do `describe` que mexe na
 * temporada; o `describe` da reabertura roda nos dois alvos, porque só toca
 * `closed_months` num mês sem negócio e sem ciclo de jogo.
 *
 * Ele é o único da suíte que encerra a temporada aberta do game: o `beforeAll`
 * move `period_start` da temporada corrente para 10/2026, o teste a fecha e o
 * `afterAll` desfaz os três passos. O `afterAll` só existe se a execução chegar
 * até ele. Uma interrupção no meio (Ctrl+C, queda do processo, timeout global)
 * deixa a homologação com a temporada de agosto **fechada** e o pódio da
 * demonstração vazio — e o `globalTeardown` não tem como consertar, porque ele
 * não sabe qual era o `period_start` de antes.
 *
 * Pular aqui é a alternativa honesta: cobrir configuração remota não paga
 * arriscar o pódio da demonstração. O fechamento continua coberto no alvo
 * local, contra o mesmo código e o mesmo schema. Está registrado no handoff-P.
 */
const REMOTO = resolveTarget().name === "remote";

const tag = runTag();
const MES = "10/2026";
const ISO = "2026-10-01";
const ISO_SEGUINTE = "2026-11-01";

/** Regra padrão exclusiva desta execução: o 4º teste muda o peso dela pelo diálogo. */
const codigoPeso = `${tag}-peso`;
const rotuloPeso = `Peso E2E ${tag}`;
const PESO_INICIAL = 5;
const PESO_NOVO = 55;

let negocioAberto: string;
let negocioGanho: string;
let temporadaAntes: string;
let inicioAntes: string;
/** Temporadas que já existiam: tudo que nascer durante o cenário é apagado no fim. */
let idsAntes: Set<string> | null = null;

async function criarNegocio(rotulo: string, ganho: boolean): Promise<string> {
  const [etapa] = await db.select<{ id: string }>(
    `pipeline_stages?code=eq.${ganho ? "closed" : "proposal"}&select=id`,
  );
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    month_base: ISO,
    outcome: ganho ? "won" : "open",
    closed_at: ganho ? new Date().toISOString() : null,
    vgv_gross: 400000,
    status_detail: ganho ? "VENDA" : "PROPOSTA",
    notes: tag,
  });
  await db.insert("deal_clients", {
    deal_id: deal.id,
    ordinal: 1,
    full_name: `${rotulo}-${tag}`,
  });
  return deal.id;
}

test.describe("fechamento de mês", () => {
  // Só este bloco mexe na temporada aberta do game: o `beforeAll` move o
  // `period_start` e o `afterAll` desfaz. Uma interrupção no meio deixaria a
  // homologação com a temporada fechada e o pódio da demonstração vazio — e o
  // `globalTeardown` não sabe qual era o `period_start` de antes.
  test.skip(REMOTO, "fecha a temporada aberta do game: uma interrupção deixaria o alvo remoto sem pódio");

  test.beforeAll(async () => {
    const jaFechado = await db.select(`closed_months?period=eq.${ISO}&select=period`);
    if (jaFechado.length) {
      throw new Error(`${MES} já está em closed_months — outro teste não limpou; reabra antes de rodar`);
    }

    negocioAberto = await criarNegocio("ABERTO", false);
    negocioGanho = await criarNegocio("GANHO", true);

    idsAntes = new Set((await db.select<{ id: string }>("game_seasons?select=id")).map((s) => s.id));
    await db.insert("game_scoring_rules", {
      season_id: null,
      event_code: codigoPeso,
      label: rotuloPeso,
      points: PESO_INICIAL,
      active: true,
    });

    const [temporada] = await db.select<{ id: string; period_start: string }>(
      "game_seasons?closed_at=is.null&select=id,period_start&order=period_start.desc&limit=1",
    );
    temporadaAntes = temporada.id;
    inicioAntes = temporada.period_start;

    // É a temporada aberta que define o mês a fechar. Movê-la para 10/2026 é o
    // que faz a tela oferecer justamente o mês vazio deste cenário.
    await db.update(`game_seasons?id=eq.${temporadaAntes}`, { period_start: ISO });
  });

  /**
   * Devolve o banco ao estado anterior: o mês reabre, a temporada nova some e a
   * original volta a ser a aberta. A ordem importa — o índice único
   * `game_seasons_one_open` não aceita duas temporadas abertas ao mesmo tempo.
   */
  test.afterAll(async () => {
    await db.remove(`closed_months?period=eq.${ISO}`);
    // O DELETE acima é limpeza, não reabertura — mas o gatilho
    // `closed_months_log_reopen` (0076) não distingue os dois e grava a linha
    // com `reopened_by` nulo. Sem isto, cada execução da suíte enche de
    // reabertura fantasma a tabela que a diretoria lê. O `catch` cobre o banco
    // que ainda não tem a migration.
    await db.remove(`month_reopenings?period=eq.${ISO}`).catch(() => undefined);

    // Toda temporada nascida no cenário some — a que o 1º teste abriu e a que o
    // 4º abriu ao encerrá-la; results e events caem em cascata. Só as que já
    // existiam ficam, e a original reabre por último.
    if (idsAntes) {
      const todas = await db.select<{ id: string }>("game_seasons?select=id");
      for (const s of todas) {
        if (!idsAntes.has(s.id)) await db.remove(`game_seasons?id=eq.${s.id}`);
      }
    }
    await db.remove(`game_season_results?season_id=eq.${temporadaAntes}`);
    await db.update(`game_seasons?id=eq.${temporadaAntes}`, {
      closed_at: null,
      period_end: null,
      closed_by: null,
      period_start: inicioAntes,
    });

    await db.remove(`game_scoring_rules?event_code=eq.${codigoPeso}`);
    await db.remove(`deals?notes=eq.${tag}`);
  });

  test("fecha o mês, migra as propostas e encerra a temporada na mesma ação", async ({ page }) => {
    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /^fechar mês$/i }).click();

    // O diálogo escreve o período ANTES de confirmar, com a origem: o operador
    // precisa ver qual mês vai congelar, não deduzir (Tarefa H).
    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo).toContainText(MES);
    await expect(dialogo).toContainText(ISO_SEGUINTE.slice(5, 7) + "/" + ISO_SEGUINTE.slice(0, 4));

    // O botão de confirmar carrega o período no nome: quem aperta lê o mês que
    // vai congelar, e o teste falha se a tela oferecer fechar outro.
    await page.getByRole("button", { name: `Fechar ${MES}`, exact: true }).click();

    await expect(page.getByText(`Mês ${MES} fechado`)).toBeVisible();

    // (b) o período ficou congelado
    await expect
      .poll(async () => (await db.select(`closed_months?period=eq.${ISO}&select=period`)).length)
      .toBe(1);

    // (a) proposta aberta anda para o mês seguinte; resultado do mês fica
    const [aberto] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioAberto}&select=month_base`,
    );
    const [ganho] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioGanho}&select=month_base`,
    );
    expect(aberto.month_base).toBe(ISO_SEGUINTE);
    expect(ganho.month_base).toBe(ISO);

    // (c) a temporada do jogo encerrou junto, com o placar congelado
    const [temporada] = await db.select<{ closed_at: string | null; period_end: string | null }>(
      `game_seasons?id=eq.${temporadaAntes}&select=closed_at,period_end`,
    );
    expect(temporada.closed_at).not.toBeNull();
    expect(temporada.period_end).not.toBeNull();

    const congelado = await db.select(
      `game_season_results?season_id=eq.${temporadaAntes}&select=profile_id,rank,points`,
    );
    expect(congelado.length).toBeGreaterThan(0);

    // …e o próximo ciclo já nasceu aberto — sem isso o jogo pararia.
    const abertas = await db.select<{ id: string }>("game_seasons?closed_at=is.null&select=id");
    expect(abertas).toHaveLength(1);
    expect(abertas[0].id).not.toBe(temporadaAntes);
  });

  /**
   * **Mudou o critério, de propósito.** O botão morria quando o mês da
   * temporada aberta já estava fechado — e era exatamente aí que 08/2026, com
   * 26 dos 32 negócios da homologação, ficava sem nenhuma tela capaz de
   * congelá-lo: os dois relógios (mês e temporada) saem de fase sozinhos
   * quando a Gamificação encerra a temporada sem fechar o mês. Agora o mês
   * fechado some da LISTA e o botão só morre quando não sobra nenhum mês.
   */
  test("a tela não oferece de novo o mês já fechado", async ({ page }) => {
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);

    // O fechamento anterior abriu uma temporada nova. Apontá-la de volta para
    // 10/2026 recria exatamente o caso que a tela precisa recusar: ciclo aberto
    // num mês que já está congelado.
    const [aberta] = await db.select<{ id: string }>(
      "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
    );
    await db.update(`game_seasons?id=eq.${aberta.id}`, { period_start: ISO });

    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /^fechar mês$/i }).click();
    const dialogo = page.getByRole("alertdialog");

    // O diálogo explica por que o mês do ciclo não está na lista…
    await expect(dialogo).toContainText(`${MES} (mês da temporada aberta) já está fechado`);
    // …e não o oferece.
    const opcoes = (await opcoesDe(seletor(dialogo, "Período a fechar")))
      .map((texto) => texto.split(" — ")[0]);
    expect(opcoes).not.toContain(MES);
    // A proposta migrada continua fechando o próprio mês: 11/2026 é oferecível.
    expect(opcoes).toContain(`${ISO_SEGUINTE.slice(5, 7)}/${ISO_SEGUINTE.slice(0, 4)}`);

    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(dialogo).toBeHidden();
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);
  });

  test("o banco recusa o segundo fechamento com mensagem legível", async () => {
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);

    // Chamada com o JWT real do admin (não com service_role): é a mesma
    // credencial que a tela usa, então o que falha aqui falha lá.
    const alvo = resolveTarget();
    const sessao = await mintSession(userFor("admin").email);
    const res = await fetch(`${alvo.supabaseUrl}/rest/v1/rpc/close_month_and_season`, {
      method: "POST",
      headers: {
        apikey: alvo.anonKey,
        Authorization: `Bearer ${sessao.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_period: ISO }),
    });

    expect(res.ok).toBe(false);
    const corpo = (await res.json()) as { message?: string };
    // Mensagem de gente, com o mês: "O mês 10/2026 já está fechado."
    expect(corpo.message ?? "").toMatch(/já está fechado/i);
    expect(corpo.message ?? "").toContain("10/2026");

    // E a recusa não deixou rastro: nada de proposta migrada duas vezes.
    const [aberto] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioAberto}&select=month_base`,
    );
    expect(aberto.month_base).toBe(ISO_SEGUINTE);
  });

  /**
   * Ciclo livre: a temporada que nasce depois de um fechamento cai no MESMO mês
   * de calendário, já em `closed_months`. Pela Gamificação, o botão mandava
   * fechar esse mês de novo, levava o "já está fechado" do banco e a temporada
   * ficava aberta para sempre. Agora a tela reconhece o mês travado e encerra
   * só a temporada — e o peso alterado no diálogo é gravado (antes o upsert
   * estourava em índice parcial e derrubava o fechamento inteiro).
   */
  test("com o mês já travado, a Gamificação encerra só a temporada e grava o peso novo", async ({ page }) => {
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);
    const [aberta] = await db.select<{ id: string; period_start: string }>(
      "game_seasons?closed_at=is.null&select=id,period_start&order=period_start.desc&limit=1",
    );
    expect(aberta.period_start).toBe(ISO);

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: /fechar gameficação/i }).click();

    // O diálogo diz, antes do clique, que o mês já está travado e que nada se move.
    const dialogo = page.getByRole("alertdialog");
    await expect(dialogo).toContainText(`${MES} já está travado`);
    await dialogo.getByLabel(rotuloPeso).fill(String(PESO_NOVO));
    await dialogo.getByRole("button", { name: "Encerrar temporada", exact: true }).click();

    await expect(page.getByText("Temporada encerrada")).toBeVisible();
    await expect(page.getByText(/já estava travado/i)).toBeVisible();

    // (a) o peso novo está na regra padrão
    await expect
      .poll(async () => {
        const [regra] = await db.select<{ points: number }>(
          `game_scoring_rules?event_code=eq.${codigoPeso}&season_id=is.null&select=points`,
        );
        return regra?.points;
      })
      .toBe(PESO_NOVO);

    // (b) a temporada encerrou e a próxima nasceu aberta
    const [fechada] = await db.select<{ closed_at: string | null }>(
      `game_seasons?id=eq.${aberta.id}&select=closed_at`,
    );
    expect(fechada.closed_at).not.toBeNull();
    const abertas = await db.select<{ id: string }>("game_seasons?closed_at=is.null&select=id");
    expect(abertas).toHaveLength(1);
    expect(abertas[0].id).not.toBe(aberta.id);

    // (c) o mês continua fechado uma vez só e a proposta não andou de novo
    expect(await db.select(`closed_months?period=eq.${ISO}&select=period`)).toHaveLength(1);
    const [aberto] = await db.select<{ month_base: string }>(
      `deals?id=eq.${negocioAberto}&select=month_base`,
    );
    expect(aberto.month_base).toBe(ISO_SEGUINTE);
  });
});

/**
 * Reabertura de mês — o caminho que a tela prometia em três lugares e não
 * existia.
 *
 * `blockedMoveReason` ("Fale com o administrador para reabrir"), o aviso do
 * modal ("até um administrador reabrir o período") e a própria mensagem do
 * gatilho `deals_guard_closed_month` mandavam procurar um administrador que não
 * tinha botão nenhum: reabrir era `delete from closed_months` na mão. A policy
 * `closed_months_write` sempre foi `is_admin()`.
 *
 * **Roda também no alvo remoto**, ao contrário do fechamento: aqui nada encosta
 * na temporada do game. O mês é 05/2028 — futuro, sem negócio de ninguém —, e o
 * único negócio do período é criado e apagado por este cenário.
 */
test.describe("reabertura de mês", () => {
  const MES_REABRIR = "05/2028";
  const ISO_REABRIR = "2028-05-01";
  const marcaReabertura = `${tag}-reabertura`;

  test.beforeAll(async () => {
    const jaFechado = await db.select(`closed_months?period=eq.${ISO_REABRIR}&select=period`);
    if (jaFechado.length) {
      throw new Error(`${MES_REABRIR} já está em closed_months — outro teste não limpou`);
    }

    // A ordem importa: `deals_guard_closed_month` recusa até o INSERT em mês
    // fechado, então o negócio nasce antes do congelamento.
    const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.proposal&select=id");
    const [deal] = await db.insert<{ id: string }>("deals", {
      stage_id: etapa.id,
      month_base: ISO_REABRIR,
      outcome: "open",
      vgv_gross: 250000,
      status_detail: "PROPOSTA",
      notes: marcaReabertura,
    });
    await db.insert("deal_clients", {
      deal_id: deal.id,
      ordinal: 1,
      full_name: `Reabertura ${marcaReabertura}`,
    });

    await db.insert("closed_months", { period: ISO_REABRIR, notes: marcaReabertura });
  });

  test.afterAll(async () => {
    await db.remove(`closed_months?period=eq.${ISO_REABRIR}`);
    await db.remove(`deals?notes=eq.${marcaReabertura}`);
    // A tabela de registro nasce na migration 0076; num banco sem ela o DELETE
    // devolve 404 e a limpeza não pode derrubar o cenário por causa disso.
    await db.remove(`month_reopenings?period=eq.${ISO_REABRIR}`).catch(() => undefined);
  });

  test("o admin reabre o mês pela tela e a linha some de closed_months", async ({ page }) => {
    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /^reabrir mês$/i }).click();
    const dialogo = page.getByRole("alertdialog");

    // Não dá para usar `escolher()` aqui: ele casa a opção por texto EXATO e
    // este cenário fecha 05/2028 com uma proposta aberta de propósito, então o
    // diálogo rotula a opção "05/2028 — tem proposta aberta". O prefixo é o que
    // a copy garante; o sufixo é o aviso de incoerência que o teste seguinte
    // cobra no corpo do diálogo.
    const periodo = seletor(dialogo, "Período a reabrir");
    await periodo.click();
    await page.getByRole("option", { name: new RegExp(`^${MES_REABRIR}`) }).click();
    await expect(periodo).toContainText(MES_REABRIR);

    // O diálogo diz o que muda ANTES de confirmar — e diz o que NÃO desfaz.
    await expect(dialogo).toContainText(`1 negócio(s) de ${MES_REABRIR}`);
    await expect(dialogo).toContainText(/não há registro de quais linhas migraram/i);

    await dialogo.getByRole("button", { name: `Reabrir ${MES_REABRIR}`, exact: true }).click();
    await expect(page.getByText(`Mês ${MES_REABRIR} reaberto`)).toBeVisible();

    // O que prova a reabertura é o banco, não o toast.
    await expect
      .poll(async () => (await db.select(`closed_months?period=eq.${ISO_REABRIR}&select=period`)).length)
      .toBe(0);

    // E o ato fica registrado: apagar a linha muda relatório que a diretoria já
    // leu, então precisa sobrar rastro de quem reabriu.
    const registro = await db
      .select<{ period: string }>(`month_reopenings?period=eq.${ISO_REABRIR}&select=period,reopened_by`)
      .catch(() => null);
    expect(registro, "aplique a migration 0076: o gatilho de registro da reabertura vem dela")
      .not.toBeNull();
    expect(registro ?? []).toHaveLength(1);
  });

  test("depois de reaberto, o mês volta a ser oferecido no fechamento", async ({ page }) => {
    expect(
      await db.select(`closed_months?period=eq.${ISO_REABRIR}&select=period`),
      "o teste anterior precisa ter reaberto o mês",
    ).toEqual([]);

    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /^fechar mês$/i }).click();
    const dialogo = page.getByRole("alertdialog");
    const opcoes = (await opcoesDe(seletor(dialogo, "Período a fechar")))
      .map((texto) => texto.split(" — ")[0]);
    expect(opcoes, "reabrir e fechar são o mesmo relógio").toContain(MES_REABRIR);

    await dialogo.getByRole("button", { name: /^cancelar$/i }).click();
    await expect(dialogo).toBeHidden();
  });
});
