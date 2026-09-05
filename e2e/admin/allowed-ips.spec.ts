/**
 * IPs autorizados para check-in (ata de 14/07: "o check-in permanece restrito
 * por IP para prevenir fraudes").
 *
 * O que importa aqui não é a lista aparecer, é a faixa cadastrada passar a
 * valer: cada caso confere a gravação em `allowed_ips` e o efeito em
 * `ip_is_allowed`, que é a função que `perform_checkin` consulta. Cadastro que
 * mostra toast verde e não muda a decisão do check-in é pior que erro visível.
 *
 * Endereços de teste vêm de 203.0.113.0/24 (TEST-NET-3, RFC 5737): faixa
 * reservada para documentação, nunca roteável — cadastrá-la não libera nada.
 */
import { test, expect, db, comoAdmin, aguardarCarregamento, runTag } from "../support/fixtures";

type FaixaIp = { id: string; ip_range: string; label: string; active: boolean };

// Pelo nome acessível, não pelo placeholder: o placeholder some no primeiro
// caractere digitado, então ancorar nele é ancorar num rótulo que não existe
// enquanto o admin usa o campo.
const campoIp = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "IP ou faixa CIDR" });
const campoDescricao = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "Descrição" });

/**
 * Toast de sucesso do cadastro — o único sinal de que a gravação terminou.
 *
 * `getByText(/IP autorizado/i)` não servia: a tela grava "IP autorizado" como
 * rótulo padrão quando a descrição vem vazia, e a homologação já tem uma faixa
 * com esse rótulo na lista. A asserção casava com uma linha que estava na tela
 * ANTES do clique, então o teste passava direto e ia consultar o banco com o
 * POST ainda em voo. O trace do run de 02/09 prova: corpo correto
 * (`203.0.113.128/25`), resposta 201 — depois de `buscarPorRotulo` já ter
 * voltado vazio. O ponto final é o que separa o toast do rótulo da lista.
 */
const toastDeSucesso = (page: import("@playwright/test").Page) =>
  page.getByText("IP autorizado.", { exact: true });

test.describe("IPs autorizados para check-in", () => {
  const tag = runTag();
  let brokerId = "";
  const rotulos: string[] = [];

  /** Rótulo único por caso — é por ele que o teste acha e limpa o que criou. */
  const rotuloPara = (caso: string) => {
    const rotulo = `E2E ${caso} ${tag}`;
    rotulos.push(rotulo);
    return rotulo;
  };
  const buscarPorRotulo = (rotulo: string) =>
    db.select<FaixaIp>(
      `allowed_ips?label=eq.${encodeURIComponent(rotulo)}&select=id,ip_range,label,active`,
    );

  test.beforeAll(async () => {
    brokerId = await db.profileIdOf("broker");
  });

  test.afterAll(async () => {
    for (const rotulo of rotulos) {
      await db.remove(`allowed_ips?label=eq.${encodeURIComponent(rotulo)}`);
    }
  });

  /**
   * O total do cabeçalho é a única pista de quantas faixas existem. Ele nascia
   * em "Lista (0)" no primeiro paint e continuava zerado quando a leitura
   * falhava (o `load()` só dava toast e voltava) — a mesma tela para "não há
   * faixa" e para "não consegui ler". Hoje a lista tem esqueleto enquanto
   * carrega e estado de erro próprio; o número só aparece depois da resposta.
   */
  test("o total do cabeçalho é o que o banco tem, nunca um zero de carregamento", async ({ page }) => {
    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await expect(async () => {
      const total = (await db.select<{ id: string }>("allowed_ips?select=id")).length;
      await expect(page.getByRole("heading", { name: `Lista (${total})`, exact: true })).toBeVisible();
    }).toPass({ timeout: 10_000 });
  });

  test("cadastrar uma faixa passa a liberar o check-in daquele IP", async ({ page }) => {
    const rotulo = rotuloPara("cadastro");
    const ip = "203.0.113.11";

    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "cenário: o IP não podia estar liberado antes do cadastro",
    ).toBe(false);

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill(ip);
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("button", { name: /adicionar/i }).click();

    await expect(toastDeSucesso(page)).toBeVisible();
    // Digitado sem máscara, guardado como host único — e sem equipe, vale para todos.
    await expect(page.getByText(`${ip}/32`)).toBeVisible();
    await expect(page.getByText(`${ip}/32`).locator("xpath=..")).toContainText("todas as equipes");

    const linhas = await buscarPorRotulo(rotulo);
    expect(linhas, "toast de sucesso sem linha gravada é tela mentindo").toHaveLength(1);
    expect(linhas[0].ip_range).toBe(`${ip}/32`);
    expect(linhas[0].active).toBe(true);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "a faixa cadastrada precisa valer para o check-in",
    ).toBe(true);
  });

  test("cadastrar em CIDR cobre a faixa inteira, não só um host", async ({ page }) => {
    const rotulo = rotuloPara("faixa");
    const faixa = "203.0.113.128/25";

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill(faixa);
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(toastDeSucesso(page)).toBeVisible();

    const linhas = await buscarPorRotulo(rotulo);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].ip_range, "máscara informada não pode virar /32").toBe(faixa);

    // Contenção resolvida pelo Postgres (<<), não por comparação de string.
    expect(await db.rpc<boolean>("ip_is_allowed", { candidate: "203.0.113.200", who: brokerId })).toBe(true);
    expect(await db.rpc<boolean>("ip_is_allowed", { candidate: "203.0.113.5", who: brokerId })).toBe(false);
  });

  /**
   * Gravação em voo: o botão precisa parar de aceitar clique.
   *
   * `allowed_ips` não tem unique em `ip_range` — antes do guarda, dois cliques
   * no "Adicionar" criavam a mesma faixa duas vezes e a lista de antifraude
   * ficava com linha duplicada que ninguém sabia se podia remover.
   *
   * A resposta do POST é segurada e respondida no lugar do PostgREST
   * (`fulfill`), como no spec de integrações: nada é gravado e a fase "em voo"
   * dura o tempo da asserção em vez de um piscar dependente da latência.
   */
  test("enquanto a gravação está em voo o botão não aceita um segundo clique", async ({ page }) => {
    let liberar: () => void = () => undefined;
    const preso = new Promise<void>((resolve) => { liberar = resolve; });
    await page.route("**/rest/v1/allowed_ips*", async (route) => {
      // Só o POST do cadastro; o GET da lista continua vindo do banco de verdade.
      if (route.request().method() !== "POST") return route.continue();
      await preso;
      await route.fulfill({ status: 201, body: "" });
    });

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    const botao = page.getByRole("button", { name: /adicionar/i });
    await campoIp(page).fill("203.0.113.51");
    await botao.click();

    await expect(botao).toHaveAttribute("aria-busy", "true");
    await expect(botao, "botão clicável durante a gravação é a faixa duplicada").toBeDisabled();

    liberar();
    await expect(toastDeSucesso(page)).toBeVisible();
    await expect(botao).toBeEnabled();
  });

  test("desativar a faixa pela tela tira o IP do check-in", async ({ page }) => {
    const rotulo = rotuloPara("toggle");
    const ip = "203.0.113.21";
    await db.insert("allowed_ips", { label: rotulo, ip_range: `${ip}/32` });

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    const linha = page.getByText(`${ip}/32`).locator("xpath=..");
    await linha.getByText("ativo", { exact: true }).click();
    await expect(linha.getByText("inativo", { exact: true })).toBeVisible();

    const [gravada] = await buscarPorRotulo(rotulo);
    expect(gravada.active, "o estado do badge tem que estar no banco").toBe(false);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "faixa inativa não pode continuar liberando check-in",
    ).toBe(false);
  });

  test("remover a faixa apaga a linha depois de confirmar", async ({ page }) => {
    const rotulo = rotuloPara("remocao");
    const ip = "203.0.113.31";
    await db.insert("allowed_ips", { label: rotulo, ip_range: `${ip}/32` });

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    const linha = page.getByText(`${ip}/32`).locator("xpath=..");
    // A remoção é confirmada por `window.confirm`; sem tratar o diálogo o
    // Playwright o dispensa e a linha continuaria lá.
    page.once("dialog", (d) => void d.accept());
    await linha.getByRole("button", { name: `Remover ${ip}/32` }).click();

    await expect(page.getByText(`${ip}/32`)).toHaveCount(0);
    expect(await buscarPorRotulo(rotulo)).toHaveLength(0);
  });

  test("descobrir o próprio IP preenche o formulário e diz se ele já está coberto", async ({ page }) => {
    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    // Depende de api.ipify.org (serviço externo chamado pelo próprio app) —
    // limitação registrada no relatório.
    await page.getByRole("button", { name: /descobrir meu ip/i }).click();
    await expect(campoIp(page)).toHaveValue(/^\d{1,3}(\.\d{1,3}){3}$/);

    const meuIp = await campoIp(page).inputValue();
    const adminId = await db.profileIdOf("admin");
    const [perfil] = await db.select<{ bypass_ip_check: boolean }>(
      `profiles?id=eq.${adminId}&select=bypass_ip_check`,
    );
    const coberto = await db.rpc<boolean>("ip_is_allowed", { candidate: meuIp, who: adminId });
    // O aviso é o que decide se o admin precisa cadastrar: comparar string na
    // tela diria "não cadastrado" para um IP já dentro de uma faixa /24. E com
    // bypass no próprio perfil `ip_is_allowed` diz true para qualquer IP — aí o
    // selo verde mentiria; a tela tem de avisar que o teste não prova faixa.
    const esperado = perfil.bypass_ip_check
      ? /liberação individual de IP/i
      : coberto ? /já coberto por uma faixa cadastrada/i : /não coberto/i;
    await expect(page.getByText(esperado)).toBeVisible();
  });

  test("faixa restrita a uma equipe só libera quem é membro dela — e a lista diz isso", async ({ page }) => {
    const rotulo = rotuloPara("equipe");
    const ip = "203.0.113.41";
    const [alfa] = await db.select<{ id: string }>("teams?slug=eq.equipe-e2e-alfa&select=id");
    const rivalId = await db.profileIdOf("brokerRival"); // Beta

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill(ip);
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("combobox", { name: /equipe/i }).click();
    await page.getByRole("option", { name: "Equipe E2E Alfa" }).click();
    await page.getByRole("button", { name: /adicionar/i }).click();
    await expect(toastDeSucesso(page)).toBeVisible();

    // Antes a faixa restrita aparecia igual à global — o admin concluía "está
    // tudo certo" e o corretor de outra equipe continuava barrado.
    const linha = page.getByText(`${ip}/32`).locator("xpath=..");
    await expect(linha).toContainText("só Equipe E2E Alfa");

    const [gravada] = await db.select<FaixaIp & { team_id: string | null }>(
      `allowed_ips?label=eq.${encodeURIComponent(rotulo)}&select=id,ip_range,label,active,team_id`,
    );
    expect(gravada.team_id, "o escopo escolhido na tela tem de estar no banco").toBe(alfa.id);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: brokerId }),
      "membro da Alfa passa",
    ).toBe(true);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ip, who: rivalId }),
      "corretor da Beta continua barrado por uma faixa da Alfa",
    ).toBe(false);
  });

  /**
   * Liberação individual de IP (`profiles.bypass_ip_check`).
   *
   * É a exceção à trava antifraude: com ela ligada, `ip_is_allowed` responde
   * true para QUALQUER endereço. Até esta tela existir, o único caminho
   * suportado para um corretor de IP dinâmico era um UPDATE direto no banco —
   * e ninguém conseguia ver quem já estava isento.
   *
   * O corretor usado aqui é o `brokerThird`, não o `broker`: `roleta.spec.ts`
   * liga e desliga o bypass do `broker` no meio do próprio teste.
   */
  test("liberar e revogar a isenção de IP muda o que ip_is_allowed responde", async ({ page }) => {
    const terceiroId = await db.profileIdOf("brokerThird");
    const ipDeFora = "203.0.113.61"; // fora de qualquer faixa cadastrada aqui
    const [perfilAntes] = await db.select<{ full_name: string; bypass_ip_check: boolean }>(
      `profiles?id=eq.${terceiroId}&select=full_name,bypass_ip_check`,
    );
    expect(perfilAntes.bypass_ip_check, "cenário: o corretor precisa começar sem isenção").toBe(false);
    expect(
      await db.rpc<boolean>("ip_is_allowed", { candidate: ipDeFora, who: terceiroId }),
      "cenário: o IP não pode estar liberado antes da isenção",
    ).toBe(false);

    try {
      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);

      await page.getByRole("combobox", { name: /pessoa para liberar/i }).click();
      await page.getByRole("option", { name: perfilAntes.full_name }).click();
      // Liberar alguém da trava por IP é decisão de segurança: a tela confirma.
      page.once("dialog", (d) => void d.accept());
      await page.getByRole("button", { name: /^liberar$/i }).click();

      await expect(page.getByText(`${perfilAntes.full_name} liberado da validação de IP.`)).toBeVisible();
      expect(
        await db.rpc<boolean>("ip_is_allowed", { candidate: ipDeFora, who: terceiroId }),
        "com isenção, qualquer endereço passa — é o que a tela promete",
      ).toBe(true);

      // Revogar devolve o corretor às faixas cadastradas.
      await page
        .getByRole("button", { name: `Revogar liberação individual de ${perfilAntes.full_name}` })
        .click();
      await expect(
        page.getByText(`${perfilAntes.full_name} voltou a depender das faixas cadastradas.`),
      ).toBeVisible();

      const [perfilDepois] = await db.select<{ bypass_ip_check: boolean }>(
        `profiles?id=eq.${terceiroId}&select=bypass_ip_check`,
      );
      expect(perfilDepois.bypass_ip_check, "o estado do botão tem que estar no banco").toBe(false);
      expect(await db.rpc<boolean>("ip_is_allowed", { candidate: ipDeFora, who: terceiroId })).toBe(false);
    } finally {
      // Isenção sobrando desliga a trava por IP para o corretor nos outros specs.
      await comoAdmin.update(`profiles?id=eq.${terceiroId}`, { bypass_ip_check: false });
    }
  });

  /**
   * "Ninguém está isento" é afirmação positiva sobre a trava antifraude.
   *
   * A leitura das isenções só dava toast quando falhava (`bypass` continuava
   * `[]`): passado o toast, a tela dizia "Liberação individual de IP (0)" e
   * "Ninguém está isento" com o banco sem ter respondido — a mesma tela para
   * "não há isenção" e para "não consegui ler". Só o GET das isenções é
   * derrubado; o resto da tela continua vindo do banco de verdade.
   */
  test.describe(() => {
    test.use({ errosEsperados: [/status of 500|Failed to load resource/i] });

    test("com a leitura das isenções fora do ar, a tela não afirma que ninguém está isento", async ({ page }) => {
      await page.route("**/rest/v1/profiles*", async (route) => {
        if (!route.request().url().includes("bypass_ip_check=eq.true")) return route.continue();
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "erro simulado de leitura" }),
        });
      });

      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);

      // Texto exato: o toast diz "…as liberações individuais." e some sozinho.
      await expect(page.getByText("Não foi possível carregar as liberações", { exact: true })).toBeVisible();
      await expect(page.getByText(/lista está vazia por erro de leitura/i)).toBeVisible();
      await expect(page.getByText(/ninguém está isento/i)).toHaveCount(0);
      // O total também não pode ser inventado antes da resposta.
      await expect(page.getByRole("heading", { name: /liberação individual de ip \(/i })).toHaveCount(0);
    });
  });

  /**
   * "Lista (N)" é afirmação sobre quantas faixas antifraude existem.
   *
   * O contador só era suprimido no carregamento; o ramo de erro sai do `load()`
   * sem tocar em `rows`, então uma leitura que falha imprimia "Lista (0)" — zero
   * faixa cadastrada — logo acima do estado de erro que diz o contrário. Aqui só
   * o GET de `allowed_ips` cai; o resto da tela continua vindo do banco.
   */
  test.describe(() => {
    test.use({ errosEsperados: [/status of 500|Failed to load resource/i] });

    test("com a leitura das faixas fora do ar, a tela não anuncia zero faixa cadastrada", async ({ page }) => {
      await page.route("**/rest/v1/allowed_ips*", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "erro simulado de leitura" }),
        });
      });

      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);

      await expect(page.getByText("Não foi possível carregar a lista", { exact: true })).toBeVisible();
      await expect(page.getByText(/não porque não há faixas cadastradas/i)).toBeVisible();
      // O número não pode existir sem resposta do banco.
      await expect(page.getByRole("heading", { name: /^Lista \(/ })).toHaveCount(0);
      await expect(page.getByText(/nenhum ip cadastrado/i)).toHaveCount(0);
    });
  });

  /**
   * O IP "atual" depende de um serviço externo (api.ipify.org).
   *
   * Quando ele não responde, a versão anterior engolia a falha
   * (`.catch(() => {})`): a linha "atual:" simplesmente não aparecia e o admin
   * ficava sem saber se o problema era dele, da rede ou da tela.
   */
  test.describe(() => {
    test.use({ errosEsperados: [/ipify|Failed to (load resource|fetch)|ERR_FAILED/i] });

    test("com o detector de IP fora do ar, a tela diz por que não mostra o endereço", async ({ page }) => {
      await page.route("**api.ipify.org**", (route) => route.abort());

      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);

      await expect(page.getByText(/não consegui detectar seu ip/i)).toBeVisible();
      await expect(page.getByText(/api\.ipify\.org não respondeu/i)).toBeVisible();
      // O cadastro manual continua disponível: a falha é do detector, não da tela.
      await expect(campoIp(page)).toBeEnabled();
    });

    /**
     * A falha DEPOIS de uma detecção que deu certo.
     *
     * O caso acima derruba o detector desde o mount, e nesse caminho `myIp` nunca
     * existiu. O que passava batido era a segunda tentativa: o `catch` não
     * limpava `myIp`, o aviso ficava escondido atrás de `!myIp` e a tela seguia
     * exibindo "atual: <endereço da detecção anterior>" como se fosse o de agora
     * — numa tela de antifraude, o admin cadastra a faixa errada por isso.
     */
    test("detector que falha na segunda tentativa não deixa o IP anterior passando por atual", async ({ page }) => {
      const ipDaPrimeira = "203.0.113.77";
      let chamadas = 0;
      await page.route("**api.ipify.org**", async (route) => {
        chamadas += 1;
        if (chamadas === 1) {
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ip: ipDaPrimeira }),
          });
        }
        return route.abort();
      });

      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);
      await expect(page.getByText(ipDaPrimeira, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: /descobrir meu ip/i }).click();

      await expect(page.getByText(/api\.ipify\.org não respondeu/i)).toBeVisible();
      await expect(
        page.getByText(ipDaPrimeira, { exact: true }),
        "IP de uma detecção anterior apresentado como o endereço atual",
      ).toHaveCount(0);
    });
  });

  /**
   * Clique com o campo de IP vazio.
   *
   * Era um `return` silencioso: nenhum aviso, nenhuma requisição — numa tela de
   * segurança quem opera sai achando que cadastrou uma faixa que não existe. O
   * caso não escreve nada no banco de propósito; o que ele cobra é o aviso E a
   * ausência de POST, porque um "cadastro" sem gravação é exatamente o defeito.
   */
  test("clicar em Adicionar sem IP avisa e não manda nada para o banco", async ({ page }) => {
    const gravacoes: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/rest\/v1\/allowed_ips/.test(r.url())) gravacoes.push(r.url());
    });

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    // Só a descrição preenchida: o aviso tem de ser sobre o campo que falta.
    await campoDescricao(page).fill(rotuloPara("sem ip"));
    await page.getByRole("button", { name: /adicionar/i }).click();

    await expect(page.getByText(/Informe o IP ou a faixa CIDR/i)).toBeVisible();
    await expect(toastDeSucesso(page)).toHaveCount(0);
    expect(gravacoes, "campo vazio não pode virar requisição de gravação").toEqual([]);
  });

  // A recusa vem como 400 do PostgREST, e o navegador loga isso no console: é a
  // prova de que o banco barrou, não um defeito da tela.
  test.describe(() => {
    test.use({ errosEsperados: [/status of 400/i] });

  test("endereço inválido não entra na lista, e o erro sai em pt-BR", async ({ page }) => {
    const rotulo = rotuloPara("invalido");

    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    await campoIp(page).fill("nao-e-um-ip");
    await campoDescricao(page).fill(rotulo);
    await page.getByRole("button", { name: /adicionar/i }).click();

    // A recusa vem do tipo `cidr` do Postgres (SQLSTATE 22P02). Até a Tarefa D a
    // tela repassava a mensagem crua ("invalid input syntax for type cidr"), que
    // entrega o schema a quem estiver olhando e não diz o que fazer; depois o
    // `describeError` traduziu por código, mas "um dos campos está em formato
    // inválido" não diz QUAL formato serve — e IPv6 é justamente o caso em que o
    // admin não sabe o que digitar. O teste cobra as duas metades: a frase em
    // pt-BR com exemplo aparece E a mensagem do Postgres não vaza.
    await expect(page.getByText(/endereço inválido\. use ipv4/i)).toBeVisible();
    await expect(page.getByText(/2804:14c/i), "o exemplo de IPv6 é o que faltava").toBeVisible();
    await expect(page.getByText(/invalid input syntax|for type cidr/i)).toHaveCount(0);
    expect(await buscarPorRotulo(rotulo), "entrada inválida não pode gravar").toHaveLength(0);
  });

  });

  /**
   * A mesma faixa entrava duas vezes: não havia unique em `allowed_ips`.
   *
   * O estrago não é a linha repetida, é o que ela faz depois: o admin desativa
   * a faixa, vê "inativo" na lista e o check-in continua liberado pela gêmea.
   * A 0075 criou `allowed_ips_range_team_uidx` (endereço + equipe) e a tela
   * traduz o 23505 apontando para a lista.
   */
  test.describe(() => {
    test.use({ errosEsperados: [/status of 409|Failed to load resource/i] });

    test("a mesma faixa não entra duas vezes — e a tela diz onde a primeira está", async ({ page }) => {
      const rotulo = rotuloPara("duplicada");
      const ip = "203.0.113.77";

      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);

      await campoIp(page).fill(ip);
      await campoDescricao(page).fill(rotulo);
      await page.getByRole("button", { name: /adicionar/i }).click();
      await expect(toastDeSucesso(page)).toBeVisible();
      expect(await buscarPorRotulo(rotulo), "cenário: a primeira faixa precisa existir").toHaveLength(1);

      // Mesmo endereço, outra descrição: é o caso real — duas pessoas cadastram
      // a rede da mesma loja e ninguém percebe.
      const segundo = rotuloPara("duplicada 2");
      await campoIp(page).fill(ip);
      await campoDescricao(page).fill(segundo);
      await page.getByRole("button", { name: /adicionar/i }).click();

      await expect(page.getByText(/já está cadastrada para esta equipe/i)).toBeVisible();
      expect(await buscarPorRotulo(segundo), "a gêmea não pode existir no banco").toHaveLength(0);
    });
  });

  /**
   * "Endereços vistos pelo servidor".
   *
   * O detector externo (`api.ipify.org`) só responde em IPv4, e quem decide o
   * check-in é o endereço que o gateway entrega. Este card lê
   * `checkins.ip_address` — o que `perform_checkin` de fato gravou — e é a única
   * resposta que não depende de serviço externo nem de suposição sobre a
   * hospedagem. O cenário grava uma presença com endereço IPv6 e cobra que a
   * tela mostre exatamente ele, marcado como v6.
   */
  test("o card de endereços mostra o que o servidor gravou, inclusive IPv6", async ({ page }) => {
    const ipv6 = "2001:db8:75::a";        // 2001:db8::/32 é reservada para documentação (RFC 3849)
    const turnos = await db.select<{ id: string }>("work_shifts?active=eq.true&select=id&order=position&limit=1");
    expect(turnos, "o catálogo precisa de um turno ativo").toHaveLength(1);

    await db.remove(`checkins?profile_id=eq.${brokerId}`);
    const [presenca] = await db.insert<{ id: string }>("checkins", {
      profile_id: brokerId,
      shift_id: turnos[0].id,
      ip_address: ipv6,
    });

    try {
      await page.goto("/admin/allowed-ips");
      await aguardarCarregamento(page);

      const linha = page.locator("div").filter({ hasText: ipv6 }).last();
      await expect(page.getByText(ipv6, { exact: true })).toBeVisible();
      await expect(linha.getByText("IPv6", { exact: true })).toBeVisible();

      // "Usar no cadastro" leva o endereço para o formulário: é o caminho que
      // faltava para cadastrar a faixa certa quando o gateway fala v6.
      await page.getByRole("button", { name: `Usar ${ipv6} no formulário` }).click();
      await expect(campoIp(page)).toHaveValue(ipv6);
    } finally {
      await db.remove(`checkins?id=eq.${presenca.id}`);
    }
  });
});

/**
 * A tela de faixas é aberta do celular quando o gerente liga para o admin
 * dizendo "não consigo bater ponto". Nunca foi medida em 375 px.
 */
test.describe("IPs autorizados no celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("/admin/allowed-ips cabe em 375 px sem rolar a página na horizontal", async ({ page }) => {
    await page.goto("/admin/allowed-ips");
    await aguardarCarregamento(page);

    const transbordo = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const culpado = transbordo > 1 ? await page.evaluate(() => {
      const sobra = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const trilha: string[] = [];
      let atual: Element = document.body;
      for (let nivel = 0; nivel < 25; nivel++) {
        const culpados = Array.from(atual.children).filter((filho) => {
          const el = filho as HTMLElement;
          const antes = el.style.display;
          el.style.display = "none";
          const semEle = sobra();
          el.style.display = antes;
          return semEle <= 1;
        });
        if (culpados.length !== 1) break;
        const el = culpados[0];
        trilha.push(`${el.tagName.toLowerCase()}[${typeof el.className === "string" ? el.className.slice(0, 90) : ""}]`);
        atual = el;
      }
      return trilha.length ? ` — quem estoura: ${trilha.slice(-4).join(" > ")}` : "";
    }) : "";
    expect(transbordo, `a tela de faixas rola na horizontal em 375 px${culpado}`).toBeLessThanOrEqual(1);
  });
});
