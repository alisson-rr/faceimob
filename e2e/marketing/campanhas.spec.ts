/**
 * Tela de Marketing na visão do papel `marketing`.
 *
 * O ponto que a auditoria cobrou aqui é "sem mock": a tela nasceu com campanhas
 * inventadas em `mockData` e o requisito é que cada linha venha de
 * `ad_campaigns`. Então os testes provam os dois sentidos — o que está no banco
 * aparece, e o que aparece está no banco.
 *
 * A segunda rodada cobre o que faltava: a ARITMÉTICA (nenhum caso conferia CPL
 * com número, então trocar `spend/leads` por `leads/spend` passava), o caminho
 * de CORREÇÃO (o único que perde dado), a EXCLUSÃO (que não existia por
 * caminho de usuário nenhum), a plataforma que não fosse Meta e o aviso do
 * lead que chega com campanha não cadastrada.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { mintSession, storageStateFor } from "../support/session";
import { E2E_USERS, type RoleKey } from "../support/users";
import type { Browser } from "@playwright/test";

const tag = runTag();

/** Contexto com a sessão REAL de outro papel: JWT de verdade, RLS valendo. */
async function abrirComo(browser: Browser, baseURL: string | undefined, key: RoleKey) {
  if (!baseURL) throw new Error("baseURL do Playwright ausente");
  const usuario = E2E_USERS.find((u) => u.key === key);
  if (!usuario) throw new Error(`papel E2E desconhecido: ${key}`);
  const contexto = await browser.newContext({
    baseURL,
    storageState: storageStateFor(await mintSession(usuario.email), baseURL),
  });
  return { contexto, pagina: await contexto.newPage() };
}

type CampanhaRow = {
  id: string;
  external_id: string;
  platform: string;
  name: string;
  status: string | null;
  developer_id: string | null;
  total_spend: number;
};

const CAMPOS = "id,external_id,platform,name,status,developer_id,total_spend";

const todasAsCampanhas = () =>
  db.select<CampanhaRow>(`ad_campaigns?select=${CAMPOS}&order=name`);

const campanhaPorNome = (nome: string) =>
  db.select<CampanhaRow>(`ad_campaigns?name=eq.${encodeURIComponent(nome)}&select=${CAMPOS}`);

/** A tabela de campanhas é a que tem a coluna "Construtora" (a outra é a do
 *  painel de investimento × resultado, que não tem construtora). */
const tabelaDeCampanhas = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Construtora" }) });

/** Painel "Investimento × resultado", identificado pela coluna Custo/lead. */
const tabelaDePerformance = (page: import("@playwright/test").Page) =>
  page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Custo/lead" }) });

const leadsDaCampanha = (externo: string, quantos: number, sufixo: string) =>
  Array.from({ length: quantos }, (_, i) => ({
    full_name: `Lead ${i + 1} ${sufixo}`,
    phone: `1198855${String(i).padStart(4, "0")}`,
    campaign_id: externo,
    campaign_name: `Campanha ${sufixo}`,
  }));

test.afterAll(async () => {
  await db.remove(`leads?campaign_id=like.*${tag}*`);
  await db.remove(`ad_campaigns?external_id=like.*${tag}*`);
  await db.remove(`deals?unit=like.*${tag}*`);
  await db.remove(`developers?name=like.*${tag}*`);
});

test.describe("Marketing · campanhas", () => {
  test("a tabela é ad_campaigns, sem linha inventada", async ({ page }) => {
    const criada = `Campanha ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: `ext-${tag}`,
      platform: "meta",
      name: criada,
      status: "ACTIVE",
      total_spend: 1234,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const tabela = tabelaDeCampanhas(page);
    // Ida: uma campanha que só existe no banco aparece na tela.
    await expect(tabela.getByText(criada, { exact: true })).toBeVisible();
    await expect(tabela.getByRole("row").filter({ hasText: criada })).toContainText("R$ 1.234");

    // Volta: nenhum nome na tela sem lastro no banco — é isso que mata o mock.
    const doBanco = new Set((await todasAsCampanhas()).map((c) => c.name));
    const naTela = await tabela.locator("tbody tr td:nth-child(1)").allTextContents();
    expect(naTela.length).toBeGreaterThan(0);
    for (const nome of naTela) {
      expect(doBanco, `"${nome}" está na tela e não em ad_campaigns`).toContain(nome.trim());
    }
  });

  test("cadastra campanha pelo painel e grava em ad_campaigns", async ({ page }) => {
    const externo = `painel-${tag}`;
    const nome = `Painel ${tag}`;

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByLabel("ID externo da campanha").fill(externo);
    await page.getByLabel("Nome da campanha").fill(nome);
    await page.getByLabel("Total investido").fill("2500");
    await page.getByRole("button", { name: /salvar/i }).click();

    await expect(page.getByText(/campanha registrada/i)).toBeVisible({ timeout: 15_000 });

    const [gravada] = await campanhaPorNome(nome);
    expect(gravada, "campanha não chegou em ad_campaigns").toBeTruthy();
    expect(gravada.name).toBe(nome);
    expect(Number(gravada.total_spend)).toBe(2500);
    expect(gravada.platform).toBe("meta");

    // E volta para a tela sem recarregar a página.
    await expect(
      tabelaDePerformance(page).getByRole("row").filter({ hasText: nome }),
    ).toContainText("R$ 2.500,00");
  });

  /**
   * O formulário gravava `platform: "meta"` fixo, nunca preenchia
   * `developer_id` e não deixava definir `status` — campanha criada pela tela
   * nascia sem construtora, sem status e nunca entrava em "Campanhas Ativas".
   */
  test("cadastra campanha de outra plataforma, com construtora e status", async ({ page }) => {
    const externo = `google-${tag}`;
    const nome = `Google ${tag}`;
    const [construtora] = await db.insert<{ id: string; name: string }>("developers", {
      name: `Construtora Campanha ${tag}`,
      slug: `construtora-campanha-${tag}`,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByLabel("ID externo da campanha").fill(externo);
    await page.getByLabel("Nome da campanha").fill(nome);
    await page.getByLabel("Plataforma da campanha").click();
    await page.getByRole("option", { name: "Google" }).click();
    await page.getByLabel("Construtora da campanha").click();
    await page.getByRole("option", { name: construtora.name }).click();
    await page.getByLabel("Status da campanha").click();
    await page.getByRole("option", { name: "Pausada" }).click();
    await page.getByLabel("Total investido").fill("1500");
    await page.getByRole("button", { name: /salvar/i }).click();

    await expect(page.getByText(/campanha registrada/i)).toBeVisible({ timeout: 15_000 });

    const [gravada] = await campanhaPorNome(nome);
    expect(gravada.platform).toBe("google");
    expect(gravada.developer_id).toBe(construtora.id);
    expect(gravada.status).toBe("PAUSED");

    await expect(
      tabelaDeCampanhas(page).getByRole("row").filter({ hasText: nome }),
    ).toContainText(construtora.name);
  });

  /**
   * O caminho que PERDE dado: errar o id externo não tinha conserto — sem
   * edição e sem exclusão, a campanha errada nunca casaria com lead nenhum e
   * continuaria somando no KPI de investimento para sempre.
   */
  test("corrige o id externo de uma campanha já cadastrada, sem duplicar a linha", async ({ page }) => {
    const errado = `errado-${tag}`;
    const certo = `certo-${tag}`;
    const nome = `Corrigir ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: errado, platform: "meta", name: nome, status: "ACTIVE", total_spend: 100,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await tabelaDePerformance(page).getByRole("button", { name: `Editar ${nome}` }).click();
    await expect(page.getByLabel("ID externo da campanha")).toHaveValue(errado);

    await page.getByLabel("ID externo da campanha").fill(certo);
    await page.getByLabel("Total investido").fill("900");
    await page.getByRole("button", { name: /^salvar$/i }).click();
    await expect(page.getByText(/campanha atualizada/i)).toBeVisible({ timeout: 15_000 });

    const linhas = await campanhaPorNome(nome);
    expect(linhas, "corrigir criou uma segunda campanha em vez de alterar a existente").toHaveLength(1);
    expect(linhas[0].external_id).toBe(certo);
    expect(Number(linhas[0].total_spend)).toBe(900);
  });

  test("exclui campanha pela tela e ela sai de ad_campaigns", async ({ page }) => {
    const externo = `excluir-${tag}`;
    const nome = `Excluir ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: externo, platform: "meta", name: nome, status: "ACTIVE", total_spend: 50,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    page.once("dialog", (d) => void d.accept());
    await tabelaDePerformance(page).getByRole("button", { name: `Excluir ${nome}` }).click();
    await expect(page.getByText(/campanha excluída/i)).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      expect(await campanhaPorNome(nome)).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });

  test("filtro sem resultado zera os números em vez de inventar", async ({ page }) => {
    // Campanha só desta execução, para o par (canal, status) ser previsível.
    await db.insert("ad_campaigns", {
      external_id: `tiktok-${tag}`,
      platform: "tiktok",
      name: `TikTok pausada ${tag}`,
      status: "PAUSED",
      total_spend: 900,
    });

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByLabel("Filtrar por canal").click();
    await page.getByRole("option", { name: "TikTok" }).click();
    await page.getByLabel("Filtrar por status").click();
    await page.getByRole("option", { name: "Ativa", exact: true }).click();

    await expect(page.getByText(/Faceimob • 0 campanhas/)).toBeVisible();
    await expect(tabelaDeCampanhas(page).locator("tbody tr")).toHaveCount(0);
    // Sem lead no recorte, o CPL vira "—" e não "R$ 0,00" — zero mentiria.
    // O travessão aparece em várias células; o que importa é o KPI de CPL.
    await expect(
      page.getByText("CPL Médio", { exact: true }).locator("xpath=../following-sibling::p[1]"),
    ).toHaveText("—");
    // E o vazio é explicado, em vez de deixar só o cabeçalho da tabela. São
    // DUAS caixas (o painel de cima e a tabela de baixo) e as duas dizem a
    // mesma coisa: o painel afirmava "nenhuma campanha cadastrada" enquanto a
    // tabela, na mesma dobra, dizia corretamente que era o filtro.
    await expect(page.getByText(/nenhuma campanha neste filtro/i).first()).toBeVisible();
    await expect(page.getByText(/nenhuma campanha cadastrada/i)).toHaveCount(0);
  });

  /**
   * A RPC agregada conta inclusive os leads já distribuídos sem ampliar o SELECT
   * de dados pessoais concedido ao papel marketing — e agora a conta é conferida
   * com NÚMERO: R$ 3.000 ÷ 3 leads = R$ 1.000. Nenhum caso fazia isso, então
   * inverter a divisão passava.
   */
  test("a contagem e o CPL da campanha batem com o banco", async ({ page }) => {
    const externo = `contagem-${tag}`;
    const nome = `Contagem ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: externo,
      platform: "meta",
      name: nome,
      status: "ACTIVE",
      total_spend: 3000,
    });

    // Atribuídos a um corretor: `leads_select` não entrega esses leads a
    // `marketing`, então o número na tela só pode ter vindo da RPC.
    const corretor = await db.profileIdOf("broker");
    await db.insert(
      "leads",
      [1, 2, 3].map((n) => ({
        full_name: `Lead ${n} ${tag}`,
        phone: `1198866${String(n).padStart(4, "0")}`,
        status: "assigned",
        assigned_to: corretor,
        assigned_at: new Date().toISOString(),
        campaign_id: externo,
        campaign_name: nome,
      })),
    );

    const doBanco = await db.select<{ campaign_id: string }>(
      `leads?campaign_id=eq.${externo}&select=campaign_id`,
    );
    expect(doBanco.length, "os leads do cenário sumiram — a contagem seria zero").toBe(3);

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    // A asserção mira a célula de Leads (6ª coluna: Campanha · Canal ·
    // Construtora · Status · Investimento · Leads) e não a linha: contra a linha
    // inteira, "3" também aparece em "R$ 3.000" e a regressão de Leads = 0
    // passaria despercebida.
    const linha = tabelaDeCampanhas(page).getByRole("row").filter({ hasText: nome });
    await expect(linha.locator("td").nth(5)).toHaveText("3");
    // CPL é a 8ª coluna: 3000 / 3 = 1.000, e não 3 / 3000 = 0.
    await expect(linha.locator("td").nth(7)).toContainText("R$ 1.000");
    // Custo/lead do painel conta a mesma coisa, com centavos.
    await expect(
      tabelaDePerformance(page).getByRole("row").filter({ hasText: nome }).locator("td").nth(4),
    ).toContainText("R$ 1.000,00");
  });

  /**
   * Lead que chega com `campaign_id` de campanha que ninguém cadastrou ficava
   * invisível: não tem custo, não aparece em lugar nenhum e some da conta sem
   * aviso.
   */
  test("avisa quando chega lead de campanha não cadastrada", async ({ page }) => {
    const fantasma = `fantasma-${tag}`;
    await db.insert("leads", leadsDaCampanha(fantasma, 2, `${tag}-fantasma`));

    // O número tem de ser o do banco: leads com `campaign_id` que não casa com
    // nenhuma linha de `ad_campaigns` (os do seed contam junto com estes dois).
    const cadastradas = new Set((await todasAsCampanhas()).map((c) => c.external_id));
    const comCampanha = await db.select<{ campaign_id: string }>("leads?campaign_id=not.is.null&select=campaign_id");
    const orfaos = comCampanha.filter((l) => !cadastradas.has(l.campaign_id)).length;
    expect(orfaos, "o cenário precisa de pelo menos os 2 leads fantasmas").toBeGreaterThanOrEqual(2);

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const aviso = page.getByRole("alert").filter({ hasText: /campanha não cadastrada/i });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText(orfaos.toLocaleString("pt-BR"));
  });
});

/**
 * As três colunas que a auditoria cobrou: custo por VENDA, a idade do gasto e o
 * orçamento diário.
 */
test.describe("Marketing · o que a coluna promete", () => {
  /**
   * "Custo/negócio" conta lead com `converted_deal_id`: proposta em aberto
   * entra e venda perdida também. Quem lia "R$ 2.000 por negócio" entendia
   * "paguei 2.000 por uma venda" — e podia não ter vendido nada. `sales`
   * (0081) separa os dois, e sem venda o custo por venda é travessão.
   */
  test("custo por negócio e custo por venda são números diferentes, e sem venda o segundo não existe", async ({ page }) => {
    const externo = `venda-${tag}`;
    const nome = `Campanha Venda ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: externo,
      platform: "meta",
      name: nome,
      status: "ACTIVE",
      total_spend: 2000,
    });

    // Negócio em ABERTO: conta como conversão e não como venda. É o caso que
    // fazia a tela parecer dizer que a campanha se pagou.
    const [estagio] = await db.select<{ id: string }>("pipeline_stages?is_initial=is.true&select=id&limit=1");
    const corretor = await db.profileIdOf("broker");
    const [negocio] = await db.insert<{ id: string }>("deals", {
      stage_id: estagio.id,
      created_by: corretor,
      unit: `unidade ${tag}`,
      // `vgv_net` é GENERATED ALWAYS (vgv_gross × desconto): mandar valor
      // explícito volta 400 do PostgREST e o teste morre no preparo.
      vgv_gross: 400000,
    });

    // Mesmas chaves nas duas linhas: lote com formato desigual volta 400
    // (PGRST102, "All object keys must match"). `queued` é o próprio default da
    // coluna — explicitar não muda o cenário, só uniformiza o payload.
    await db.insert("leads", [
      { full_name: `Lead venda 1 ${tag}`, phone: "11988770001", campaign_id: externo, converted_deal_id: negocio.id, status: "converted" },
      { full_name: `Lead venda 2 ${tag}`, phone: "11988770002", campaign_id: externo, converted_deal_id: null, status: "queued" },
    ]);

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    // Campanha · Investido · Leads · Conversões · Custo/lead · Custo/negócio ·
    // Custo/venda · VGV atribuído · ROAS · Ações
    const linha = tabelaDePerformance(page).getByRole("row").filter({ hasText: nome });
    await expect(linha.locator("td").nth(2)).toHaveText("2");
    await expect(linha.locator("td").nth(3)).toHaveText("1");
    await expect(linha.locator("td").nth(4)).toContainText("R$ 1.000,00");
    await expect(linha.locator("td").nth(5)).toContainText("R$ 2.000,00");
    await expect(
      linha.locator("td").nth(6),
      "negócio em aberto virou venda: o custo por venda não pode ter número",
    ).toHaveText("—");
    // E o VGV atribuído também não conta negócio que ainda não foi ganho.
    await expect(linha.locator("td").nth(7)).toHaveText("—");
  });

  /**
   * O caso POSITIVO das duas colunas que o caso acima só exercita no travessão.
   *
   * Sem ele, uma coluna PERMANENTEMENTE morta passava na suíte: enquanto
   * `marketing_campaign_stats` não devolver `sales` (a 0081 está no repositório
   * e não estava aplicada na homologação quando isto foi escrito),
   * `Number(row.sales ?? 0)` é sempre 0, `costPerLead(spend, 0)` é sempre null e
   * a coluna Custo/venda é travessão em 100% das linhas — exatamente o que o
   * caso de cima espera. Este caso falha alto até a 0081 entrar, que é o sinal
   * certo.
   */
  test("com o negócio GANHO, custo por venda e VGV atribuído viram número", async ({ page }) => {
    const externo = `ganho-${tag}`;
    const nome = `Campanha Ganha ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: externo,
      platform: "meta",
      name: nome,
      status: "ACTIVE",
      total_spend: 3000,
    });

    // `deals_closed_consistency` exige `closed_at` para qualquer outcome que não
    // seja 'open'; `vgv_net` é gerado a partir de `vgv_gross`.
    const [fechada] = await db.select<{ id: string }>("pipeline_stages?code=eq.closed&select=id");
    const corretor = await db.profileIdOf("broker");
    const [negocio] = await db.insert<{ id: string }>("deals", {
      stage_id: fechada.id,
      created_by: corretor,
      unit: `unidade ganha ${tag}`,
      vgv_gross: 500000,
      outcome: "won",
      closed_at: new Date().toISOString(),
    });

    // Mesmas chaves nas três linhas, pelo mesmo motivo do caso acima (PGRST102).
    await db.insert("leads", [
      { full_name: `Lead ganho 1 ${tag}`, phone: "11988770011", campaign_id: externo, converted_deal_id: negocio.id, status: "converted" },
      { full_name: `Lead ganho 2 ${tag}`, phone: "11988770012", campaign_id: externo, converted_deal_id: null, status: "queued" },
      { full_name: `Lead ganho 3 ${tag}`, phone: "11988770013", campaign_id: externo, converted_deal_id: null, status: "queued" },
    ]);

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    // Campanha · Investido · Leads · Conversões · Custo/lead · Custo/negócio ·
    // Custo/venda · VGV atribuído · ROAS · Ações
    const linha = tabelaDePerformance(page).getByRole("row").filter({ hasText: nome });
    await expect(linha.locator("td").nth(2)).toHaveText("3");
    await expect(linha.locator("td").nth(3)).toHaveText("1");
    await expect(linha.locator("td").nth(4)).toContainText("R$ 1.000,00");
    await expect(
      linha.locator("td").nth(6),
      "Custo/venda continua travessão: `marketing_campaign_stats` não devolve `sales` (a 0081 não foi aplicada)",
    ).toContainText("R$ 3.000,00");
    await expect(
      linha.locator("td").nth(7),
      "VGV atribuído continua travessão com o negócio já ganho",
    ).toContainText("R$ 500.000");
  });

  /**
   * `synced_at` era buscado e nunca exibido: o operador não sabia se o gasto
   * que divide TODAS as contas da linha era de ontem ou de julho. E
   * `daily_budget` era lido e aceito pela camada de dados sem nenhum campo de
   * tela que o preenchesse — a coluna existia sempre nula.
   */
  test("a linha diz que o gasto é digitado e mostra o orçamento diário que o formulário gravou", async ({ page }) => {
    const externo = `teto-${tag}`;
    const nome = `Campanha Teto ${tag}`;

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByLabel("ID externo da campanha").fill(externo);
    await page.getByLabel("Nome da campanha").fill(nome);
    await page.getByLabel("Total investido").fill("900");
    await page.getByLabel("Orçamento diário").fill("150");
    await page.getByRole("button", { name: /salvar/i }).click();
    await expect(page.getByText(/campanha registrada/i)).toBeVisible({ timeout: 15_000 });

    await expect(async () => {
      const [gravada] = await db.select<{ daily_budget: number | null; synced_at: string | null }>(
        `ad_campaigns?external_id=eq.${externo}&select=daily_budget,synced_at`,
      );
      expect(gravada, "a campanha não chegou em ad_campaigns").toBeTruthy();
      expect(Number(gravada.daily_budget), "o orçamento diário não foi gravado").toBe(150);
      expect(gravada.synced_at, "nada no código sincroniza: synced_at tem de nascer nulo").toBeNull();
    }).toPass({ timeout: 10_000 });

    const investido = tabelaDePerformance(page).getByRole("row").filter({ hasText: nome }).locator("td").nth(1);
    await expect(investido).toContainText("R$ 900,00");
    // Honestidade sobre a origem do número: ninguém sincronizou nada.
    await expect(investido).toContainText("digitado");
    await expect(investido).toContainText("R$ 150");

    // A mesma honestidade na LEITURA do status. O formulário já avisava que
    // mudar ali não pausa nada na Meta; o KPI e a etiqueta da tabela
    // apresentavam `ad_campaigns.status` como o estado real da campanha, e nada
    // no sistema escreve `synced_at` — o status é sempre digitado.
    await expect(page.getByText(/status digitado; a Meta não é consultada/i)).toBeVisible();
    const statusNaTabela = tabelaDeCampanhas(page)
      .getByRole("row")
      .filter({ hasText: nome })
      .locator("td")
      .nth(3);
    await expect(statusNaTabela).toContainText("digitado");
  });

  test("orçamento diário negativo é recusado com instrução, não com erro do banco", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await page.getByLabel("ID externo da campanha").fill(`negativo-${tag}`);
    await page.getByLabel("Nome da campanha").fill(`Campanha Negativa ${tag}`);
    await page.getByLabel("Orçamento diário").fill("-10");
    await page.getByRole("button", { name: /salvar/i }).click();

    await expect(page.getByText(/orçamento diário inválido/i)).toBeVisible();
    expect(await campanhaPorNome(`Campanha Negativa ${tag}`)).toHaveLength(0);
  });

  /**
   * O botão de sincronizar não pode fingir que funciona: sem o token da
   * Marketing API no cofre ele fica desabilitado COM o motivo escrito. Um botão
   * que erra em silêncio por falta de chave é pior que um desabilitado.
   */
  test("o botão de sincronizar com a Meta está desabilitado e diz qual credencial falta", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const botao = page.getByRole("button", { name: /sincronizar gasto com a meta/i });
    await expect(botao).toBeDisabled();
    await expect(page.getByText(/ads_read/)).toBeVisible();
    await expect(page.getByText(/ads_management/)).toBeVisible();
    // E o formulário diz que o status é registro local: sem essa frase, marcar
    // "Pausada" aqui passa por ter pausado a campanha na Meta — e o dinheiro
    // continua saindo.
    await expect(page.getByText(/não pausa nem altera nada na Meta/i)).toBeVisible();
  });
});

/**
 * O recorte de escrita da tela: `ad_campaigns_write` é `admin OU marketing`,
 * mas `reports.view_finance` (a leitura) vale também para diretor, gerente e
 * sócio. Eles precisam LER a tabela e não podem ver o formulário — que era o
 * desenho antigo, em que todo Salvar voltava 42501.
 */
test.describe("Marketing · quem lê e quem escreve", () => {
  // Diretor e gerente têm `reports.view_finance` e nenhum dos dois via este
  // recorte em teste. O sócio também tem, mas não existe usuário `partner` na
  // suíte (`e2e/support/users.ts` tem dez papéis e o sócio não está entre eles).
  for (const papel of ["director", "manager"] as const) {
  test(`o papel ${papel} vê a tabela de campanhas e não vê o formulário de cadastro`, async ({ browser, baseURL }) => {
    const externo = `leitor-${papel}-${tag}`;
    const nome = `Campanha ${papel} ${tag}`;
    await db.insert("ad_campaigns", {
      external_id: externo,
      platform: "meta",
      name: nome,
      status: "ACTIVE",
      total_spend: 700,
    });

    const { contexto, pagina } = await abrirComo(browser, baseURL, papel);
    try {
      await pagina.goto("/marketing");
      await aguardarCarregamento(pagina);

      await expect(pagina.getByText(/acesso não liberado/i)).toHaveCount(0);
      await expect(pagina.getByRole("heading", { name: "Marketing", level: 1 })).toBeVisible();
      await expect(pagina.getByText(nome, { exact: true }).first()).toBeVisible();

      // O formulário e as ações são de admin/marketing.
      await expect(pagina.getByLabel("ID externo da campanha")).toHaveCount(0);
      await expect(pagina.getByRole("button", { name: `Editar ${nome}` })).toHaveCount(0);
      await expect(pagina.getByRole("button", { name: `Excluir ${nome}` })).toHaveCount(0);
      await expect(pagina.getByRole("button", { name: /sincronizar gasto com a meta/i })).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
  }

  /**
   * A negativa só era exercitada no sentido inverso (marketing barrado em
   * /admin/lead-automation). O corretor não tem `menu.marketing`, e a recusa
   * precisa dizer o motivo: tela vazia parece defeito e gera chamado.
   */
  test("o corretor bate em /marketing e recebe recusa honesta, não tela vazia", async ({ browser, baseURL }) => {
    const concessao = await db.select<{ allowed: boolean }>(
      "role_permissions?role=eq.broker&permission=eq.menu.marketing&select=allowed",
    );
    expect(
      concessao.some((r) => r.allowed),
      "o corretor passou a ter `menu.marketing`: então é a expectativa deste teste que envelheceu",
    ).toBe(false);

    const { contexto, pagina } = await abrirComo(browser, baseURL, "broker");
    try {
      await pagina.goto("/marketing");
      await aguardarCarregamento(pagina);

      await expect(pagina.getByText(/acesso não liberado/i)).toBeVisible();
      await expect(pagina.getByText(/não tem permissão para esta tela/i)).toBeVisible();
      // E nada da tela por baixo do aviso.
      await expect(pagina.getByRole("heading", { name: "Marketing", level: 1 })).toHaveCount(0);
    } finally {
      await contexto.close();
    }
  });
});

test.describe("Marketing · no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  // A tela tem duas tabelas largas (8 e 10 colunas). Cada uma rola dentro do
  // próprio `overflow-x-auto`; o que não pode é a PÁGINA rolar.
  test("as tabelas rolam por dentro e a página não vai para a direita", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: "Marketing", level: 1 })).toBeVisible();

    const sobra = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await sobra(), "a aba Campanhas rola na horizontal em 375 px").toBeLessThanOrEqual(1);

    await page.getByRole("tab", { name: "Por construtora" }).click();
    await expect(page.getByRole("columnheader", { name: "ROAS" })).toBeVisible();
    expect(await sobra(), "a aba Por construtora rola na horizontal em 375 px").toBeLessThanOrEqual(1);
  });

  /**
   * A faixa de comparação só existe com um MÊS escolhido — com "Todo o período"
   * ela nem é renderizada, e medir a página naquele estado não prova nada sobre
   * ela. E o defeito que interessa aqui não aparece em `document.scrollWidth`:
   * o KpiCard é `overflow-hidden` e "R$ 1.250.000" é um token inquebrável (o
   * pt-BR usa NBSP depois do "R$"), então o valor é CORTADO por dentro, sem
   * empurrar a página. Por isso a medida é do próprio <p> do valor.
   */
  test("a faixa de comparação não corta o valor dos cartões em 375 px", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: "Por construtora" }).click();
    await expect(page.getByRole("columnheader", { name: "ROAS" })).toBeVisible();

    await page.getByLabel("Período do resumo").click();
    await page.getByRole("option").nth(1).click(); // o primeiro mês da lista é o corrente

    const faixa = page.getByRole("group", { name: "Comparação com o mês anterior" });
    await expect(faixa).toBeVisible();

    const cortados = await faixa.locator("p.font-display").evaluateAll((els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.textContent} (${el.scrollWidth} > ${el.clientWidth})`),
    );
    expect(cortados, "cartão da faixa cortando o valor em 375 px").toEqual([]);

    const sobra = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sobra, "a faixa de comparação rola na horizontal em 375 px").toBeLessThanOrEqual(1);
  });
});
