import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession } from "../support/session";
import { resolveTarget } from "../support/target";
import { userFor } from "../support/users";

/**
 * Gamificação vista pelo corretor.
 *
 * O corretor vê o ranking da própria equipe, mas fechar a temporada continua
 * sendo ato exclusivo do administrador.
 */
const tag = runTag();
const PONTOS = 4321;

let corretorId: string;

test.beforeAll(async () => {
  corretorId = await db.profileIdOf("broker");
});

test.afterAll(async () => {
  await db.remove(`game_events?ref_type=eq.${tag}`);
});

test.describe("corretor · gamificação", () => {
  test("vê o próprio placar vindo de game_events", async ({ page }) => {
    const [temporada] = await db.select<{ id: string }>(
      "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
    );
    expect(temporada, "nenhuma temporada aberta — a gamificação está parada").toBeTruthy();

    await db.insert("game_events", {
      season_id: temporada.id,
      profile_id: corretorId,
      event_code: tag,
      points: PONTOS,
      ref_type: tag,
    });

    // Comparar tela × `game_ranking`, não tela × constante: o banco é
    // compartilhado e outro project pode estar pontuando o mesmo corretor. O que
    // se prova aqui é que a tela não recalcula por conta própria.
    const [placar] = await db.select<{ points: number }>(
      `game_ranking?season_id=eq.${temporada.id}&profile_id=eq.${corretorId}&select=points`,
    );
    expect(placar.points, "o evento do cenário tem que estar somado").toBeGreaterThanOrEqual(PONTOS);

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    const minhaLinha = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name: "E2E Corretor", exact: true }) });
    // `num()` de `lib/format.ts` formata em pt-BR desde a Tarefa A: 4321 vira
    // "4.321". Comparar com `String(n)` só passava com placar de 3 dígitos.
    await expect(minhaLinha.getByRole("cell").last()).toHaveText(placar.points.toLocaleString("pt-BR"));
  });

  test("o ranking do corretor mostra a equipe, sem mostrar a equipe rival", async ({ page }) => {
    await page.goto("/gamification");
    await aguardarCarregamento(page);

    await expect(
      page.getByRole("row").filter({ has: page.getByRole("cell", { name: "E2E Corretor", exact: true }) }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ has: page.getByRole("cell", { name: "E2E Corretor 3", exact: true }) }),
    ).toBeVisible();

    // O colega da Beta continua fora: ranking de equipe não abre a casa toda.
    await expect(
      page.getByRole("row").filter({ has: page.getByRole("cell", { name: "E2E Corretor Rival", exact: true }) }),
    ).toHaveCount(0);
  });

  test("não pode encerrar a temporada nem abrir o painel de admin", async ({ page }) => {
    await page.goto("/gamification");
    await aguardarCarregamento(page);

    // Âncora: a tela carregou de verdade.
    // O cartão passou a se chamar "Ranking completo" no kit da Tarefa A.
    await expect(page.getByRole("heading", { name: /ranking completo/i })).toBeVisible();

    await expect(page.getByRole("button", { name: /fechar gameficação/i })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Admin" })).toHaveCount(0);
  });
  /**
   * O pódio do corretor é o pódio da EQUIPE dele — consequência do escopo de
   * `visible_game_ranking` (decisão de 10/08). A tela escrevia "Campeões
   * gerais" acima dele: quem lê "geral" e vê cinco nomes não tem como saber
   * que o recorte é outro.
   */
  test("o pódio diz que o recorte é a equipe, não a casa", async ({ page }) => {
    await page.goto("/gamification");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: /campeões da sua equipe/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /campeões gerais/i })).toHaveCount(0);
    await expect(page.getByText(/você vê os corretores das suas equipes/i)).toBeVisible();
  });

  /**
   * Temporada fechada aberta pelo corretor não pode virar janela para a casa.
   *
   * O seletor de temporada é renderizado para todo papel, e o congelado vem de
   * `game_season_results`, cujo SELECT ainda é `using (true)` até a 0060 ser
   * aplicada: sem filtro na tela, um corretor de equipe de três recebia TODAS
   * as linhas congeladas da casa — pontos e VGV — rotuladas "Corretor fora do
   * escopo". A linha anônima só é aceitável para quem já enxerga a casa
   * inteira (`can_read_all()`: admin, diretor, sócio).
   */
  test("temporada fechada não entrega linha de fora do escopo ao corretor", async ({ page }) => {
    const fechadas = await db.select<{ id: string; label: string }>(
      "game_seasons?closed_at=not.is.null&select=id,label&order=period_start.desc",
    );
    const comResultado: { id: string; label: string }[] = [];
    for (const temporada of fechadas) {
      const linhas = await db.select(`game_season_results?season_id=eq.${temporada.id}&select=profile_id&limit=1`);
      if (linhas.length) comResultado.push(temporada);
    }
    test.skip(comResultado.length === 0, "nenhuma temporada fechada tem ranking congelado neste alvo");

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    await page.getByRole("combobox", { name: "Temporada exibida" }).click();
    await page.getByRole("option", { name: new RegExp(`${comResultado[0].label}.*\\(fechada\\)`) }).click();
    await aguardarCarregamento(page);

    await expect(page.getByText("Temporada fechada")).toBeVisible();
    await expect(
      page.getByText("Corretor fora do escopo"),
      "ponto e VGV de quem o corretor não enxerga não podem aparecer nem sem nome",
    ).toHaveCount(0);
  });

  /**
   * O degrau do pódio tem que escrever a colocação CONGELADA.
   *
   * Para o corretor o congelado chega filtrado pelo escopo (`keepUnknown:
   * false`): as linhas de fora saem e as posições ficam descontínuas. A tabela
   * já usava o `rank` gravado — o pódio numerava pelo índice do array, então a
   * mesma tela coroava alguém como 1º no cartão e o numerava "#5" na linha de
   * baixo. O que se cobra aqui é a igualdade entre o cartão e o banco.
   */
  test("o pódio da temporada fechada usa a colocação congelada", async ({ page }) => {
    const fechadas = await db.select<{ id: string; label: string }>(
      "game_seasons?closed_at=not.is.null&select=id,label&order=period_start.desc",
    );
    const comResultado: { id: string; label: string }[] = [];
    for (const temporada of fechadas) {
      const linhas = await db.select(`game_season_results?season_id=eq.${temporada.id}&select=profile_id&limit=1`);
      if (linhas.length) comResultado.push(temporada);
    }
    test.skip(comResultado.length === 0, "nenhuma temporada fechada tem ranking congelado neste alvo");
    const alvo = comResultado[0];

    await page.goto("/gamification");
    await aguardarCarregamento(page);

    await page.getByRole("combobox", { name: "Temporada exibida" }).click();
    await page.getByRole("option", { name: new RegExp(`${alvo.label}.*\\(fechada\\)`) }).click();
    await aguardarCarregamento(page);

    const degraus = page.getByLabel(/lugar:/);
    const quantos = await degraus.count();
    test.skip(quantos === 0, "o corretor não enxerga ninguém no congelado desta temporada");

    for (let i = 0; i < quantos; i += 1) {
      const rotuloDoDegrau = await degraus.nth(i).getAttribute("aria-label");
      const casado = /^(\d+)º lugar: (.+?), /.exec(rotuloDoDegrau ?? "");
      expect(casado, `rótulo do degrau ilegível: ${rotuloDoDegrau}`).toBeTruthy();
      const [, colocacao, nome] = casado!;

      const [pessoa] = await db.select<{ id: string }>(
        `profiles?full_name=eq.${encodeURIComponent(nome)}&select=id`,
      );
      expect(pessoa, `"${nome}" tem que existir em profiles`).toBeTruthy();

      const [congelado] = await db.select<{ rank: number }>(
        `game_season_results?season_id=eq.${alvo.id}&profile_id=eq.${pessoa.id}&select=rank`,
      );
      expect(
        Number(colocacao),
        `o cartão diz ${colocacao}º e o fechamento gravou ${congelado?.rank}º para ${nome}`,
      ).toBe(congelado.rank);
    }
  });

  /**
   * O log de pontos era `select using (true)`: qualquer autenticado lia
   * `game_events` e `game_season_results` da casa inteira pelo PostgREST — a
   * tela escondia, o banco não. Depende da migration 0060.
   *
   * A venda continua pública de propósito: é o realtime dela que toca a
   * fanfarra na loja inteira (ata de 14/07).
   */
  test("o corretor não lê o log de pontos da outra equipe pelo PostgREST", async () => {
    const alvo = resolveTarget();
    const sessao = await mintSession(userFor("broker").email);
    const rival = await db.profileIdOf("brokerRival");

    const comoCorretor = async (query: string) => {
      const res = await fetch(`${alvo.supabaseUrl}/rest/v1/${query}`, {
        headers: { apikey: alvo.anonKey, Authorization: `Bearer ${sessao.access_token}` },
      });
      expect(res.ok, `${query} -> ${res.status}`).toBe(true);
      return (await res.json()) as unknown[];
    };

    // O cenário existe: com service_role, o rival tem log e o corretor também.
    const doRivalNoBanco = await db.select(
      `game_events?profile_id=eq.${rival}&event_code=neq.venda&select=id&limit=1`,
    );
    test.skip(doRivalNoBanco.length === 0, "o corretor rival não tem evento fora de venda neste alvo");

    expect(
      await comoCorretor(`game_events?profile_id=eq.${rival}&event_code=neq.venda&select=id`),
      "o log de desempenho da outra equipe não pode vazar",
    ).toHaveLength(0);

    // O próprio continua visível — senão a tela do corretor ficaria vazia.
    const meuId = await db.profileIdOf("broker");
    const meuLog = await db.select(`game_events?profile_id=eq.${meuId}&select=id&limit=1`);
    if (meuLog.length) {
      expect(
        await comoCorretor(`game_events?profile_id=eq.${meuId}&select=id&limit=1`),
      ).toHaveLength(1);
    }
  });

  /**
   * A fanfarra da loja, ponta a ponta.
   *
   * O `EngagementLayer` está montado no `AppLayout` e assina o realtime de
   * `game_events`: uma venda em QUALQUER tela solta som, confete e o card
   * "Venda fechada!". Até 06/09 nada em `e2e/` encostava nisso — `grep -rn
   * "confetti\|SaleCelebration" e2e/` voltava vazio —, então se o canal parasse
   * de assinar a tabela, se `event_code` mudasse ou se a publicação
   * `supabase_realtime` perdesse `game_events`, a suíte inteira continuaria
   * verde com a loja muda.
   *
   * O teste NÃO abre a Gamificação: o valor do card é justamente aparecer para
   * quem está em outra tela. O card fica 6 s na tela, e o `toBeVisible` do
   * Playwright reprova por ausência, não por atraso da entrega.
   */
  test("uma venda no banco toca a comemoração em qualquer tela", async ({ page }) => {
    const [temporada] = await db.select<{ id: string }>(
      "game_seasons?closed_at=is.null&select=id&order=period_start.desc&limit=1",
    );
    expect(temporada, "nenhuma temporada aberta — a gamificação está parada").toBeTruthy();

    // Fora da Gamificação de propósito.
    await page.goto("/dashboard");
    await aguardarCarregamento(page);
    await expect(page.getByText(/venda fechada!/i)).toHaveCount(0);

    // `ref_type` marcado: o `afterAll` deste arquivo limpa por ele.
    await db.insert("game_events", {
      season_id: temporada.id,
      profile_id: corretorId,
      event_code: "venda",
      points: 1,
      ref_type: tag,
    });

    // O nome sai de `visible_game_ranking`, não de `profiles`: quem está fora do
    // escopo do espectador vira "Equipe". O corretor enxerga a si mesmo.
    await expect(page.getByText(/venda fechada!/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("E2E Corretor", { exact: true }).first()).toBeVisible();
  });
});

