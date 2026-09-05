/**
 * O que o papel `marketing` alcança.
 *
 * Valeu como teste porque a divergência era real e cara: `lead_sources`,
 * `sdr_agents`, `remarketing_lists` e `whatsapp_templates` aceitam escrita de
 * `admin` e `marketing` (migrations 0003 e 0008), mas a configuração dessas
 * coisas mora dentro de /sdr, e `menu.sdr` não era concedido a `marketing`
 * (migration 0015): quem podia escrever não entrava na tela.
 *
 * A migration 0069 fechou a incoerência PELO LADO DO ACESSO — concedeu
 * `menu.sdr` a `marketing` em vez de tirar as policies de escrita, porque
 * remarketing é trabalho de marketing. Desde então este arquivo verifica a
 * outra metade: que ele entra E administra lá dentro, e que a recusa honesta
 * continua onde a matriz realmente não concede.
 */
import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";

const tag = runTag();
const idExterno = `acesso-${tag}`;
const nomeDaCampanha = `Campanha acesso ${tag}`;

/**
 * O cenário é montado pelo próprio spec, e não por um seed.
 *
 * A campanha antes vinha de `seeds/050_test_scenarios.sql`, que a homologação
 * não aplica (lá roda o `060_demo_showcase`) — o teste falhava por falta de
 * fixture, não por defeito. Criando aqui, ele passa a valer contra qualquer
 * banco em que a suíte rode.
 *
 * Os leads nascem atribuídos a um corretor de propósito: `leads_select` só
 * entrega a `marketing` a fila e o próprio perfil, então estes são exatamente
 * os que ela NÃO enxerga pelo PostgREST. É o recorte em que painel e tabela
 * divergiam.
 */
test.beforeAll(async () => {
  await db.insert("ad_campaigns", {
    external_id: idExterno,
    platform: "meta",
    name: nomeDaCampanha,
    status: "ACTIVE",
    total_spend: 3000,
  });
  const corretor = await db.profileIdOf("broker");
  await db.insert(
    "leads",
    [1, 2, 3].map((n) => ({
      full_name: `Lead ${n} ${tag}`,
      phone: `1198877${String(n).padStart(4, "0")}`,
      status: "assigned",
      assigned_to: corretor,
      assigned_at: new Date().toISOString(),
      campaign_id: idExterno,
      campaign_name: nomeDaCampanha,
    })),
  );
});

test.afterAll(async () => {
  await db.remove(`leads?campaign_id=eq.${idExterno}`);
  await db.remove(`ad_campaigns?external_id=eq.${idExterno}`);
});

test.describe("Marketing · alcance do papel", () => {
  test("abre a própria tela de marketing", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: /marketing/i })).toBeVisible();
    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
  });

  /**
   * Entrar não basta: o motivo de a 0069 ter concedido o menu é que as policies
   * já autorizavam a ESCRITA. Se o front voltasse a tratar `marketing` como
   * leitor, a tela abriria e mentiria — que é a mesma incoerência de antes, com
   * o sinal trocado.
   */
  test("entra no módulo SDR e administra o que as policies já autorizavam", async ({ page }) => {
    const concessao = await db.select<{ allowed: boolean }>(
      "role_permissions?role=eq.marketing&permission=eq.menu.sdr&select=allowed",
    );
    expect(
      concessao.some((r) => r.allowed),
      "sem `menu.sdr` para marketing, a 0069 não está neste banco e o cenário é outro",
    ).toBe(true);

    await page.goto("/sdr");
    await aguardarCarregamento(page);

    await expect(page.getByText(/acesso não liberado/i)).toHaveCount(0);
    await expect(page.getByRole("tab", { name: /agentes/i })).toBeVisible();

    // `sdr_agents_write` aceita marketing desde a 0008: o botão de criar e a
    // ausência da copy de leitura são o espelho disso em `SDR_WRITE_ROLES`.
    const painel = page.getByRole("tabpanel");
    await expect(painel.getByRole("button", { name: /^novo$/i })).toBeVisible();
    await expect(painel.getByText(/só consulta este módulo|somente leitura/i)).toHaveCount(0);
  });

  // A recusa honesta continua coberta — na tela que a matriz de fato NÃO
  // concede a marketing. O guard tem de dizer o motivo; tela vazia parece
  // defeito e gera chamado.
  test("é barrado na automação de leads com recusa honesta, não com tela vazia", async ({ page }) => {
    const concessao = await db.select<{ allowed: boolean }>(
      "role_permissions?role=eq.marketing&permission=eq.menu.admin_lead_automation&select=allowed",
    );
    expect(
      concessao.some((r) => r.allowed),
      "marketing passou a ter `menu.admin_lead_automation`: então a expectativa deste teste é que envelheceu, não a tela",
    ).toBe(false);

    await page.goto("/admin/lead-automation");
    await aguardarCarregamento(page);

    await expect(page.getByText(/acesso não liberado/i)).toBeVisible();
    await expect(page.getByText(/não tem permissão para esta tela/i)).toBeVisible();
    // E não renderiza nada da tela por baixo do aviso.
    await expect(page.getByRole("heading", { name: "Automação de Leads" })).toHaveCount(0);
  });

  /**
   * Os dois blocos da tela contam o MESMO lead.
   *
   * O teste mora aqui, e não em `campanhas.spec`, porque o papel `marketing` é
   * justamente o recorte que divergia: o painel somava `leads` pelo PostgREST e
   * o RLS devolve a ele só a fila e o próprio perfil, enquanto a tabela usa a
   * RPC agregada, que conta a empresa inteira. Mesma campanha, dois números.
   */
  test("painel e tabela mostram a mesma contagem de leads da campanha", async ({ page }) => {
    // service_role ignora RLS: é a contagem da empresa inteira, que é o que a
    // RPC devolve e o que as duas tabelas têm de mostrar.
    const noBanco = (await db.select(`leads?campaign_id=eq.${idExterno}&select=id`)).length;
    // Sem lead a comparação passaria com zero dos dois lados sem testar nada.
    expect(noBanco, "os leads do cenário sumiram — comparação seria vazia").toBeGreaterThan(0);
    const esperado = noBanco.toLocaleString("pt-BR");

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const painel = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Custo/lead" }) });
    const tabela = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Construtora" }) });

    // Painel: Campanha · Investido · Leads · … — tabela: Campanha · Canal ·
    // Construtora · Status · Investimento · Leads · …
    await expect(painel.getByRole("row").filter({ hasText: nomeDaCampanha }).locator("td").nth(2)).toHaveText(esperado);
    await expect(tabela.getByRole("row").filter({ hasText: nomeDaCampanha }).locator("td").nth(5)).toHaveText(esperado);
  });

  // O card "Próximo passo" dizia que a tela era maquete (ela já lê `ad_campaigns`)
  // e falava na voz do desenvolvedor ("me avise que eu peço as credenciais").
  test("não promete integração futura nem fala na primeira pessoa do desenvolvedor", async ({ page }) => {
    await page.goto("/marketing");
    await aguardarCarregamento(page);

    await expect(page.getByText(/me avise/i)).toHaveCount(0);
    await expect(page.getByText(/próximo passo/i)).toHaveCount(0);
    // E o título é a primeira coisa da página, não um card de tabela.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Marketing");
  });

  // O botão "Conectar Meta Ads" levava a /admin/meta-ads, que o guard barra
  // por `menu.admin_lead_automation`. Agora ele obedece à mesma matriz que o
  // guard: aparece se, e só se, o papel tem o código.
  test("só vê 'Conectar Meta Ads' quando a matriz concede a tela de destino", async ({ page }) => {
    const concessao = await db.select<{ allowed: boolean }>(
      "role_permissions?role=eq.marketing&permission=eq.menu.admin_lead_automation&select=allowed",
    );
    const podeConectar = concessao.some((r) => r.allowed);

    await page.goto("/marketing");
    await aguardarCarregamento(page);

    const botao = page.getByRole("link", { name: /conectar meta ads/i });
    if (podeConectar) {
      await botao.click();
      await expect(page.getByRole("heading", { name: "Configuração do Meta Ads", level: 1 })).toBeVisible();
    } else {
      await expect(botao).toHaveCount(0);
    }
  });
});
