import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import type { Page } from "@playwright/test";

/**
 * Meta do Dashboard.
 *
 * Decisão de 08/08 (`docs/sprints/decisoes.md`): a meta sai de `goals`
 * (`period_type='month'`, `metric='sales'`) e a tela não inventa alvo enquanto a
 * linha não existir. O denominador segue o escopo de quem está olhando — meta do
 * próprio perfil, da equipe que lidera ou da empresa —, e este project roda como
 * admin, que enxerga todos os perfis: para ele vale a meta 'global'.
 *
 * O ponto do teste é o "não sei": o medidor antigo trazia um alvo chumbado, e um
 * número inventado no lugar de "não sei" é pior do que espaço em branco, porque
 * a diretoria decide em cima dele.
 *
 * Mês escolhido: 01/2026 é passado, está aberto e não tem meta no seed. Usar um
 * mês futuro faria `pickOpenMonth` mudar o padrão do dashboard de todo mundo.
 */
const tag = runTag();
const MES = "01/2026";
const ISO = "2026-01-01";
const META = 4;

let negocioId: string;
let adminId: string;

test.beforeAll(async () => {
  adminId = await db.profileIdOf("admin");

  // Qualquer escopo, não só o global: com uma meta de perfil ou de equipe na
  // mesa, `pickSalesGoal` escolheria essa e o primeiro teste falharia por um
  // motivo que não é o dele.
  const jaTem = await db.select(`goals?period_type=eq.month&period=eq.${ISO}&metric=eq.sales&select=id`);
  if (jaTem.length) throw new Error(`já existe meta de vendas para ${MES}; o cenário do teste supõe que não`);

  const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.closed&select=id");
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    month_base: ISO,
    outcome: "won",
    closed_at: new Date().toISOString(),
    vgv_gross: 500000,
    // Rótulo REAL do catálogo de Status 2. O teste usava "VENDA", que o Select
    // da tela NÃO oferece: a suíte ficava verde sem provar o caminho que o
    // usuário percorre, e uma venda marcada como "03. ASSINADO" não contava
    // para a meta (a categoria saía do rótulo, não do `outcome`).
    status_detail: "03. ASSINADO",
    notes: tag,
  });
  negocioId = deal.id;
  await db.insert("deal_clients", { deal_id: negocioId, ordinal: 1, full_name: `META-${tag}` });
});

test.afterAll(async () => {
  // Só o escopo que o teste criou. O guard do `beforeAll` é amplo de propósito
  // (qualquer escopo atrapalha o `pickSalesGoal`), mas apagar com o mesmo filtro
  // levaria junto meta de equipe ou de perfil de 01/2026 — inclusive a linha
  // alheia que fez o guard abortar, que precisa continuar lá para ser
  // investigada (o Playwright roda este hook mesmo com o `beforeAll` em erro).
  await db.remove(`goals?scope=eq.global&period_type=eq.month&period=eq.${ISO}&metric=eq.sales`);
  await db.remove(`deals?notes=eq.${tag}`);
});

/**
 * O medidor da meta.
 *
 * A Tarefa F tirou a meta da régua de KPIs e a pôs num cartão próprio
 * (`GoalCard`), porque "Meta —" no meio de seis números não dizia nada a quem
 * estava olhando. O número grande do cartão é montado em dois nós (`25` e `%`),
 * então a asserção precisa é a barra: ela declara `aria-valuenow` e um
 * `aria-label` com o escopo, o período, a realização e o alvo.
 */
const medidorDaMeta = (page: Page) =>
  page.getByRole("progressbar", { name: /(sua meta|meta da equipe|meta da empresa) de vendas de/i });

async function abrirMetasDe(page: Page, mes: string) {
  await page.goto("/dashboard");
  await aguardarCarregamento(page);

  // A barra do topo tem o seu próprio combobox ("Pré-visualizar como papel"):
  // o seletor de mês é o que mostra MM/AAAA.
  const seletorDeMes = page.getByRole("combobox").filter({ hasText: /\d{2}\/\d{4}/ });
  await seletorDeMes.click();
  await page.getByRole("option", { name: new RegExp(`^${mes.replace("/", "\\/")}`) }).click();
  await expect(seletorDeMes).toContainText(mes);

  // A aba "Metas" é a que hospeda o `GoalCard` desde a Tarefa F.
  await page.getByRole("tab", { name: "Metas", exact: true }).click();
}

test.describe("dashboard · meta mensal", () => {
  test("sem linha em goals o cartão diz que não há meta, em vez de inventar um alvo", async ({ page }) => {
    await abrirMetasDe(page, MES);

    await expect(page.getByText(`Sem meta cadastrada para ${MES}`)).toBeVisible();
    // E manda para onde se cadastra — o admin pode gravar (`goals_write`).
    await expect(page.getByText(/meta de vendas da empresa neste mês ainda não foi cadastrada/i)).toBeVisible();
    // O MÊS que falta vai ESCRITO. O cartão "Meta global do mês" de /equipes
    // abre no mês do CALENDÁRIO e ainda não lê o `?mes=` da URL (pendência com
    // o dono de `src/components/equipes/GlobalGoalCard.tsx`): quem clicava aqui
    // olhando 01/2026 caía no formulário do mês corrente e gravava a meta no mês
    // errado sem perceber. Enquanto o destino não lê o parâmetro, é a frase que
    // impede o erro — por isso ela é o que se afirma, não só o atributo do link.
    await expect(page.getByText(`escolhendo ${MES} no campo Mês`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Cadastrar em Equipes" })).toHaveAttribute(
      "href",
      `/equipes?mes=${ISO.slice(0, 7)}`,
    );
    // Nenhum medidor: sem alvo não há percentual a mostrar.
    await expect(medidorDaMeta(page)).toHaveCount(0);
  });

  /**
   * O link não pode ser beco sem saída: um botão "Cadastrar em Equipes" que
   * levasse a uma tela sem o formulário mandaria a pessoa procurar sozinha.
   *
   * O que ainda NÃO se afirma aqui é o valor do campo: `GlobalGoalCard` inicia o
   * mês com o relógio e não lê o `?mes=`. Quando a leitura do parâmetro entrar
   * (pendência registrada), troque a asserção de visibilidade por
   * `await expect(campoMes).toHaveValue(ISO.slice(0, 7))` — é ela que fecha o laço.
   */
  test("o botão de cadastrar leva ao formulário da meta global, com o campo Mês", async ({ page }) => {
    await abrirMetasDe(page, MES);

    await page.getByRole("link", { name: "Cadastrar em Equipes" }).click();
    await expect(page).toHaveURL(/\/equipes/);
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: "Meta global do mês" })).toBeVisible();
    const campoMes = page.locator("#meta-global-mes");
    await expect(campoMes).toBeVisible();
  });

  test("cadastrada a meta em goals, o medidor passa a usá-la", async ({ page }) => {
    await db.insert("goals", {
      scope: "global",
      period_type: "month",
      period: ISO,
      metric: "sales",
      target: META,
      created_by: adminId,
    });

    await abrirMetasDe(page, MES);

    // Uma venda no mês contra a meta de quatro: 25%.
    await expect(page.getByText(`1 de ${META} vendas`)).toBeVisible();
    await expect(page.getByText(`Faltam 3 para bater a meta`)).toBeVisible();
    await expect(medidorDaMeta(page)).toHaveAttribute("aria-valuenow", "25");
    // O rótulo nomeia o escopo: quem lê sabe de quem é a meta embaixo do número.
    await expect(medidorDaMeta(page)).toHaveAttribute(
      "aria-label",
      `Meta da empresa de vendas de ${MES}: 1 de ${META}`,
    );
    await expect(page.getByText(`Vendas realizadas × meta da empresa de ${MES}`)).toBeVisible();
  });

  /**
   * O laço "cadastro em Equipes → leitura no Dashboard" só fecha se os dois
   * lados falarem do mesmo mês. O `GlobalGoalCard` de /equipes abre no mês do
   * CALENDÁRIO; o filtro daqui listava só os meses COM negócio. Resultado
   * medido na homologação em 02/09/2026: a meta de 14 vendas para 09/2026
   * estava gravada e 09/2026 não existia no seletor — quem cadastrava a meta do
   * mês corrente não conseguia vê-la em lugar nenhum.
   */
  test("o mês corrente aparece no filtro mesmo sem negócio, e diz que está vazio", async ({ page }) => {
    const hoje = new Date();
    const mesCorrente = `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;

    await page.goto("/dashboard");
    await aguardarCarregamento(page);
    await page.getByRole("combobox").filter({ hasText: /\d{2}\/\d{4}/ }).click();

    const opcao = page.getByRole("option", { name: new RegExp(`^${mesCorrente.replace("/", "\\/")}`) });
    await expect(opcao).toHaveCount(1);
    await opcao.click();
    await expect(page.getByRole("combobox").filter({ hasText: /\d{2}\/\d{4}/ })).toContainText(mesCorrente);
  });

  /**
   * A aba Leads não era aberta por spec nenhum, em nenhum dos dez perfis: ela
   * podia estar em estado de erro que a suíte inteira ficava verde.
   *
   * O que se prova aqui: a aba abre e SEGUE o filtro de período do topo — os
   * blocos do painel carimbam o mês no próprio rótulo. De quem é o número é dito
   * na régua de KPIs, que fica FORA das abas; aqui ela entra só como contagem,
   * para provar que o cartão "Base de leads" não voltou a ser duplicado dentro
   * da aba. O texto antigo era "total na base, sem recorte de período", que nega
   * um recorte que existe — `leads_select` recorta por `auth_visible_profiles()`,
   * e para o sócio, sem `leads.view_queue`, a base ainda vem menor que a real.
   */
  test("a aba Leads abre, segue o período e não repete o cartão da régua", async ({ page }) => {
    await page.goto("/dashboard");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Leads", exact: true }).click();
    await aguardarCarregamento(page);

    // Ou há lead na base, ou a saída explica o vazio — nunca a tela em branco.
    const comLeads = page.getByText("Leads no período");
    const semLeads = page.getByText(/Nenhum lead (na base|em \d{2}\/\d{4}|no seu recorte)/);
    await expect(comLeads.or(semLeads).first()).toBeVisible();

    // Com a aba ABERTA (fechada, o painel nem está no DOM e a contagem seria 1 à
    // toa): o rótulo do recorte existe UMA vez. O admin passa em `is_admin()`,
    // então `has_permission('leads.view_queue')` é verdadeiro e o recorte dele é
    // "toda a base"; o cartão que dizia o mesmo dentro da aba foi removido.
    await expect(page.getByText("sem recorte de período · toda a base")).toHaveCount(1);
    await expect(page.getByText("total na base, sem recorte de período")).toHaveCount(0);

    if (await comLeads.isVisible()) {
      // Dentro do painel: os blocos carimbam o mês do filtro do topo. É isto que
      // prova que a aba obedece ao período — a régua obedeceria de qualquer jeito.
      const aba = page.getByRole("tabpanel", { name: "Leads" });
      await expect(aba.getByText(/Canal de aquisição · \d{2}\/\d{4}/)).toBeVisible();
      await expect(aba.getByText(/Os dez com mais leads recebidos · \d{2}\/\d{4}/)).toBeVisible();
    }
  });

  test("o botão de recarregar refaz a carga sem sair da tela", async ({ page }) => {
    // Sem ele a única forma de ver dado novo era esperar os 60 s de `staleTime`
    // ou recarregar a página inteira, perdendo mês e aba escolhidos.
    await page.goto("/dashboard");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Metas", exact: true }).click();

    await page.getByRole("button", { name: "Recarregar o painel" }).click();
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    // A aba escolhida sobrevive: é recarga de dado, não da página.
    await expect(page.getByRole("tab", { name: "Metas", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // O admin não é diretor: a aba da diretoria não é dele, e o painel completo é.
  test("admin cai no dashboard comum, sem a aba da diretoria", async ({ page }) => {
    await page.goto("/dashboard");
    await aguardarCarregamento(page);

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Metas", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Diretoria", exact: true })).toHaveCount(0);
  });
});
