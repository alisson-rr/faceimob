import { test, expect, db, runTag, aguardarCarregamento } from "../support/fixtures";

/**
 * Administração dos links do Diário — `/admin/daily-teams`.
 *
 * A tela lê `public_links` e é a única porta para gerar PIN, renovar validade e
 * desativar um link. O que este arquivo guarda é o que a suíte de rotas não vê:
 * `rotas-positivas` confere o TÍTULO, e o título aparece mesmo quando as duas
 * consultas falham — foi exatamente assim que a tela ficou vazia sem ninguém
 * notar.
 *
 * O DEFEITO COBERTO: a tela passou a pedir `has_pin,pin_set_at`, colunas que
 * nascem na migration 0062. O deploy do front não espera o `db push`; num banco
 * sem elas o PostgREST devolve 42703, o erro subia do `queryFn` e derrubava as
 * DUAS consultas — nem equipe, nem diretor, nem botão de PIN, só o alerta
 * "Não consegui carregar os links". Este cenário passa nos dois bancos, que é o
 * requisito: antes e depois da migration.
 */

const tag = runTag();
const PIN_HASH = "$2a$06$On6loHaQgXqIOl9PmZJkGewH/uNU0GARZ.qwUqc.irdujr38Di1xi";

const equipeComLink = `Equipe Links ${tag}`;
const slugDoLink = `admin-links-${tag}`;
let teamId = "";

test.beforeAll(async () => {
  const [equipe] = await db.insert<{ id: string }>("teams", {
    name: equipeComLink,
    slug: `equipe-links-${tag}`,
    active: true,
  });
  teamId = equipe.id;

  // Link COM PIN: é o que prova que a tela sabe dizer "Renovar PIN" — o rótulo
  // do botão sai de `has_pin`, que é a coluna que pode não existir ainda.
  await db.insert("public_links", {
    kind: "daily_team", team_id: teamId, slug: slugDoLink,
    pin_hash: PIN_HASH, active: true,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
});

test.afterAll(async () => {
  // teams cascateia public_links.
  if (teamId) await db.remove(`teams?id=eq.${teamId}`);
});

test.describe("Admin · Diário — links e PINs", () => {
  test("a lista carrega mesmo quando o banco ainda não tem as colunas da 0062", async ({ page }) => {
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    // Consulta que falha não pode virar tela vazia — nem tela vazia sem aviso.
    await expect(page.getByText(/não consegui carregar os links/i)).toHaveCount(0);

    await expect(page.getByText(equipeComLink)).toBeVisible();
    await expect(page.getByText(slugDoLink).first()).toBeVisible();
  });

  test("o estado do PIN chega à tela com ou sem a coluna calculada", async ({ page }) => {
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    // Com `has_pin` sempre falso (o modo degradado mal feito), NENHUMA linha
    // diria "Renovar PIN" — todas ofereceriam "Gerar PIN" sobre links que já
    // têm PIN, e o clique invalidaria o código que o gerente está usando.
    await expect(page.getByRole("button", { name: /renovar pin/i }).first()).toBeVisible();
  });

  test("o KPI de IPs é do admin, que é quem enxerga a tabela", async ({ page }) => {
    // `allowed_ips_read` (0044) exige `menu.admin_allowed_ips`; sem a permissão
    // a consulta volta 200 com lista VAZIA, sem erro. Para o admin o número é
    // real e fica; para o diretor que a 0062 traz a esta rota, "IPs ativos 0"
    // seria uma afirmação falsa — por isso o KPI é condicional.
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    await expect(page.getByText("IPs ativos")).toBeVisible();
  });
});
