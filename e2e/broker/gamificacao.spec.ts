import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

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
    await expect(minhaLinha.getByRole("cell").last()).toHaveText(String(placar.points));
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
    await expect(page.getByRole("heading", { name: /ranking geral/i })).toBeVisible();

    await expect(page.getByRole("button", { name: /fechar gameficação/i })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Admin" })).toHaveCount(0);
  });
});
