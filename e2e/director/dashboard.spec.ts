import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import type { Page } from "@playwright/test";

/**
 * O painel do diretor.
 *
 * Até 02/09/2026 quem tinha o papel `director` era desviado para uma tela
 * separada, só com o comparativo do diário — sem meta, sem VGV, sem ranking, sem
 * funil por etapa, sem selo de mês fechado — e não tinha como voltar: o
 * `RoleSwitcher` só aparece para admin, e é ferramenta de pré-visualização. Quem
 * manda na operação via MENOS número que o corretor que dirige, e nenhum teste,
 * de nenhum tipo, abria essa tela.
 *
 * Agora o diretor abre o Dashboard completo com uma ABA a mais ("Diretoria").
 * Este spec prova as duas metades: o painel completo aparece para ele, e a aba
 * traz o diário declarado ao lado do que o pipeline mediu.
 *
 * O cenário é montado por service_role de propósito: o diário entra por link
 * público com PIN e o negócio pelo pipeline — dois fluxos que têm spec próprio.
 * Aqui o que está sob teste é a LEITURA.
 */
const tag = runTag();
const hoje = new Date();
const MES = `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
const MES_ISO = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
// Dia 15: `report_date` no meio do mês não escorrega para o mês vizinho por fuso.
const DIA = `${MES_ISO.slice(0, 8)}15`;

let negocioId: string;
let relatorioId: string;
let metaFunilId: string;
let directorId: string;

test.beforeAll(async () => {
  const brokerId = await db.profileIdOf("broker");
  directorId = await db.profileIdOf("director");
  const [alfa] = await db.select<{ id: string }>("teams?slug=eq.equipe-e2e-alfa&select=id");
  if (!alfa) throw new Error("equipe E2E Alfa não existe; o provisionamento da suíte não rodou");

  const [etapa] = await db.select<{ id: string }>("pipeline_stages?code=eq.closed&select=id");
  const [deal] = await db.insert<{ id: string }>("deals", {
    stage_id: etapa.id,
    month_base: MES_ISO,
    outcome: "won",
    closed_at: new Date().toISOString(),
    vgv_gross: 800000,
    // Rótulo REAL do catálogo (o Select da tela não oferece "VENDA"): com a
    // categoria saindo do `status_detail`, esta venda sumia de todos os
    // indicadores. Agora quem manda é o `outcome`, e o teste percorre o caminho
    // que o usuário percorre.
    status_detail: "03. ASSINADO",
    notes: tag,
  });
  negocioId = deal.id;
  await db.insert("deal_clients", { deal_id: negocioId, ordinal: 1, full_name: `DIR-${tag}` });
  await db.insert("deal_participants", { deal_id: negocioId, profile_id: brokerId, role: "broker" });

  const [relatorio] = await db.insert<{ id: string }>("daily_reports", {
    team_id: alfa.id,
    report_date: DIA,
    notes: tag,
  });
  relatorioId = relatorio.id;
  await db.insert("daily_entries", {
    report_id: relatorioId,
    profile_id: brokerId,
    leads: 10,
    doc_collections: 3,
    analyses_sent: 2,
    analyses_approved: 1,
    sales: 1,
  });

  // A régua desta diretoria em `funnel_targets`. Números fora do 10/40/50 de
  // propósito: é a única forma de provar que a aba lê a TABELA e não o funil
  // ideal chumbado em `IDEAL_STAGES`.
  const [meta] = await db.insert<{ id: string }>("funnel_targets", {
    scope: "director",
    director_id: directorId,
    lead_to_analysis_pct: 15,
    analysis_to_approval_pct: 50,
    approval_to_sale_pct: 60,
  });
  metaFunilId = meta.id;
});

test.afterAll(async () => {
  await db.remove(`funnel_targets?id=eq.${metaFunilId}`);
  await db.remove(`daily_reports?id=eq.${relatorioId}`); // `daily_entries` cai por cascade
  // O trigger `deals_award_points` dá pontos por venda; sem isto o corretor E2E
  // ficaria pontuado na gamificação da homologação depois da suíte.
  await db.remove(`game_events?ref_id=eq.${negocioId}`);
  await db.remove(`deals?notes=eq.${tag}`);
});

/**
 * O cartão de uma etapa no bloco "Declarado × medido": o par é `N vs M`.
 *
 * O rótulo da etapa aparece três vezes na aba (funil ideal, declarado, medido);
 * só aqui ele vem seguido de "vs", e é por isso que o filtro procura o par.
 */
const paridade = (page: Page, etapa: string) =>
  page.getByRole("listitem").filter({ hasText: new RegExp(`${etapa}\\s*\\d+\\s+vs\\s+\\d+`) });

async function abrirDashboardNoMes(page: Page, mes: string) {
  await page.goto("/dashboard");
  await aguardarCarregamento(page);
  const seletorDeMes = page.getByRole("combobox").filter({ hasText: /\d{2}\/\d{4}/ });
  await seletorDeMes.click();
  await page.getByRole("option", { name: new RegExp(`^${mes.replace("/", "\\/")}`) }).click();
  await expect(seletorDeMes).toContainText(mes);
}

test.describe("diretor · dashboard", () => {
  test("o diretor abre o dashboard completo, não um painel reduzido", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    // A tela antiga do diretor tinha este título e mais nada; ela não existe mais.
    await expect(page.getByRole("heading", { name: "Painel do diretor" })).toHaveCount(0);

    // Os blocos que ele não tinha: VGV, meta, ranking e funil por etapa.
    await expect(page.getByText("VGV", { exact: true }).first()).toBeVisible();
    for (const aba of ["Visão geral", "Propostas", "Vendas", "Leads", "Metas", "Diretoria"]) {
      await expect(page.getByRole("tab", { name: aba, exact: true })).toBeVisible();
    }

    await page.getByRole("tab", { name: "Vendas", exact: true }).click();
    await expect(page.getByText("Ranking de corretores")).toBeVisible();
  });

  /**
   * Os dois recortes da mesma régua, escritos.
   *
   * `deals_select` chega em `can_read_all()` — o diretor lê o negócio de TODA a
   * empresa. `leads_select` recorta por `auth_visible_profiles()`, que para ele
   * é só a própria subárvore. A régua somava 35 negócios da operação ao lado de
   * 58 leads da subárvore e ainda dizia "total na base, sem recorte de período":
   * três números, dois conjuntos, nenhuma pista.
   */
  test("a régua diz de quem é cada número — negócio e lead não têm o mesmo recorte", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);

    await expect(page.getByText("vendas + em aberto · toda a operação")).toBeVisible();
    await expect(
      page.getByText(/recebidos em \d{2}\/\d{4} · os leads da sua carteira e das equipes que você lidera/),
    ).toBeVisible();
    await expect(page.getByText("total na base, sem recorte de período")).toHaveCount(0);
  });

  test("a meta comparada é a da EMPRESA, não a soma das equipes que ele lidera", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);

    // O numerador do cartão sai de `deals`, e `deals_select` chega em
    // `can_read_all()` = has_any_role('admin','director','partner'): o diretor
    // lê o negócio de TODA a operação, mesmo enxergando só a própria subárvore
    // de perfis em `auth_visible_profiles()`. Enquanto o escopo da meta saía da
    // segunda função, o cartão mostrava as vendas da empresa inteira sobre a
    // soma das metas das equipes dele, com o rótulo "meta da equipe" — o
    // realizado e o alvo eram de recortes diferentes.
    await expect(
      page.getByText(`Vendas realizadas × meta da empresa de ${MES}`).first(),
    ).toBeVisible();
    await expect(page.getByText(/Vendas realizadas × meta da equipe/)).toHaveCount(0);

    // E, sem linha cadastrada, a saída não pode dizer a ele que não existe
    // tela: `goals_write` aceita diretor e /equipes renderiza o cartão "Meta
    // global do mês" para o papel dele.
    await expect(page.getByText("lançada direto no banco pelo administrador")).toHaveCount(0);
  });

  test("a aba Diretoria mostra o diário declarado ao lado do pipeline medido", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);
    await page.getByRole("tab", { name: "Diretoria", exact: true }).click();
    await aguardarCarregamento(page);

    await expect(page.getByText("Diário × pipeline")).toBeVisible();
    // Nenhum estado vazio: o cenário lançou diário E negócio neste mês.
    await expect(page.getByText(`Nenhum lançamento em ${MES}`)).toHaveCount(0);
    await expect(page.getByText("Nenhuma equipe sob esta diretoria")).toHaveCount(0);

    // Os cinco indicadores do diário, do catálogo `DAILY_METRICS`.
    for (const rotulo of ["Leads", "Coleta Docs", "Análise Env.", "Análise Aprov.", "Venda"]) {
      await expect(page.getByText(rotulo, { exact: true }).first()).toBeVisible();
    }
    // E o comparativo, que é o motivo da aba existir.
    await expect(page.getByText("Declarado × medido")).toBeVisible();
    await expect(page.getByText("Diário (declarado)")).toBeVisible();
    await expect(page.getByText("Pipeline (real)")).toBeVisible();
  });

  test("o medido é cumulativo: a venda do mês conta como análise e aprovação", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);
    await page.getByRole("tab", { name: "Diretoria", exact: true }).click();
    await aguardarCarregamento(page);

    // O diário do cenário declarou 2 análises enviadas, 1 aprovada e 1 venda —
    // números CUMULATIVOS do mês. O negócio está em "Fechado", ou seja passou
    // pela análise e pela aprovação. Enquanto o medido era a fotografia da
    // etapa ATUAL, este mesmo cenário imprimia "2 vs 0 · 0% de aderência" em
    // vermelho para etapas que aconteceram, e o comparativo — o motivo da aba
    // existir — dizia o contrário do que o banco registrou.
    for (const etapa of ["Análises", "Aprovações", "Vendas"]) {
      await expect(paridade(page, etapa)).toContainText(/vs\s+[1-9]/);
    }
  });

  /**
   * A régua do funil sai de `funnel_targets`, não de um literal no frontend.
   *
   * O /checkpoint já lia a tabela e esta aba comparava contra 10/40/50 chumbado
   * (`IDEAL_STAGES`): o MESMO diretor era medido por uma régua em cada tela, e o
   * selo "Abaixo da meta" divergia com o mesmo dado embaixo. Nenhum teste, de
   * nenhum tipo, fixava qual meta o comparativo usa.
   */
  test("o comparativo é cobrado pela meta da diretoria, não pelo funil ideal", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);
    await page.getByRole("tab", { name: "Diretoria", exact: true }).click();
    await aguardarCarregamento(page);

    await expect(page.getByText("15 / 50 / 60% · meta da sua diretoria")).toBeVisible();
    await expect(page.getByText("Conversão realizada × meta da sua diretoria")).toBeVisible();
    // O rótulo do funil ideal só aparece quando NÃO há meta cadastrada.
    await expect(page.getByText("funil ideal — nenhuma meta cadastrada")).toHaveCount(0);
    // E a meta cobrada etapa a etapa é a da tabela: "/ 50%" em vez de "/ 40%".
    await expect(page.getByText("/ 50%").first()).toBeVisible();
  });

  test("o filtro de equipe recorta o comparativo sem esconder o painel", async ({ page }) => {
    await abrirDashboardNoMes(page, MES);
    await page.getByRole("tab", { name: "Diretoria", exact: true }).click();
    await aguardarCarregamento(page);

    const filtro = page.getByLabel("Filtrar por equipe");
    await expect(filtro).toBeVisible();
    await filtro.click();
    await page.getByRole("option", { name: "Equipe E2E Beta" }).click();
    await expect(filtro).toContainText("Equipe E2E Beta");

    // A Beta não recebeu diário nem negócio no cenário: a saída tem de dizer
    // qual filtro mexer, e não deixar o diretor percorrer os doze meses.
    await expect(
      page.getByText(new RegExp(`Nenhum lançamento em ${MES.replace("/", "\\/")}|não tem corretor vinculado`)),
    ).toBeVisible();
    // O resto do painel continua no ar — a aba não engole o dashboard.
    await expect(page.getByRole("tab", { name: "Metas", exact: true })).toBeVisible();
  });
});
