import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import {
  abrirPipelineFiltrado,
  limparCenario,
  linhaDoCliente,
  montarDuasEquipes,
} from "../matriz/cenario";

/**
 * Ata de 23/07: "corretores veem apenas seus negócios".
 *
 * É o risco silencioso do projeto: o RLS esconde linha sem erro nenhum, então
 * uma tela migrada errado (que lê de outro lugar, ou que ignora o filtro)
 * parece funcionar. Por isso o cenário nasce com DOIS negócios — um da equipe
 * do corretor e um da equipe rival — e o teste cobra os dois lados: o que tem
 * de aparecer aparece, o que não tem de aparecer não aparece.
 */
const tag = runTag();
let alfa: { id: string; cliente: string };
let beta: { id: string; cliente: string };

test.beforeAll(async () => {
  ({ alfa, beta } = await montarDuasEquipes(tag));
});

test.afterAll(async () => {
  await limparCenario(tag);
});

test.describe("corretor · visibilidade de negócios", () => {
  test("vê o próprio negócio e não vê o da equipe rival", async ({ page }) => {
    await abrirPipelineFiltrado(page, tag);

    // O positivo primeiro: se a lista ainda não carregou, a ausência do rival
    // seria verdade por acidente e o teste não provaria nada.
    await expect(linhaDoCliente(page, alfa.cliente)).toBeVisible();
    await expect(linhaDoCliente(page, beta.cliente)).toHaveCount(0);
  });

  test("os dois negócios existem no banco — a ausência é do RLS, não do cenário", async () => {
    const linhas = await db.select<{ id: string }>(
      `deals?notes=eq.${tag}&select=id`,
    );
    expect(linhas.map((l) => l.id).sort()).toEqual([alfa.id, beta.id].sort());
  });
});

test.describe("corretor · menu e rotas administrativas", () => {
  test("o menu não oferece o que o papel não tem", async ({ page }) => {
    await page.goto("/pipeline");
    await aguardarCarregamento(page);

    // Âncora: o corretor TEM Pipeline. Sem ela, um menu que não renderizou
    // passaria como "menu sem itens de admin".
    await expect(page.getByRole("link", { name: "Pipeline" })).toBeVisible();

    for (const item of ["Permissões", "Integrações", "Construtoras", "IPs autorizados"]) {
      await expect(page.getByRole("link", { name: item })).toHaveCount(0);
    }
    // Checkpoint é de diretor/gerente — é o item que separa corretor de "dual".
    await expect(page.getByRole("link", { name: "Checkpoint" })).toHaveCount(0);
    await expect(page.getByText("Administração")).toHaveCount(0);
  });

  test("URL direta de /admin/permissions é negada", async ({ page }) => {
    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);

    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
    // Esconder o menu não protege rota: a matriz não pode renderizar.
    await expect(page.getByRole("tab", { name: /acesso ao menu/i })).toHaveCount(0);
  });

  test("URL direta de /admin/integrations é negada", async ({ page }) => {
    await page.goto("/admin/integrations");
    await aguardarCarregamento(page);

    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
  });
});
