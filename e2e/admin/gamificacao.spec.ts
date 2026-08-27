import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

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

test.afterAll(async () => {
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
