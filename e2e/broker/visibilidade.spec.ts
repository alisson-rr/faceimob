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

    // O grupo "Configurações" EXISTE para o corretor — ele tem /settings, que é
    // a própria conta. Cobrar a ausência do grupo (como se cobrava do antigo
    // "Administração") passaria a ser falso pelo motivo errado. O que separa um
    // papel do outro são os ITENS, conferidos acima; aqui fica a prova de que o
    // grupo, quando aparece, aparece SÓ com o que o corretor pode abrir.
    const configuracoes = page.getByRole("group", { name: "Configurações" });
    await expect(configuracoes.getByRole("link", { name: "Configurações" })).toBeVisible();
    await expect(
      configuracoes.getByRole("link"),
      "corretor não abre nenhuma tela de configuração além da própria conta",
    ).toHaveCount(1);
  });

  // A entrada do sistema ("/" e o pós-login) manda para a primeira tela que o
  // papel abre, não para /dashboard fixo — quem não tem `menu.dashboard` caía
  // em "Acesso não liberado" logo depois de entrar. Corretor tem, então o
  // destino continua sendo o dashboard.
  test('"/" leva o corretor ao dashboard', async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await aguardarCarregamento(page);
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
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

/**
 * A planilha do Pipeline é a folha de comissão da operação: sai com VGV,
 * percentual de rateio e VGV POR CORRETOR de todo o recorte filtrado, num
 * arquivo que anda por WhatsApp. Até 05/09/2026 o botão era de quem abrisse o
 * Pipeline — e corretor, SDR e marketing abrem.
 *
 * A trava é `pipeline.export` (migration 0092), concedida a admin e sócio.
 *
 * O que este teste NÃO promete: que o dado esteja fechado. O RLS já entregou os
 * negócios à tela; o que a permissão remove é o caminho de um clique. Fechar de
 * verdade exigiria gerar a planilha no servidor.
 */
test("o corretor não tem o botão que extrai a planilha de comissão", async ({ page }) => {
  await page.goto("/pipeline");
  await aguardarCarregamento(page);

  // Âncora: a tela carregou de verdade. Sem ela, um Pipeline que não renderizou
  // passaria como "sem botão de extrair".
  await expect(page.getByRole("heading", { name: /pipeline/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /extrair planilha/i })).toHaveCount(0);
});
