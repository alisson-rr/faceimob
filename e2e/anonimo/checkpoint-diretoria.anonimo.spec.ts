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

// Link do seed, sem PIN, do diretor que tem Equipe Paulista e Equipe Sul.
const SLUG_SEED = "seed-diretoria-daniela";
const DIRETORA = "Daniela Diretora";
const DIRETORA_ID = "10000000-0000-0000-0000-000000000002";

const tag = runTag();
const slugComPin = `diretoria-${tag}`;

test.beforeAll(async () => {
  await db.insert("public_links", {
    kind: "director_checkpoint",
    director_id: DIRETORA_ID,
    slug: slugComPin,
    pin_hash: PIN_HASH,
    active: true,
  });
});

test.afterAll(async () => {
  await db.remove(`public_links?slug=eq.${slugComPin}`);
});

test.describe("checkpoint público da diretoria", () => {
  test("link real abre sem sessão e sem desvio para o login", async ({ page }) => {
    // Link protegido por PIN de propósito: a RPC resolve para NULL (a tela não
    // manda PIN — ver defeito 2 abaixo) e responde 200, sem 4xx no console. Com
    // `SLUG_SEED` este mesmo teste fica intermitente, porque a RPC devolve 400
    // e a corrida entre a asserção e o log do navegador decide o resultado.
    await page.goto(`/diretor/${slugComPin}`);

    await expect(page.getByRole("heading", { name: /checkpoint semanal — diretor/i })).toBeVisible();
    expect(page.url()).not.toContain("/login");
  });

  test("slug inexistente recusa sem revelar nada", async ({ page }) => {
    await page.goto(`/diretor/nao-existe-${tag}`);

    await expect(page.getByText(/link inválido ou inativo/i)).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);
    await expect(page.getByText(/equipe paulista/i)).toHaveCount(0);
  });

  test("link desativado recusa com a mesma mensagem do slug inexistente", async ({ page }) => {
    // Sem oráculo: quem tenta adivinhar slug não descobre quais existem.
    await db.update(`public_links?slug=eq.${slugComPin}`, { active: false });
    await page.goto(`/diretor/${slugComPin}`);

    await expect(page.getByText(/link inválido ou inativo/i)).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);

    await db.update(`public_links?slug=eq.${slugComPin}`, { active: true });
  });

  // Regressões da migration 0009 cobertas pela 0026: volatilidade correta,
  // contrato director/team_id/team_name e PIN antes de qualquer dado sensível.
  test("link sem PIN mostra o diretor, as equipes e o funil da semana", async ({ page }) => {
    await page.goto(`/diretor/${SLUG_SEED}`);

    await expect(page.getByText(DIRETORA)).toBeVisible();
    await expect(page.getByRole("button", { name: /equipe paulista/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /equipe sul/i })).toBeVisible();
    await expect(page.getByText(/nenhuma equipe vinculada/i)).toHaveCount(0);

    // O funil da semana é o motivo da tela existir.
    await expect(page.getByText(/leads → análises/i)).toBeVisible();
  });

  test("link com PIN pede o PIN antes de mostrar o funil", async ({ page }) => {
    // O payload `pin_required` não inclui diretor, equipes nem totais.
    await page.goto(`/diretor/${slugComPin}`);

    const campoPin = page.getByPlaceholder("••••••");
    await expect(campoPin).toBeVisible();
    await expect(page.getByText(DIRETORA)).toHaveCount(0);

    await campoPin.fill(PIN);
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByText(DIRETORA)).toBeVisible();
    await expect(page.getByRole("button", { name: /equipe paulista/i })).toBeVisible();
  });

  test("erro de rede não vira 'link inválido'", async ({ page, context }) => {
    // Rede e link inválido seguem mensagens diferentes; nenhum erro interno do
    // Postgres é exibido ao visitante.
    await page.goto(`/diretor/${SLUG_SEED}`);
    await expect(page.getByText(DIRETORA)).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: /semana anterior/i }).click();

    await expect(page.getByText(/erro de conexão|tente novamente/i)).toBeVisible();
    await expect(page.getByText(/link inválido ou inativo/i)).toHaveCount(0);

    await context.setOffline(false);
  });
});
