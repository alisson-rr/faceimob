import { test, expect, db, runTag, aguardarCarregamento } from "../support/fixtures";

/**
 * `/admin/daily-teams` pela sessão de um DIRETOR.
 *
 * A 0062 amarrou `create_public_link`, `set_public_link_pin` e as policies de
 * `public_links` ao DONO (admin sempre; diretor só o próprio link e as equipes
 * sob ele) e, na mesma migration, abriu esta rota para o diretor. A tela filtra
 * pela mesma regra em `visibleTeams`/`visibleDirectors` — e esse recorte era
 * código sem nenhuma verificação: o SQL cobre `can_manage_public_link`, mas
 * quem decide o que aparece na lista é o cliente.
 *
 * Mostrar a linha de outra diretoria seria o pior dos dois mundos: o slug (que
 * a 0033 trata como metade do segredo) na tela, e todo botão recusado pelo
 * banco depois do clique.
 */

const tag = runTag();
const PIN_HASH = "$2a$06$On6loHaQgXqIOl9PmZJkGewH/uNU0GARZ.qwUqc.irdujr38Di1xi";

// Diretora do seed — outra diretoria, não a do diretor E2E desta sessão.
const OUTRA_DIRETORA_ID = "10000000-0000-0000-0000-000000000002";
const OUTRA_DIRETORA = "Daniela Diretora";

const equipeAlheia = `Equipe De Outro Diretor ${tag}`;
const slugAlheio = `dono-alheio-${tag}`;
let idEquipeAlheia = "";

test.beforeAll(async () => {
  const [equipe] = await db.insert<{ id: string }>("teams", {
    name: equipeAlheia,
    slug: `equipe-alheia-${tag}`,
    director_id: OUTRA_DIRETORA_ID,
    active: true,
  });
  idEquipeAlheia = equipe.id;

  // Com link e com PIN: se a linha vazasse, vazaria o slug junto.
  await db.insert("public_links", {
    kind: "daily_team", team_id: idEquipeAlheia, slug: slugAlheio,
    pin_hash: PIN_HASH, active: true,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  });
});

test.afterAll(async () => {
  // teams cascateia public_links.
  if (idEquipeAlheia) await db.remove(`teams?id=eq.${idEquipeAlheia}`);
});

test.describe("diretor · Diário — links e PINs", () => {
  test("a rota abre para o diretor", async ({ page }) => {
    // A policy e as RPCs sempre aceitaram diretor; só a rota barrava (0062).
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: /diário — links, pins & ips/i })).toBeVisible();
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
    await expect(page.getByText(/não consegui carregar os links/i)).toHaveCount(0);
  });

  test("vê as equipes da própria diretoria e não as de outra", async ({ page }) => {
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    // O positivo primeiro: sem ele a ausência do alheio seria verdade por
    // acidente (lista vazia também "não mostra a equipe de outro diretor").
    await expect(page.getByText("Equipe E2E Alfa", { exact: true })).toBeVisible();

    await expect(page.getByText(equipeAlheia)).toHaveCount(0);
    await expect(page.getByText(slugAlheio)).toHaveCount(0);
  });

  test("a lista de diretores mostra só ele — o link de diretoria é pessoal", async ({ page }) => {
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    await expect(page.getByText(/links públicos — diretores/i)).toBeVisible();
    await expect(page.getByText(OUTRA_DIRETORA)).toHaveCount(0);
  });

  test("o KPI de IPs não aparece: a tabela é de admin e voltaria vazia", async ({ page }) => {
    // `allowed_ips_read` (0044) exige `menu.admin_allowed_ips`. Para o diretor a
    // consulta volta 200 com lista VAZIA, sem erro — "IPs ativos 0" seria uma
    // afirmação falsa sobre a regra de check-in.
    await page.goto("/admin/daily-teams");
    await aguardarCarregamento(page);

    // O positivo é a faixa de KPIs: sem ele, "não existe IPs ativos" seria
    // verdade também numa tela que não carregou. O recorte por `main` é o que
    // separa o rótulo do KPI do item "Equipes" do menu lateral — dois textos
    // iguais, mas um é link dentro da navegação e o outro é o rótulo de um
    // número dentro do conteúdo.
    const conteudo = page.getByRole("main");
    await expect(conteudo.getByText("Equipes", { exact: true })).toBeVisible();
    await expect(conteudo.getByText("IPs ativos")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /gerenciar ips/i })).toHaveCount(0);
  });
});
