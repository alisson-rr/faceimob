import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import {
  abrirDetalhe,
  abrirPipeline,
  buscar,
  confirmarModal,
  escolher,
  limparNegocios,
  seletor,
  semearNegocio,
} from "../helpers/negocio";
import { criarCenario, limparCenario, semearDocumento, tiposObrigatorios, type Cenario } from "../cca/esteira";

/**
 * Gamificação — ata de 14/07: o ranking é o motor do jogo e o cliente reclamava
 * que "cada tela mostrava um número".
 *
 * A regra que estes testes cobram é uma só: o placar sai de `game_events`,
 * agregado pela view `game_ranking`, e o peso de cada movimento sai de
 * `game_scoring_rules`. Nenhuma conta acontece no navegador — a versão anterior
 * calculava tudo no cliente com os pesos em `useState`, então dois usuários
 * viam rankings diferentes e nada era auditável (decisão de 02/08 em
 * `docs/sprints/decisoes.md`).
 *
 * Por isso o cenário mexe SÓ no banco e cobra a tela: se a tela recalculasse
 * por conta própria, o número inserido aqui não apareceria lá.
 */
const tag = runTag();
/** Código de evento exclusivo desta execução: não encosta nos cinco do negócio. */
const codigo = tag;
const rotulo = `Bônus E2E ${tag}`;

/** Alto o bastante para o corretor E2E liderar o ranking do seed com folga. */
const BASE = 9000;
const PESO_INICIAL = 7;
const PESO_NOVO = 70;

const CORRETOR = "E2E Corretor";

let corretorId: string;

test.beforeAll(async () => {
  corretorId = await db.profileIdOf("broker");
  await db.insert("game_scoring_rules", {
    season_id: null,
    event_code: codigo,
    label: rotulo,
    points: PESO_INICIAL,
    active: true,
  });
});

/** Negocios que os testes de gatilho criam - limpos no fim, com os pontos deles. */
const negociosCriados: string[] = [];
/** Cenários da esteira: construtora própria, então a limpeza é a do helper. */
const cenariosCca: Cenario[] = [];

test.afterAll(async () => {
  for (const dealId of negociosCriados) await db.remove(`game_events?ref_id=eq.${dealId}`);
  for (const cenario of cenariosCca) {
    await db.remove(`game_events?ref_id=eq.${cenario.dealId}`);
    await limparCenario(cenario);
  }
  await limparNegocios(tag);
  await db.remove(`game_events?ref_type=eq.${tag}`);
  await db.remove(`game_scoring_rules?event_code=eq.${codigo}`);
});

/**
 * Temporada aberta AGORA, com os eventos do teste dentro dela.
 *
 * O banco é compartilhado: outro spec (o de fechamento de mês) pode encerrar a
 * temporada no meio. Quando isso acontece os eventos ficam presos na temporada
 * antiga e o ranking da tela — que só mostra a aberta — zera. Reaplicar é mais
 * honesto do que fingir que a corrida não existe.
 */
async function temporadaComBase(): Promise<string> {
  const [temporada] = await db.select<{ id: string }>(
    "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
  );
  if (!temporada) throw new Error("nenhuma temporada aberta — a gamificação está parada");

  const jaTem = await db.select(
    `game_events?season_id=eq.${temporada.id}&ref_type=eq.${tag}&select=id`,
  );
  if (!jaTem.length) {
    await db.insert("game_events", {
      season_id: temporada.id,
      profile_id: corretorId,
      event_code: codigo,
      points: BASE,
      ref_type: tag,
    });
  }
  return temporada.id;
}

/** Linha do ranking de um corretor. Célula exata: "E2E Corretor" ≠ "E2E Corretor Rival". */
const linhaDoRanking = (page: import("@playwright/test").Page, nome: string) =>
  page.getByRole("row").filter({ has: page.getByRole("cell", { name: nome, exact: true }) });

/** Última célula da linha é a coluna "Pontos". */
const pontosNaTela = (page: import("@playwright/test").Page, nome: string) =>
  linhaDoRanking(page, nome).getByRole("cell").last();

/**
 * A tela formata número com `num()` de `lib/format.ts` (fonte única de pt-BR
 * desde a Tarefa A): 9000 aparece como "9.000". Comparar com `String(n)` só
 * passava enquanto o placar tinha menos de quatro dígitos.
 */
const emPtBr = (n: number) => n.toLocaleString("pt-BR");

/**
 * Placar do corretor segundo o banco.
 *
 * A asserção compara tela × `game_ranking` em vez de tela × constante: o banco é
 * compartilhado (outro project pode estar pontuando o mesmo corretor no mesmo
 * segundo), e o que este teste tem que provar é que a tela NÃO recalcula por
 * conta própria. Fixar um número absoluto testaria o isolamento do ambiente, não
 * a regra.
 */
const pontosNoBanco = async (temporada: string) => {
  const [linha] = await db.select<{ points: number }>(
    `game_ranking?season_id=eq.${temporada}&profile_id=eq.${corretorId}&select=points`,
  );
  return linha?.points ?? 0;
};

test.describe("gamificação · ranking", () => {
  test("o placar da tela é o que está em game_events", async ({ page }) => {
    const temporada = await temporadaComBase();
    const noBanco = await pontosNoBanco(temporada);
    // O cenário injetou BASE: se a tela ignorasse game_events, não chegaria lá.
    expect(noBanco).toBeGreaterThanOrEqual(BASE);

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    await expect(pontosNaTela(page, CORRETOR)).toHaveText(emPtBr(noBanco));
  });

  test("mudar a pontuação em game_scoring_rules muda o placar", async ({ page }) => {
    const temporada = await temporadaComBase();
    const antes = await pontosNoBanco(temporada);

    // 1º movimento com o peso original.
    const refA = crypto.randomUUID();
    await db.rpc("award_game_points", {
      p_profile_id: corretorId,
      p_event_code: codigo,
      p_ref_type: tag,
      p_ref_id: refA,
    });

    // 2º movimento depois de trocar a regra: é a regra que decide quanto vale.
    await db.update(`game_scoring_rules?event_code=eq.${codigo}`, { points: PESO_NOVO });
    const refB = crypto.randomUUID();
    await db.rpc("award_game_points", {
      p_profile_id: corretorId,
      p_event_code: codigo,
      p_ref_type: tag,
      p_ref_id: refB,
    });

    // O banco gravou pesos diferentes para o mesmo código — a regra valeu.
    const eventos = await db.select<{ ref_id: string; points: number }>(
      `game_events?season_id=eq.${temporada}&ref_type=eq.${tag}&ref_id=not.is.null&select=ref_id,points`,
    );
    expect(eventos.find((e) => e.ref_id === refA)?.points).toBe(PESO_INICIAL);
    expect(eventos.find((e) => e.ref_id === refB)?.points).toBe(PESO_NOVO);

    // Cada movimento valeu o peso VIGENTE quando aconteceu — é a regra que
    // decide, e trocá-la não reescreve o passado.
    const depois = await pontosNoBanco(temporada);
    expect(depois - antes).toBe(PESO_INICIAL + PESO_NOVO);

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    // A tela soma os eventos e mostra o peso vigente no cartão de regras.
    await expect(pontosNaTela(page, CORRETOR)).toHaveText(emPtBr(depois));
    await expect(page.getByText(`${rotulo}: ${PESO_NOVO} pts`)).toBeVisible();
  });

  test("o pódio mostra exatamente os três primeiros", async ({ page }) => {
    await temporadaComBase();

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    const painel = page.getByRole("tabpanel");
    const linhas = painel.getByRole("row");
    const nomeDaLinha = async (i: number) =>
      (await linhas.nth(i).getByRole("cell").nth(1).innerText()).trim();

    // Linha 0 é o cabeçalho da tabela.
    const top3 = [await nomeDaLinha(1), await nomeDaLinha(2), await nomeDaLinha(3)];
    const quarto = await nomeDaLinha(4);

    // Três degraus, nem mais nem menos. O degrau escreve "pts" na tela desde a
    // Tarefa B; o rótulo acessível ("1º lugar: Fulano, N pontos") é o que dá
    // para contar sem depender da abreviação.
    await expect(painel.getByLabel(/lugar:/)).toHaveCount(3);

    // Quem está no pódio aparece duas vezes (cartão + tabela); o 4º, só uma.
    for (const nome of top3) {
      await expect(painel.getByText(nome, { exact: true })).toHaveCount(2);
    }
    expect(top3).not.toContain(quarto);
    await expect(painel.getByText(quarto, { exact: true })).toHaveCount(1);
  });
});

test.describe("gamificação · diretorias", () => {
  test("agrupa pelo diretor real da equipe, sem nome inventado", async ({ page }) => {
    await temporadaComBase();

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Diretorias" }).click();

    // Cada diretoria é um cartão com título "Diretoria <nome>". O título tem
    // ícone antes do texto, então casar por papel é mais firme do que ancorar
    // uma expressão no começo do texto do elemento. O `SectionCard` do kit
    // (Tarefa A) titula em <h2>: <h1> é do cabeçalho da página, <h2> de cada
    // seção — antes disto o cartão usava <h3>.
    const titulos = page.getByRole("tabpanel").getByRole("heading", { level: 2 });
    await expect(titulos.first()).toBeVisible();

    const naTela = (await titulos.allInnerTexts())
      .map((t) => t.trim())
      .filter((t) => t.startsWith("Diretoria "))
      .map((t) => t.replace(/^Diretoria\s+/, "").trim());

    // Fonte da verdade: teams.director_id. Qualquer nome fora desta lista é
    // diretoria fictícia — foi assim que a tela nasceu, com rótulo chumbado.
    const equipes = await db.select<{ director_id: string | null }>(
      "teams?active=eq.true&select=director_id",
    );
    const ids = [...new Set(equipes.map((e) => e.director_id).filter(Boolean))] as string[];
    const diretores = await db.select<{ id: string; full_name: string }>(
      `profiles?id=in.(${ids.join(",")})&select=id,full_name`,
    );
    const nomesReais = diretores.map((d) => d.full_name);

    expect(naTela.length).toBeGreaterThan(0);
    for (const nome of naTela) expect(nomesReais).toContain(nome);

    // Âncora: a equipe E2E Alfa tem diretor de verdade, então ele tem de estar lá.
    expect(naTela).toContain("E2E Diretor");
  });
});

test.describe("gamificação · prévia de papel", () => {
  /**
   * A tela derivava `isAdmin` de `role` (papel REAL) em vez do `isAdmin` do
   * contexto, que acompanha a prévia. Resultado: o admin "vendo como corretor"
   * continuava com a aba Admin e um botão de fechar que funcionava de verdade,
   * porque o RLS responde pelos papéis reais. A prévia é client-side e some no
   * próximo carregamento, então não há o que limpar.
   */
  test("na prévia como corretor, a aba Admin e o botão de fechar somem", async ({ page }) => {
    await temporadaComBase();

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    const fechar = page.getByRole("button", { name: /fechar gameficação/i });
    const abaAdmin = page.getByRole("tab", { name: "Admin", exact: true });
    await expect(fechar).toBeVisible();
    await expect(abaAdmin).toBeVisible();

    await page.getByRole("combobox", { name: "Pré-visualizar como papel" }).click();
    await page.getByRole("option", { name: "Ver como Corretor" }).click();

    await expect(fechar).toHaveCount(0);
    await expect(abaAdmin).toHaveCount(0);
    // O ranking continua: a prévia mexe em botão e aba, não em dado.
    await expect(page.getByRole("tab", { name: "Geral", exact: true })).toBeVisible();
  });
});


/**
 * O gatilho, exercitado PELA TELA.
 *
 * Até aqui todo teste de gamificação injetava `game_events` de propósito — o que
 * prova que a tela lê o banco, e nada sobre quem escreve nele. O inventário de
 * 02/09 achou o buraco: nenhum spec movia um negócio para "Fechado" pela tela
 * para conferir a linha nova, e duas das cinco regras (`distrato` e
 * `incompleto_com_doc`) eram configuração morta — a tela as exibia e nada no
 * banco as emitia.
 *
 * Aqui o cenário só monta o negócio; quem fecha e quem perde é o navegador.
 */
test.describe("gamificação · o gatilho, pela tela", () => {
  /** Negócio com corretor no rateio e um documento — "Fechado" exige documento. */
  async function negocioPronto(cliente: string) {
    const negocio = await semearNegocio({ cliente, brokerId: corretorId });
    negociosCriados.push(negocio.id);
    const [tipo] = await db.select<{ id: string }>(
      "document_types?active=is.true&select=id&order=sort_order&limit=1",
    );
    await db.insert("deal_documents", {
      deal_id: negocio.id,
      document_type_id: tipo.id,
      storage_path: `e2e/${negocio.id}/doc.pdf`,
      original_name: "doc.pdf",
      stored_name: `doc-${tag}.pdf`,
    });
    // Documento anexado não basta: `deals_guard_stage` (0028) recusa a entrada
    // em under_analysis/approved/contract/closed enquanto a conferência não
    // estiver aprovada, e a recusa aqui deixaria o negócio em `open` — o teste
    // culparia o gatilho de pontuação por um erro que é de cenário. `db` usa
    // service_role, que `deals_guard_document_review` autoriza a gravar o campo.
    await db.update(`deals?id=eq.${negocio.id}`, { document_review_status: "approved" });
    return negocio;
  }

  const eventosDo = (dealId: string, codigoEvento: string) =>
    db.select<{ points: number }>(
      `game_events?ref_id=eq.${dealId}&event_code=eq.${codigoEvento}&profile_id=eq.${corretorId}&select=points`,
    );

  const outcomeDe = async (dealId: string) =>
    (await db.select<{ outcome: string }>(`deals?id=eq.${dealId}&select=outcome`))[0]?.outcome;

  test("mover o negócio para Fechado grava a venda em game_events", async ({ page }) => {
    await temporadaComBase();
    const cliente = `Venda Gatilho ${tag}`;
    const negocio = await negocioPronto(cliente);

    expect(await eventosDo(negocio.id, "venda")).toHaveLength(0);

    await abrirPipeline(page);
    await buscar(page, cliente);
    const modal = await abrirDetalhe(page, cliente);
    await escolher(seletor(modal, "Etapa (Status 1)"), "Fechado");
    await confirmarModal(page, modal);

    // A prova é a linha no banco, não o toast: o `outcome` mudou e o gatilho
    // pontuou o corretor do rateio.
    await expect
      .poll(() => outcomeDe(negocio.id), { message: "a tela precisa deixar o negócio em outcome=won" })
      .toBe("won");

    await expect
      .poll(async () => (await eventosDo(negocio.id, "venda")).length, {
        message: "deals_award_points precisa gravar a venda do corretor",
      })
      .toBe(1);

    const [evento] = await eventosDo(negocio.id, "venda");
    const [regra] = await db.select<{ points: number }>(
      "game_scoring_rules?event_code=eq.venda&season_id=is.null&select=points",
    );
    expect(evento.points, "o evento vale o peso vigente da regra").toBe(regra.points);
  });

  /**
   * **Depende da migration 0060.** Antes dela o gatilho exigia
   * `outcome='cancelled'`, que nenhum dos 9 estágios produz: o diálogo de perda
   * grava `lost`, a venda continuava valendo +600 e a penalidade nunca entrava.
   */
  test("encerrar por distrato desconta sem apagar a venda", async ({ page }) => {
    await temporadaComBase();
    const cliente = `Distrato Gatilho ${tag}`;
    const negocio = await negocioPronto(cliente);

    await abrirPipeline(page);
    await buscar(page, cliente);
    const modal = await abrirDetalhe(page, cliente);
    await escolher(seletor(modal, "Etapa (Status 1)"), "Fechado");
    await confirmarModal(page, modal);
    await expect.poll(async () => (await eventosDo(negocio.id, "venda")).length).toBe(1);

    // Perder pelo caminho real: o Select da tabela desvia para a confirmação.
    await abrirPipeline(page);
    await buscar(page, cliente);
    const linhaDoNegocio = page.getByRole("row").filter({ hasText: new RegExp(cliente, "i") });
    // Sem o `escolher()` do helper: ele fecha com `toContainText` no gatilho, e
    // aqui isso reprovaria por motivo CERTO — o Select da linha é controlado por
    // `deals.status_detail`, e um rótulo de perda não grava nada, desvia para a
    // confirmação. O gatilho só muda depois que o banco muda. É o mesmo motivo
    // do `pedirStatus()` de `perder-negocio.spec.ts`.
    const statusDaLinha = linhaDoNegocio.getByRole("combobox");
    await statusDaLinha.click();
    await page.getByRole("option", { name: "17. DISTRATO", exact: true }).click();
    const confirmacao = page.getByRole("alertdialog");
    await confirmacao.getByRole("button", { name: /encerrar negócio/i }).click();

    await expect.poll(() => outcomeDe(negocio.id)).toBe("lost");

    await expect
      .poll(async () => (await eventosDo(negocio.id, "distrato")).length, {
        message: "perder um negócio ganho tem que disparar a penalidade",
      })
      .toBe(1);

    const [penalidade] = await eventosDo(negocio.id, "distrato");
    expect(penalidade.points, "distrato é penalidade").toBeLessThan(0);

    // Decisão de 03/09: penalidade, não estorno. O +600 fica.
    expect(await eventosDo(negocio.id, "venda")).toHaveLength(1);
  });

  /**
   * **Depende da migration 0078.** `cca_award_points` era `after update` desde a
   * 0010, e `submit_deal_for_analysis` CRIA o caso já em `under_review`: a
   * PRIMEIRA submissão — o caminho real, o único que a operação faz — era um
   * INSERT e o gatilho não rodava. Medido no remoto antes da correção: 12 casos
   * em `cca_cases` e só 2 `ref_id` distintos com evento `esteira`, ambos de
   * semente. É a mesma classe de defeito que a 0060 corrigiu para `deals`.
   *
   * O cenário chama a RPC de verdade, não um INSERT à mão em `cca_cases`:
   * insertar o caso direto provaria o gatilho e nada sobre o caminho que a
   * aprovação da conferência documental percorre.
   */
  test("enviar o dossiê para a esteira pontua já na primeira submissão", async ({ page }) => {
    const temporada = await temporadaComBase();
    const cenario = await criarCenario({ dono: "broker", apelido: "Esteira Game" });
    cenariosCca.push(cenario);

    // `submit_deal_for_analysis` recusa sem construtora, sem conferência
    // aprovada ou com documento obrigatório faltando — a recusa aqui culparia o
    // gatilho de pontuação por um erro que é de cenário.
    for (const tipo of await tiposObrigatorios()) await semearDocumento(cenario, tipo.code);
    await db.update(`deals?id=eq.${cenario.dealId}`, { document_review_status: "approved" });

    expect(await eventosDo(cenario.dealId, "esteira")).toHaveLength(0);

    await db.rpc("submit_deal_for_analysis", { p_deal_id: cenario.dealId });

    const [caso] = await db.select<{ status: string }>(
      `cca_cases?deal_id=eq.${cenario.dealId}&select=status`,
    );
    expect(caso?.status, "a RPC precisa ter criado o caso na esteira").toBe("under_review");

    await expect
      .poll(async () => (await eventosDo(cenario.dealId, "esteira")).length, {
        message: "cca_award_points precisa pontuar a esteira no INSERT do caso",
      })
      .toBe(1);

    const [evento] = await eventosDo(cenario.dealId, "esteira");
    const [regra] = await db.select<{ points: number }>(
      "game_scoring_rules?event_code=eq.esteira&season_id=is.null&select=points",
    );
    expect(evento.points, "o evento vale o peso vigente da regra").toBe(regra.points);

    // E os 140 pontos chegam à tela: o placar é a soma de game_events, não uma
    // conta do navegador.
    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await expect(pontosNaTela(page, CORRETOR)).toHaveText(emPtBr(await pontosNoBanco(temporada)));
  });
});

/**
 * O congelado, lido NA TELA.
 *
 * O fechamento já provava que `game_season_results` nasce (fechamento-mes.spec),
 * mas ninguém provava que a tela mostra o que foi congelado — e ela dependia de
 * existir uma temporada ABERTA para resolver os nomes, então com o jogo parado o
 * histórico inteiro sumia atrás de "Ninguém pontuou nesta temporada".
 */
test.describe("gamificação · temporada fechada", () => {
  test("escolher uma temporada fechada mostra o ranking congelado", async ({ page }) => {
    const fechadas = await db.select<{ id: string; label: string }>(
      "game_seasons?closed_at=not.is.null&select=id,label&order=period_start.desc",
    );
    const comResultado: { id: string; label: string; profileId: string; points: number }[] = [];
    for (const temporada of fechadas) {
      const [linha] = await db.select<{ profile_id: string; points: number }>(
        `game_season_results?season_id=eq.${temporada.id}&select=profile_id,points&order=rank&limit=1`,
      );
      if (linha) comResultado.push({ ...temporada, profileId: linha.profile_id, points: linha.points });
    }
    test.skip(comResultado.length === 0, "nenhuma temporada fechada tem ranking congelado neste alvo");

    const alvo = comResultado[0];
    const [pessoa] = await db.select<{ full_name: string }>(
      `profiles?id=eq.${alvo.profileId}&select=full_name`,
    );

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    await page.getByRole("combobox", { name: "Temporada exibida" }).click();
    await page.getByRole("option", { name: new RegExp(`${alvo.label}.*\\(fechada\\)`) }).click();
    await aguardarCarregamento(page);

    await expect(page.getByText("Temporada fechada")).toBeVisible();
    // O número da tela é o CONGELADO, não um recálculo de game_events.
    await expect(pontosNaTela(page, pessoa.full_name)).toHaveText(emPtBr(alvo.points));
  });
});

/**
 * Regras de pontuação fora do fechamento.
 *
 * O único caminho para mexer num peso era o diálogo "Fechar gameficação": para
 * corrigir "Venda: 600 → 700" no meio da temporada o admin era obrigado a
 * encerrar o jogo. A aba Admin passou a ter a tela própria.
 */
test.describe("gamificação · regras de pontuação", () => {
  const regraNoBanco = async () => {
    const [regra] = await db.select<{ points: number; active: boolean }>(
      `game_scoring_rules?event_code=eq.${codigo}&season_id=is.null&select=points,active`,
    );
    return regra;
  };

  test("o admin edita e desativa um peso sem encerrar a temporada", async ({ page }) => {
    await temporadaComBase();
    const [temporadaAntes] = await db.select<{ id: string }>(
      "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
    );

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Admin", exact: true }).click();

    const campoPeso = page.getByLabel(`Pontos de ${rotulo}`);
    await expect(campoPeso).toBeVisible();
    await campoPeso.fill("123");
    await page.getByRole("row").filter({ hasText: rotulo }).getByRole("button", { name: "Salvar" }).click();

    await expect
      .poll(async () => (await regraNoBanco()).points, { message: "o peso tem que chegar em game_scoring_rules" })
      .toBe(123);

    // Desativar é a outra metade que a tabela sempre suportou e a tela não alcançava.
    await page.getByRole("switch", { name: `Desativar ${rotulo}` }).click();
    await expect.poll(async () => (await regraNoBanco()).active).toBe(false);

    await page.getByRole("switch", { name: `Ativar ${rotulo}` }).click();
    await expect.poll(async () => (await regraNoBanco()).active).toBe(true);

    // E o jogo continua aberto: editar peso não é encerrar temporada.
    const [temporadaDepois] = await db.select<{ id: string }>(
      "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
    );
    expect(temporadaDepois.id).toBe(temporadaAntes.id);
  });

  /**
   * Editar o peso de uma regra DESLIGADA não pode religá-la.
   *
   * `writeScoringRule` mandava `active: true` junto do UPDATE: corrigir o peso
   * de uma regra que o admin tinha desativado de propósito a reativava em
   * silêncio — o evento voltava a pontuar sem ninguém ter pedido, e o toast
   * dizia só "N pts". A gravação existia; o efeito colateral é que era mudo.
   */
  test("corrigir o peso de uma regra desativada não a religa", async ({ page }) => {
    await temporadaComBase();

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Admin", exact: true }).click();

    await page.getByRole("switch", { name: `Desativar ${rotulo}` }).click();
    await expect.poll(async () => (await regraNoBanco()).active).toBe(false);

    await page.getByLabel(`Pontos de ${rotulo}`).fill("31");
    await page.getByRole("row").filter({ hasText: rotulo }).getByRole("button", { name: "Salvar" }).click();

    await expect.poll(async () => (await regraNoBanco()).points).toBe(31);
    expect((await regraNoBanco()).active, "salvar o peso não é religar a regra").toBe(false);

    await page.getByRole("switch", { name: `Ativar ${rotulo}` }).click();
    await expect.poll(async () => (await regraNoBanco()).active).toBe(true);
  });

  /**
   * Campo de pontos apagado gravava 0 com toast de sucesso.
   *
   * `Number('')` é 0 e `Number.isInteger(0)` é true: o botão continuava
   * habilitado e a regra ia a zero — a venda parava de pontuar e ninguém era
   * avisado. É a mesma guarda que o diálogo de fechamento já fazia.
   */
  test("campo de pontos vazio não grava zero", async ({ page }) => {
    await temporadaComBase();
    const antes = (await regraNoBanco()).points;

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Admin", exact: true }).click();

    await page.getByLabel(`Pontos de ${rotulo}`).fill("");
    const linha = page.getByRole("row").filter({ hasText: rotulo });
    await expect(linha.getByText("Informe um número inteiro.")).toBeVisible();
    await expect(linha.getByRole("button", { name: "Salvar" })).toBeDisabled();

    expect((await regraNoBanco()).points, "campo vazio não pode zerar o peso").toBe(antes);
  });

  /**
   * "Criar" com um código existente SOBRESCREVIA a regra e dizia "Regra criada".
   *
   * `setDefaultScoringPoints` faz UPDATE-primeiro por `event_code`: digitar
   * `venda` reescrevia rótulo e os 600 pontos da Venda, com dois toasts falsos
   * sobre o que tinha acabado de acontecer, num campo que vale dinheiro no
   * placar. A tabela já está carregada na tela — a colisão é detectável antes
   * do clique.
   */
  test("criar regra com código que já existe é recusado antes de gravar", async ({ page }) => {
    await temporadaComBase();
    const antes = await regraNoBanco();

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Admin", exact: true }).click();

    await page.getByLabel("Código do evento").fill(codigo);
    await page.getByLabel("Nome na tela").fill("Tentativa de sobrescrever");
    await page.getByLabel("Pontos", { exact: true }).fill("5");

    await expect(page.getByText(/já existe uma regra padrão com esse código/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar" })).toBeDisabled();

    const depois = await regraNoBanco();
    expect(depois.points, "a regra existente não pode ser reescrita pelo campo de criação").toBe(antes.points);
  });

  /**
   * "Fixar na temporada" numa regra DESLIGADA a religava pela porta dos fundos.
   *
   * Não existe regra da temporada ainda, então `writeScoringRule` cai no
   * INSERT — e o INSERT grava `active: true`. `scoring_points` prefere a regra
   * da temporada e só olha as ativas: a regra que o admin desativou de propósito
   * voltava a pontuar, em silêncio, com o toast dizendo apenas "fixada em N
   * pts". A guarda contra religar tinha ficado só no UPDATE, e "Fixar" é o
   * único caminho que passa exclusivamente pelo INSERT.
   */
  test("regra desativada não oferece 'Fixar na temporada'", async ({ page }) => {
    const temporada = await temporadaComBase();

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Admin", exact: true }).click();

    const linha = page.getByRole("row").filter({ hasText: rotulo });
    const fixar = linha.getByRole("button", { name: "Fixar na temporada" });
    await expect(fixar, "com a regra ligada o botão existe").toBeVisible();

    await page.getByRole("switch", { name: `Desativar ${rotulo}` }).click();
    await expect.poll(async () => (await regraNoBanco()).active).toBe(false);

    await expect(fixar, "regra desligada não se fixa: o INSERT a religaria").toHaveCount(0);
    expect(
      await db.select(`game_scoring_rules?event_code=eq.${codigo}&season_id=eq.${temporada}&select=id`),
      "nada pode ter sido gravado na temporada",
    ).toHaveLength(0);

    await page.getByRole("switch", { name: `Ativar ${rotulo}` }).click();
    await expect.poll(async () => (await regraNoBanco()).active).toBe(true);
  });

  /**
   * O selo de escopo dizia "Só nesta temporada" para QUALQUER regra presa a uma
   * temporada, inclusive as de temporadas encerradas — e editá-la gravava na
   * antiga, com o admin achando que tinha mudado o peso vigente. Agora o selo
   * nomeia a temporada.
   */
  test("fixar na temporada nomeia a temporada no selo de escopo", async ({ page }) => {
    const temporada = await temporadaComBase();
    const [{ label }] = await db.select<{ label: string }>(
      `game_seasons?id=eq.${temporada}&select=label`,
    );

    await page.goto("/gamification");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Admin", exact: true }).click();

    const linhaPadrao = page.getByRole("row").filter({ hasText: rotulo });
    await linhaPadrao.first().getByRole("button", { name: "Fixar na temporada" }).click();

    await expect
      .poll(async () => (await db.select(`game_scoring_rules?event_code=eq.${codigo}&season_id=eq.${temporada}&select=id`)).length)
      .toBe(1);

    // Duas linhas com o mesmo rótulo: a padrão e a da temporada. O selo é o que
    // as distingue — e antes ele mentia por omissão.
    await expect(page.getByText(`Só em ${label}`)).toBeVisible();
  });
});
