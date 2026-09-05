import { test, expect, db, runTag, aguardarCarregamento } from "../support/fixtures";

/**
 * Diário de equipe sem sessão — `/daily/:slug`.
 *
 * A superfície anônima do projeto são exatamente três RPCs (`public_daily_team`,
 * `public_daily_submit`, `public_director_checkpoint`); duas delas são exercidas
 * aqui. O portão é o PIN, guardado como bcrypt em `public_links.pin_hash`.
 *
 * Cenário próprio de propósito: o banco é compartilhado entre agentes e as
 * equipes do seed já têm `daily_reports` de hoje. Escrever nelas destruiria dado
 * de outro teste; então a suíte cria a própria equipe, o próprio link e apaga
 * tudo no fim (a remoção da equipe cascateia link, membro, relatório e entrada).
 */

// Hash bcrypt do PIN "123456". O PIN nunca é gravado em claro (nem no teste), e
// `set_public_link_pin` exige sessão de admin — que o anônimo não tem. Um hash
// bcrypt é autocontido (algoritmo + custo + sal), então vale em qualquer banco.
const PIN = "123456";
const PIN_HASH = "$2a$06$On6loHaQgXqIOl9PmZJkGewH/uNU0GARZ.qwUqc.irdujr38Di1xi";

// Perfil do seed sem equipe ativa. `team_members_one_active` é UNIQUE por perfil
// enquanto `left_at is null`: reaproveitar um corretor já alocado o arrancaria da
// equipe dele e quebraria os testes de visibilidade dos outros agentes.
const EMAIL_MEMBRO = "seed.parceiro@example.invalid";

// Colunas do formulário, com o rótulo que a tela dá a cada uma. Cada célula tem
// nome acessível "<coluna> — <corretor>", então a âncora é o nome, não a ordem.
const COLUNAS = {
  leads: "Leads",
  ligacoes: "Ligações",
  coleta_docs: "Coleta Docs",
  visitas_agendadas: "Visita Agend.",
  visitas_realizadas: "Visita Real.",
  analises: "Análise Env.",
  aprovados: "Análise Aprov.",
  vendas: "Venda",
} as const;

const tag = runTag();
const slug = `diario-${tag}`;
const slugInativo = `diario-off-${tag}`;
// Link só do cenário de trava: cinco PINs errados fecham o link por 15 minutos,
// e usar o slug principal derrubaria todos os cenários seguintes deste arquivo.
const slugTrava = `diario-trava-${tag}`;

/** Meta DA EQUIPE (0062). A tela cobrava 10/40/50 literais e ignorava isto. */
const META = { analises: 13, aprovados: 46, vendas: 56 };

let teamId = "";
let membroId = "";
let membroNome = "";

test.beforeAll(async () => {
  const [membro] = await db.select<{ id: string; full_name: string }>(
    `profiles?email=eq.${encodeURIComponent(EMAIL_MEMBRO)}&select=id,full_name`,
  );
  if (!membro) throw new Error(`perfil ${EMAIL_MEMBRO} não existe — o seed rodou?`);
  membroId = membro.id;
  membroNome = membro.full_name;

  const [equipe] = await db.insert<{ id: string }>("teams", {
    name: `Equipe Diário ${tag}`,
    slug: `equipe-diario-${tag}`,
    active: true,
  });
  teamId = equipe.id;

  await db.insert("team_members", { team_id: teamId, profile_id: membroId });

  // As TRÊS linhas repetem as MESMAS chaves, `expires_at` inclusive. Num insert
  // em lote o PostgREST monta um `INSERT` só e recusa com PGRST102 ("All object
  // keys must match") quando um objeto traz uma chave que os outros não têm —
  // era o 400 que derrubava o arquivo inteiro no `beforeAll`.
  await db.insert("public_links", [
    // Validade curta de propósito: é o que faz a tela avisar quem preenche antes
    // de o link simplesmente parar de abrir.
    {
      kind: "daily_team", team_id: teamId, slug, pin_hash: PIN_HASH, active: true,
      expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    },
    // Mesmo PIN, link desativado: prova que "inativo" não vira mensagem própria.
    {
      kind: "daily_team", team_id: teamId, slug: slugInativo, pin_hash: PIN_HASH, active: false,
      expires_at: null,
    },
    {
      kind: "daily_team", team_id: teamId, slug: slugTrava, pin_hash: PIN_HASH, active: true,
      expires_at: null,
    },
  ]);

  // `funnel_targets` cascateia com a equipe, então o afterAll já a remove.
  await db.insert("funnel_targets", {
    scope: "team",
    team_id: teamId,
    lead_to_analysis_pct: META.analises,
    analysis_to_approval_pct: META.aprovados,
    approval_to_sale_pct: META.vendas,
  });
});

test.afterAll(async () => {
  // teams cascateia public_links, team_members, daily_reports e daily_entries.
  if (teamId) await db.remove(`teams?id=eq.${teamId}`);
});

/**
 * Abre a tela e espera o cartão de PIN.
 *
 * Usa o `aguardarCarregamento` de todo mundo: o título da tela de PIN dizia
 * "Carregando equipe..." para sempre (a RPC não devolve equipe nenhuma antes do
 * PIN), e o helper compartilhado ficava 20 s esperando um carregamento que não
 * existia. A copy foi corrigida; contornar o helper era esconder o defeito.
 */
async function abrirDiario(page: import("@playwright/test").Page, alvo = slug) {
  await page.goto(`/daily/${alvo}`);
  await aguardarCarregamento(page);
  await expect(page.getByText(/acesso da equipe/i)).toBeVisible();
}

/** Erros de PIN contados pelo banco — o relógio do lockout da 0033. */
async function tentativasErradas(alvo: string) {
  const [link] = await db.select<{ failed_attempts: number }>(
    `public_links?slug=eq.${alvo}&select=failed_attempts`,
  );
  return link.failed_attempts;
}

const campoPin = (page: import("@playwright/test").Page) => page.getByLabel("PIN da equipe");
const botaoEntrar = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /entrar na missão/i });

/** Célula da grade do corretor do teste. */
const campo = (page: import("@playwright/test").Page, coluna: keyof typeof COLUNAS) =>
  page.getByLabel(`${COLUNAS[coluna]} — ${membroNome}`);

/** Abre o formulário de hoje (a grade só existe depois disto). */
async function abrirFormulario(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /preencher o daily|editar daily/i }).click();
  // As oito métricas da linha do corretor; `decimal` porque a tela aceita 0,5.
  await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(Object.keys(COLUNAS).length);
}

test.describe("diário público", () => {
  test("pede PIN antes de mostrar qualquer dado da equipe", async ({ page }) => {
    await abrirDiario(page);

    await expect(campoPin(page)).toBeVisible();
    await expect(botaoEntrar(page)).toBeVisible();

    // A tela de PIN é o estado inicial de TODA visita, e não está carregando
    // nada: a RPC só devolve a equipe depois do PIN. O título dizia
    // "Carregando equipe..." indefinidamente — spinner eterno é bug de copy.
    await expect(page.getByText(/carregando/i)).toHaveCount(0);

    // Nada da equipe pode vazar antes do PIN: nem a escala, nem o formulário.
    await expect(page.getByText(membroNome)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /corretores da equipe/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /salvar checkpoint/i })).toHaveCount(0);
  });

  test("PIN curto demais não gasta uma das cinco tentativas", async ({ page }) => {
    // O servidor exige 6 a 10 dígitos (0062): um PIN de 5 nunca poderia ter
    // sido gravado. Mesmo assim a tela mandava a tentativa, e
    // `resolve_public_link` (0033) contava o erro — cinco digitações curtas
    // trancavam o link do gerente por 15 minutos por um PIN impossível.
    const antes = await tentativasErradas(slug);
    await abrirDiario(page);

    await campoPin(page).fill("99999");
    await botaoEntrar(page).click();

    await expect(page.getByText(/6 a 10 dígitos/i).first()).toBeVisible();
    await expect(page.getByText(/pin incorreto/i)).toHaveCount(0);
    expect(await tentativasErradas(slug)).toBe(antes);
  });

  test("PIN incorreto avisa 'PIN incorreto' e mantém a equipe fechada", async ({ page }) => {
    await abrirDiario(page);

    await campoPin(page).fill("999999");
    await botaoEntrar(page).click();

    await expect(page.getByText(/pin incorreto/i)).toBeVisible();
    // A trava de 15 minutos era explicada em todo lugar MENOS aqui, que é
    // justamente por onde o gerente erra o PIN.
    await expect(page.getByText(/bloqueado por 15 minutos/i)).toBeVisible();
    await expect(campoPin(page)).toBeVisible();
    await expect(page.getByText(membroNome)).toHaveCount(0);
  });

  test("cinco PINs errados travam o link — e nem o PIN certo abre", async ({ page }) => {
    // A prova do lockout (0033) só existia no harness SQL, que precisa de Docker
    // e não roda com o resto da suíte. Aqui ela passa pela tela, que é onde o
    // gerente vive o efeito.
    await abrirDiario(page, slugTrava);

    // O contador do banco é o relógio deste laço: esperar só o toast não prova
    // que a tentativa chegou ao servidor, e cinco cliques rápidos poderiam
    // contar menos de cinco erros.
    for (let tentativa = 1; tentativa <= 5; tentativa += 1) {
      await campoPin(page).fill("999999");
      await botaoEntrar(page).click();
      await expect(async () => {
        const [link] = await db.select<{ failed_attempts: number; locked_until: string | null }>(
          `public_links?slug=eq.${slugTrava}&select=failed_attempts,locked_until`,
        );
        // No quinto erro a 0033 zera a contagem JUNTO com a trava, para que a
        // janela seguinte recomece em 1 em vez de travar na primeira tentativa.
        if (tentativa < 5) expect(link.failed_attempts).toBe(tentativa);
        else expect(link.locked_until, "o quinto erro tem de gravar a trava").not.toBeNull();
      }).toPass({ timeout: 15_000 });
    }

    // Dentro da janela nem o PIN correto resolve — é o ponto da trava.
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();
    await expect(page.getByText(/pin incorreto/i).first()).toBeVisible();
    await expect(page.getByText(membroNome)).toHaveCount(0);
  });

  test("link desativado não ganha mensagem própria — o PIN certo dá a mesma recusa", async ({ page }) => {
    // A `resolve_public_link` devolve NULL para slug inexistente, link inativo,
    // expirado e PIN errado sem distinguir os casos. Distinguir transformaria a
    // tela em oráculo de enumeração de slugs.
    await abrirDiario(page, slugInativo);

    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByText(/pin incorreto/i)).toBeVisible();
    await expect(page.getByText(membroNome)).toHaveCount(0);
  });

  test.describe("sem rede", () => {
    // A tela registra a falha no console de propósito (diagnóstico) e mostra o
    // toast para o gerente. Erro esperado é declarado, não silenciado.
    //
    // Lista de UM RegExp com alternância, e não `[/a/, /b/]`: o Playwright
    // confunde uma lista de dois objetos com a tupla `[valorPadrão, opções]` e
    // descarta o segundo padrão (ver `errosEsperados` em support/fixtures.ts).
    test.use({ errosEsperados: [/falha ao abrir a equipe|Failed to fetch/i] });

    test("erro de rede não é confundido com PIN incorreto", async ({ page, context }) => {
      // O erro de infraestrutura tem que sair pela porta dele. Antes, RPC caindo e
      // PIN errado davam a mesma frase, e o gerente ficava redigitando um PIN certo.
      //
      // Queda real de rede em vez de resposta 5xx forjada: 5xx faz o navegador
      // registrar "Failed to load resource" no console e a fixture `semErroDeConsole`
      // reprovaria o teste pelo próprio mock, não pela tela.
      await abrirDiario(page);
      await context.setOffline(true);

      await campoPin(page).fill(PIN);
      await botaoEntrar(page).click();

      await expect(page.getByText(/erro de conexão/i)).toBeVisible();
      await expect(page.getByText(/pin incorreto/i)).toHaveCount(0);

      await context.setOffline(false);
    });
  });

  // Regressão da migration 0009 coberta pela 0026: a RPC atualiza last_seen_at,
  // então precisa ser VOLATILE. Estes cenários provam o caminho positivo e a
  // persistência, não apenas as recusas de PIN.
  test("PIN correto abre a equipe e lista a escala", async ({ page }) => {
    await abrirDiario(page);

    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByRole("heading", { name: `Equipe Diário ${tag}` })).toBeVisible();
    await page.getByRole("button", { name: /corretores da equipe/i }).click();
    await expect(page.getByText(membroNome)).toBeVisible();
    await expect(campoPin(page)).toHaveCount(0);
  });

  test("avisa que o link vence antes de ele parar de abrir", async ({ page }) => {
    // Link vencido cai na mesma recusa de PIN errado, sem explicação nenhuma:
    // o aviso é a única chance de o gerente pedir a renovação a tempo.
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByText(/este link vence em \d+ dias?/i)).toBeVisible();
  });

  test("as metas do funil vêm de funnel_targets, não do código", async ({ page }) => {
    // A homologação tem meta por equipe desde o seed e a tela cobrava
    // 100/10%/40%/50% fixos: o mesmo número era medido por duas réguas.
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(
      page.getByText(new RegExp(`metas: 100 → ${META.analises}% → ${META.aprovados}% → ${META.vendas}%`)).first(),
    ).toBeVisible();
    await expect(page.getByText(/meta da equipe/i).first()).toBeVisible();
  });

  test("o placar do dia não promete XP que o ranking nunca recebe", async ({ page }) => {
    // `public_daily_submit` não escreve em `game_events`: o "+N XP" da tela era
    // decorativo e o corretor nunca via aquilo no ranking.
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await expect(page.getByText(/pontos do mês/i)).toBeVisible();
    await expect(page.getByText(/XP/)).toHaveCount(0);
  });

  test("salvar o checkpoint grava relatório, gerente, observações e meio ponto — e reabre igual", async ({ page }) => {
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await abrirFormulario(page);

    await page.getByPlaceholder("Seu nome").fill(`Gerente ${tag}`);
    await page.getByLabel("Observações do dia").fill(`Obs ${tag}`);

    await campo(page, "leads").fill("7");
    await campo(page, "analises").fill("3");
    // Meia venda: venda dividida entre dois corretores. O banco aceita desde a 0038.
    await campo(page, "vendas").fill("0,5");

    await page.getByRole("button", { name: /salvar checkpoint/i }).click();
    await expect(page.getByText(/checkpoint concluído/i)).toBeVisible();
    // O toast diz "pontos no placar do dia", não "+XP": o ranking da temporada
    // é alimentado por negócio fechado, não pelo diário.
    await expect(page.getByText(/pontos no placar do dia/i)).toBeVisible();

    // A auditoria já pegou tela que dizia "salvo" sem gravar nada: a asserção
    // que vale é a do banco.
    await expect(async () => {
      const [relatorio] = await db.select<{
        id: string; submitted_at: string | null; filled_by_name: string | null; notes: string | null;
      }>(`daily_reports?team_id=eq.${teamId}&select=id,submitted_at,filled_by_name,notes`);
      expect(relatorio, "daily_reports não recebeu o relatório do dia").toBeTruthy();
      expect(relatorio.submitted_at).not.toBeNull();
      expect(relatorio).toMatchObject({ filled_by_name: `Gerente ${tag}`, notes: `Obs ${tag}` });

      const entradas = await db.select<{ leads: number; analyses_sent: number; sales: number }>(
        `daily_entries?report_id=eq.${relatorio.id}&profile_id=eq.${membroId}&select=leads,analyses_sent,sales`,
      );
      expect(entradas).toHaveLength(1);
      expect(entradas[0]).toMatchObject({ leads: 7, analyses_sent: 3, sales: 0.5 });
    }).toPass({ timeout: 10_000 });

    // Reabrir o dia devolve o que foi gravado — o gerente não redigita nada.
    await page.reload();
    await expect(page.getByText(/acesso da equipe/i)).toBeVisible();
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();
    await page.getByRole("button", { name: /editar daily de hoje/i }).click();

    await expect(page.getByText(new RegExp(`preenchido por\\s+Gerente ${tag}`, "i"))).toBeVisible();
    await expect(page.getByPlaceholder("Seu nome")).toHaveValue(`Gerente ${tag}`);
    await expect(page.getByLabel("Observações do dia")).toHaveValue(`Obs ${tag}`);
    await expect(campo(page, "vendas")).toHaveValue("0,5");
  });

  test("meio ponto pode ser digitado tecla a tecla, não só colado", async ({ page }) => {
    // `fill` injeta a string inteira num evento só e escondia o defeito: com
    // `type="number"` o texto intermediário "0," chegava vazio ao React, o
    // estado voltava a 0 e o campo era reescrito sem o separador. Digitar
    // tecla a tecla é o caminho do gerente de verdade.
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();
    await abrirFormulario(page);

    // 1,5 e não 0,5: o cenário anterior já pode ter deixado 0,5 gravado, e aí a
    // asserção passaria sem provar nada sobre a digitação.
    const vendas = campo(page, "vendas");
    await vendas.click();
    await vendas.press("ControlOrMeta+a");
    await vendas.pressSequentially("1,5");
    await expect(vendas).toHaveValue("1,5");

    // Ao sair do campo o valor é normalizado no passo de 0,5 — e continua 1,5.
    await page.getByPlaceholder("Seu nome").click();
    await expect(vendas).toHaveValue("1,5");
    // Nada é gravado aqui: este cenário é sobre digitação, não sobre o envio.
  });

  test("histórico marca o dia com checkpoint e abre os valores gravados", async ({ page }) => {
    // "Hoje" é do banco (UTC), não do navegador — a RPC grava em current_date.
    const hoje = await db.rpc<string>("current_work_date");
    const d = new Date(`${hoje}T12:00:00Z`);
    test.skip(d.getUTCDate() === 1, "no dia 1 não há dia anterior dentro do mês");
    d.setUTCDate(d.getUTCDate() - 1);
    const ontem = d.toISOString().slice(0, 10);

    // Dia anterior gravado por fora (é assim que seed e suporte corrigem o passado).
    const [relatorio] = await db.insert<{ id: string }>("daily_reports", {
      team_id: teamId,
      report_date: ontem,
      submitted_at: new Date().toISOString(),
      filled_by_name: `Gerente ontem ${tag}`,
      notes: `Obs ontem ${tag}`,
    });
    await db.insert("daily_entries", { report_id: relatorio.id, profile_id: membroId, leads: 4 });

    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await page.getByRole("button", { name: /histórico/i }).click();
    // A célula do dia: "DD" + abreviação do dia da semana.
    await page.getByRole("button", { name: new RegExp(`^${ontem.slice(8, 10)}`) }).click();

    // Ontem está DENTRO da janela de correção da 0080: abre para corrigir, não
    // só para conferir.
    await expect(page.getByText(/corrigindo o checkpoint de/i)).toBeVisible();
    await expect(page.getByText(new RegExp(`preenchido por\\s+Gerente ontem ${tag}`, "i"))).toBeVisible();
    await expect(campo(page, "leads")).toHaveValue("4");
    await expect(page.getByLabel("Observações do dia")).toHaveValue(`Obs ontem ${tag}`);
    await expect(page.getByRole("button", { name: /salvar checkpoint/i })).toBeEnabled();

    // A correção tem de cair no dia ABERTO. Enquanto a RPC não recebia data, o
    // `on conflict (team_id, report_date)` casava com a linha de HOJE: o
    // gerente "corrigia ontem" e sobrescrevia o checkpoint de hoje.
    await campo(page, "leads").fill("6");
    await page.getByPlaceholder("Seu nome").fill(`Gerente correcao ${tag}`);
    await page.getByRole("button", { name: /salvar checkpoint/i }).click();
    await expect(page.getByText(/checkpoint concluído/i)).toBeVisible();
    await expect(page.getByText(new RegExp(`correção gravada no dia ${ontem.slice(8, 10)}/${ontem.slice(5, 7)}`, "i"))).toBeVisible();

    await expect(async () => {
      const entradas = await db.select<{ leads: number }>(
        `daily_entries?report_id=eq.${relatorio.id}&profile_id=eq.${membroId}&select=leads`,
      );
      expect(entradas[0]?.leads, "a correção não chegou ao dia de ontem").toBe(6);
    }).toPass({ timeout: 10_000 });
  });

  test("dia mais antigo que a janela abre só para conferir", async ({ page }) => {
    // A janela é de 2 dias, e o teto está no banco (0080): a tela só evita a
    // ida e volta. Aqui se cobra o outro lado da régua — o dia velho continua
    // legível e o Salvar continua desligado, com o motivo escrito.
    const hoje = await db.rpc<string>("current_work_date");
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 3);
    const velho = d.toISOString().slice(0, 10);
    test.skip(velho.slice(0, 7) !== hoje.slice(0, 7), "o dia -3 caiu no mês anterior, que o calendário não abre");

    const [antigo] = await db.insert<{ id: string }>("daily_reports", {
      team_id: teamId,
      report_date: velho,
      submitted_at: new Date().toISOString(),
      filled_by_name: `Gerente antigo ${tag}`,
    });
    await db.insert("daily_entries", { report_id: antigo.id, profile_id: membroId, leads: 1 });

    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await page.getByRole("button", { name: /histórico/i }).click();
    await page.getByRole("button", { name: new RegExp(`^${velho.slice(8, 10)}`) }).click();

    await expect(page.getByText(/dia anterior aberto só para conferir/i)).toBeVisible();
    await expect(page.getByText(/corrige o checkpoint de hoje e dos/i)).toBeVisible();
    await expect(campo(page, "leads")).toHaveValue("1");
    await expect(page.getByRole("button", { name: /salvar checkpoint/i })).toBeDisabled();

    // "Só para conferir" também vale para as OITO células: só a Textarea de
    // observações era `readOnly`, e a metade numérica do mesmo formulário
    // continuava convidando a digitar. O gerente digitava, os funis e a barra de
    // totais recalculavam ao vivo e nada era gravável — o número na tela deixava
    // de ser o número do banco sem nenhum sinal.
    await expect(campo(page, "leads")).not.toBeEditable();
    await expect(campo(page, "vendas")).not.toBeEditable();
    await expect(page.getByLabel("Observações do dia")).not.toBeEditable();
    // E o valor continua selecionável e copiável, que é o que "conferir" pede:
    // `readOnly`, não `disabled`.
    await expect(campo(page, "leads")).toBeEnabled();
  });

  test("o calendário do histórico diz o estado do dia por escrito", async ({ page }) => {
    // "Preenchido" e "não preenchido" eram só cor de fundo mais um ícone sem
    // nome: o nome acessível do botão era "01 seg" nos DOIS estados, e o `title`
    // não aparece em foco por teclado nem em toque (regra 3 do design-system).
    const hoje = await db.rpc<string>("current_work_date");
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 2);
    const anterior = d.toISOString().slice(0, 10);
    test.skip(anterior.slice(0, 7) !== hoje.slice(0, 7), "o dia -2 caiu no mês anterior, que o calendário não abre");

    const [rel] = await db.insert<{ id: string }>("daily_reports", {
      team_id: teamId,
      report_date: anterior,
      submitted_at: new Date().toISOString(),
      filled_by_name: `Gerente rotulo ${tag}`,
    });
    await db.insert("daily_entries", { report_id: rel.id, profile_id: membroId, leads: 2 });

    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();
    await page.getByRole("button", { name: /histórico/i }).click();

    const dd = anterior.slice(8, 10);
    await expect(
      page.getByRole("button", { name: new RegExp(`^${dd} .+ — preenchido$`) }),
    ).toBeVisible();
    // E o dia de hoje, ainda em branco nesta equipe recém-criada, carrega o
    // rótulo oposto — é o par que prova que o estado está no nome, não na cor.
    await expect(
      page.getByRole("button", { name: new RegExp(`^${hoje.slice(8, 10)} .+ — (não )?preenchido$`) }),
    ).toBeVisible();
  });

  test("a rota antiga com o id da equipe explica que morreu, em vez de pedir PIN para sempre", async ({ page }) => {
    // `/daily/<uuid>` é a rota legada: o identificador virou slug sorteado na
    // 0033 e o UUID não resolve link nenhum, então a RPC devolvia null e a tela
    // ficava PRESA no portão — o gerente digitava o PIN certo e ouvia "PIN
    // incorreto" para sempre, sem nenhuma pista do que fazer.
    await page.goto(`/daily/${teamId}`);

    await expect(page.getByText(/este endereço do diário é antigo/i)).toBeVisible();
    await expect(campoPin(page)).toHaveCount(0);
    // E não pode vazar nada da equipe por um caminho que nem PIN pede.
    await expect(page.getByText(membroNome)).toHaveCount(0);
  });

  test("relatório sem nenhum lançamento não limpa a pendência do dia", async ({ page }) => {
    // Duas réguas no mesmo produto: o calendário e a pendência contavam LINHA
    // em `daily_reports`, o contador por corretor contava dia com lançamento.
    // `public_daily_submit` grava o relatório ANTES de percorrer as entradas e
    // ignora quem não é da equipe, então um envio que não casou ninguém deixa
    // um relatório vazio — e o dia ficava verde sem um número por trás.
    const hoje = await db.rpc<string>("current_work_date");
    const [ano, mes, dia] = hoje.split("-").map(Number);
    // Um dia ÚTIL do mês, já passado e AINDA SEM relatório: os outros cenários
    // deste arquivo gravam ontem e o dia -3, e reaproveitar um deles quebraria
    // a premissa (o dia já teria lançamento) e o insert (unique por dia).
    const ocupados = new Set(
      (await db.select<{ report_date: string }>(`daily_reports?team_id=eq.${teamId}&select=report_date`))
        .map((r) => r.report_date),
    );
    let alvo = "";
    for (let d = 1; d < dia; d += 1) {
      const data = new Date(Date.UTC(ano, mes - 1, d));
      const semana = data.getUTCDay();
      const iso = data.toISOString().slice(0, 10);
      if (semana !== 0 && semana !== 6 && !ocupados.has(iso)) { alvo = iso; break; }
    }
    test.skip(!alvo, "não sobrou dia útil livre no mês para cobrar a pendência");

    const ddmm = `${alvo.slice(8, 10)}/${alvo.slice(5, 7)}`;
    const pendencias = () =>
      page.getByText(/checkpoint não efetuado/i).locator("xpath=following-sibling::p");

    const entrar = async () => {
      await campoPin(page).fill(PIN);
      await botaoEntrar(page).click();
      await expect(page.getByRole("heading", { name: `Equipe Diário ${tag}` })).toBeVisible();
    };

    await abrirDiario(page);
    await entrar();
    // Sem nada gravado o dia é pendência — é a linha de base do cenário.
    await expect(pendencias()).toContainText(ddmm);

    // Relatório VAZIO, do jeito que a RPC o deixa quando nenhuma entrada casa.
    const [vazio] = await db.insert<{ id: string }>("daily_reports", {
      team_id: teamId, report_date: alvo, submitted_at: new Date().toISOString(),
      filled_by_name: `Gerente vazio ${tag}`,
    });

    await page.reload();
    await entrar();
    await expect(pendencias()).toContainText(ddmm);

    // Com lançamento, aí sim o dia sai da cobrança.
    await db.insert("daily_entries", { report_id: vazio.id, profile_id: membroId, leads: 2 });

    await page.reload();
    await entrar();
    // A faixa some quando não sobra dia pendente nenhum, então a asserção olha
    // a página inteira em vez da faixa (que pode nem existir).
    await expect(page.getByText(new RegExp(`${ddmm}(?!/)`))).toHaveCount(0);
  });

  test("o total do mês da tela bate com as linhas gravadas no banco", async ({ page }) => {
    // As 8 métricas são somadas por dois caminhos independentes — `aggregateMonth`
    // no cliente e `sum()` no SQL do checkpoint — e nada comparava um com o
    // outro. Aqui a régua é o banco: o que a tela mostra tem que ser a soma das
    // linhas do mês desta equipe.
    const hoje = await db.rpc<string>("current_work_date");
    const inicio = `${hoje.slice(0, 8)}01`;

    const somaDoBanco = async () => {
      const relatorios = await db.select<{ id: string }>(
        `daily_reports?team_id=eq.${teamId}&report_date=gte.${inicio}&report_date=lte.${hoje}&select=id`,
      );
      if (!relatorios.length) return 0;
      const entradas = await db.select<{ visits_scheduled: number }>(
        `daily_entries?report_id=in.(${relatorios.map((r) => r.id).join(",")})&select=visits_scheduled`,
      );
      return entradas.reduce((acc, e) => acc + Number(e.visits_scheduled ?? 0), 0);
    };

    // Sanduíche: o banco é lido antes e depois da tela porque outro cenário pode
    // somar no intervalo — o que não pode é a tela ficar FORA do intervalo.
    const antes = await somaDoBanco();
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();
    await expect(page.getByText(/funil do mês — acumulado/i).first()).toBeVisible();

    // "Visita Agend." é rótulo único fora do formulário; "Leads" aparece também
    // no funil compacto e casaria com dois elementos.
    const texto = await page.getByText("Visita Agend.", { exact: true }).first()
      .locator("xpath=following-sibling::p").innerText();
    const visitas = Number(texto.replace(/\./g, "").replace(",", "."));
    const depois = await somaDoBanco();

    expect(visitas).toBeGreaterThanOrEqual(antes);
    expect(visitas).toBeLessThanOrEqual(depois);
  });

  test("a tela não oferece gestão de membros — isso é da tela Equipes", async ({ page }) => {
    // A gestão de escala saiu do diário público: um link com PIN não pode
    // admitir nem desligar corretor. O diálogo virou consulta.
    await abrirDiario(page);
    await campoPin(page).fill(PIN);
    await botaoEntrar(page).click();

    await page.getByRole("button", { name: /corretores da equipe/i }).click();

    await expect(page.getByText(membroNome)).toBeVisible();
    await expect(page.getByText(/o gestor logado usa a tela/i)).toBeVisible();

    for (const proibido of [/adicionar/i, /incluir corretor/i, /remover/i, /desligar/i, /salvar/i]) {
      await expect(page.getByRole("button", { name: proibido })).toHaveCount(0);
    }
  });
});
