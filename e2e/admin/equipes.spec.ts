import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { resolveTarget } from "../support/target";
import { mintSession } from "../support/session";
import { userFor } from "../support/users";

/**
 * Equipes: as duas coisas que a tela prometia e não entregava.
 *
 * 1) META QUE VOLTA. A gravação em `goals` sempre funcionou; a leitura não
 *    existia — `load()` só chamava `listPeople()`, que não conhece meta. O campo
 *    voltava a zero na hora e o card de Diretores somava R$ 0 para sempre. Por
 *    isso a asserção não para no toast: confere a linha em `goals` E o valor no
 *    campo depois de a tela reler (e depois de um F5, que é a releitura de vez).
 *
 * 2) CADASTRAR GENTE. Nenhuma tela criava colaborador — o único caminho era um
 *    script de PowerShell com service role. O botão chama a edge function
 *    `provision-broker-user`, que é quem tem a chave; o teste cobra o efeito no
 *    banco (perfil + papel 'broker'), não a mensagem verde.
 *
 * Requer as migrations aplicadas no alvo (`npm run db:reset`): a ficha que abre
 * depois do cadastro lê as colunas da 0046.
 */
const tag = runTag();
const target = resolveTarget();

const gerente = userFor("manager");
let gerenteId = "";

// Valores únicos por execução: um número fixo passaria mesmo se a tela tivesse
// mostrado a meta de uma execução anterior.
const digitos = parseInt(tag.replace(/\D/g, "").slice(-5), 10) || 0;
const META_MES = 300000 + digitos;
const META_ANO = 3600000 + digitos;

const NOVO_NOME = `E2E Novato ${tag}`;
const NOVO_EMAIL = `e2e.novato.${tag}@faceimob.test`;

const metasDoGerente = () =>
  db.select<{ period_type: string; target: string }>(
    `goals?scope=eq.profile&profile_id=eq.${gerenteId}&metric=eq.vgv&select=period_type,target`,
  );

const apagarMetas = () =>
  db.remove(`goals?scope=eq.profile&profile_id=eq.${gerenteId}&metric=eq.vgv`);

/** A conta nasce no Auth (a service role é o único caminho para apagá-la). */
const authAdmin = (path: string, init: RequestInit = {}) =>
  fetch(`${target.supabaseUrl}/auth/v1/admin/${path}`, {
    ...init,
    headers: {
      apikey: target.serviceRoleKey,
      Authorization: `Bearer ${target.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });

async function removerConta(email: string) {
  const busca = await authAdmin(`users?filter=${encodeURIComponent(email)}`);
  if (!busca.ok) throw new Error(`busca de ${email} → ${busca.status}`);
  const corpo = (await busca.json()) as { users?: { id: string; email?: string }[] };
  const conta = (corpo.users ?? []).find((u) => u.email === email);
  if (!conta) return;
  const del = await authAdmin(`users/${conta.id}`, { method: "DELETE" });
  if (!del.ok) throw new Error(`não consegui remover ${email}: ${del.status}`);
}

test.describe("equipes · meta de perfil do gerente", () => {
  test.beforeAll(async () => {
    gerenteId = await db.profileIdOf("manager");
    // Estado inicial explícito: sobra de execução interrompida faria o primeiro
    // `toHaveValue("0")` falhar por motivo errado.
    await apagarMetas();
  });

  test.afterAll(async () => {
    await apagarMetas();
  });

  test("a meta salva volta para o campo em vez de zerar", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    const mensal = page.getByLabel(`Meta mensal de ${gerente.fullName}`);
    const anual = page.getByLabel(`Meta anual de ${gerente.fullName}`);
    const salvar = page.getByRole("button", { name: `Salvar metas de ${gerente.fullName}` });

    await expect(mensal).toHaveValue("0");
    // Sem alteração não há o que salvar.
    await expect(salvar).toBeDisabled();

    await mensal.fill(String(META_MES));
    await anual.fill(String(META_ANO));
    await expect(salvar).toBeEnabled();
    await salvar.click();
    await expect(page.getByText("Meta salva")).toBeVisible();

    const linhas = await metasDoGerente();
    expect(linhas, "toast de sucesso sem linha gravada é tela mentindo").toHaveLength(2);
    const porPeriodo = Object.fromEntries(linhas.map((l) => [l.period_type, Number(l.target)]));
    expect(porPeriodo.month).toBe(META_MES);
    expect(porPeriodo.year).toBe(META_ANO);

    // O defeito original: a tela recarrega e o campo volta a zero.
    await expect(page.getByLabel(`Meta mensal de ${gerente.fullName}`)).toHaveValue(String(META_MES));

    await page.reload();
    await aguardarCarregamento(page);
    await expect(page.getByLabel(`Meta mensal de ${gerente.fullName}`)).toHaveValue(String(META_MES));
    await expect(page.getByLabel(`Meta anual de ${gerente.fullName}`)).toHaveValue(String(META_ANO));
  });

  test("meta negativa não habilita o botão nem chega ao banco", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    const mensal = page.getByLabel(`Meta mensal de ${gerente.fullName}`);
    await mensal.fill("-1");
    await expect(mensal).toHaveAttribute("aria-invalid", "true");
    // Botão desabilitado sozinho não explica nada: o motivo é escrito e ligado
    // ao campo por aria-describedby.
    await expect(mensal).toHaveAccessibleDescription(/maior ou igual a zero/);
    await expect(page.getByRole("button", { name: `Salvar metas de ${gerente.fullName}` })).toBeDisabled();

    const linhas = await metasDoGerente();
    const mes = linhas.find((l) => l.period_type === "month");
    expect(Number(mes?.target), "valor inválido não pode ter sobrescrito a meta").toBe(META_MES);
  });
});

test.describe("equipes · cadastro de colaborador", () => {
  test.afterAll(async () => {
    await removerConta(NOVO_EMAIL);
  });

  test("o e-mail sugerido segue o nome e um endereço inválido trava o cadastro", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: "Novo colaborador" }).click();

    const formulario = page.getByRole("form", { name: "Novo colaborador" });
    await formulario.getByLabel("Nome completo").fill("Maria Souza");
    await expect(formulario.getByLabel("E-mail de acesso")).toHaveValue("maria.souza@faceimob.com.br");

    await formulario.getByLabel("E-mail de acesso").fill("maria@");
    await expect(formulario.getByLabel("E-mail de acesso")).toHaveAttribute("aria-invalid", "true");
    await expect(formulario.getByRole("button", { name: "Cadastrar" })).toBeDisabled();

    await page.getByRole("button", { name: "Cancelar" }).click();
  });

  test("admin cadastra colaborador, o banco recebe perfil e papel, e a ficha abre para o resto", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: "Novo colaborador" }).click();

    const formulario = page.getByRole("form", { name: "Novo colaborador" });
    await formulario.getByLabel("Nome completo").fill(NOVO_NOME);
    await formulario.getByLabel("E-mail de acesso").fill(NOVO_EMAIL);
    await formulario.getByRole("button", { name: "Cadastrar" }).click();

    await expect(page.getByText("Colaborador cadastrado")).toBeVisible();

    const perfis = await db.select<{ id: string; full_name: string }>(
      `profiles?email=eq.${encodeURIComponent(NOVO_EMAIL)}&select=id,full_name`,
    );
    expect(perfis, "cadastro sem perfil no banco é só um toast verde").toHaveLength(1);
    expect(perfis[0].full_name).toBe(NOVO_NOME);

    const papeis = await db.select<{ role: string }>(
      `user_roles?profile_id=eq.${perfis[0].id}&select=role`,
    );
    expect(papeis.map((p) => p.role)).toEqual(["broker"]);

    // A ficha abre em seguida: é onde função, equipe e dados pessoais entram.
    await expect(page.getByRole("dialog").filter({ hasText: "Editar Colaborador" })).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();

    await expect(page.getByRole("region", { name: "Corretores" })).toContainText(NOVO_NOME);
  });
});

/**
 * "Vincular em massa" desliga quem fica desmarcado — e isso mudou o que dois
 * controles significam.
 *
 * 1) "Todos" SUBSTITUÍA a seleção pelos que casavam o filtro digitado. Com o
 *    desligamento, filtrar por um nome, clicar em "Todos" e aplicar tirava da
 *    equipe justamente quem o filtro tinha escondido — sem aviso nenhum antes.
 * 2) O único sinal de desligamento era o toast DEPOIS do fato.
 *
 * Este teste não aplica nada: ele para na confirmação, que é o ponto em que o
 * acidente deixa de acontecer. Nenhuma linha de `team_members` é tocada.
 */
test.describe("equipes · vínculo em massa não desliga por acidente", () => {
  test("'Todos' soma à seleção e o desligamento pede confirmação nominal", async ({ page }) => {
    const rival = userFor("brokerRival").fullName;
    const selecionados = async () => {
      const texto = await page.getByText(/selecionado\(s\) de/).innerText();
      return Number(texto.match(/^(\d+)/)?.[1] ?? -1);
    };

    await page.goto("/equipes");
    await aguardarCarregamento(page);

    await page.getByRole("region", { name: "Corretores" })
      .getByRole("button", { name: "Vincular em massa" }).click();

    const dialogo = page.getByRole("dialog").filter({ hasText: "Vincular corretores a um gerente" });
    await dialogo.getByRole("combobox").click();
    await page.getByRole("option", { name: gerente.fullName }).click();

    // A equipe do gerente já vem marcada — é o estado "ninguém sai".
    await expect(page.getByText(/selecionado\(s\) de/)).toBeVisible();
    const antes = await selecionados();
    expect(antes, "o gerente do cenário precisa ter corretores para este teste valer").toBeGreaterThan(1);
    await expect(dialogo.getByRole("status")).toHaveCount(0);

    // O defeito: com o filtro digitado, "Todos" substituía a seleção pelo que
    // sobrou na lista — e o resto virava desligamento silencioso.
    await dialogo.getByPlaceholder("Filtrar...").fill(rival.split(" ").pop() ?? rival);
    await dialogo.getByRole("button", { name: "Todos" }).click();
    expect(await selecionados(), "'Todos' com filtro não pode DESMARCAR quem o filtro escondeu")
      .toBe(antes);

    // Agora o caminho legítimo de desligar: desmarcar de propósito.
    await dialogo.getByPlaceholder("Filtrar...").fill("");
    await dialogo.getByRole("button", { name: "Nenhum" }).click();
    const aviso = dialogo.getByRole("status");
    // "sai da equipe" com um, "saem da equipe" com dois ou mais. O cenário já
    // exigiu `antes > 1` e acabou de desmarcar todo mundo, então o plural é o
    // caso GARANTIDO: cobrar o literal "sai" era pedir à tela que escrevesse
    // português errado para uma lista de corretores.
    await expect(aviso).toContainText(/sa(i|em) da equipe/);
    await expect(aviso).toContainText(rival);

    await dialogo.getByRole("button", { name: /^Aplicar \(/ }).click();
    const confirmacao = page.getByRole("alertdialog");
    await expect(confirmacao).toContainText(rival);
    await confirmacao.getByRole("button", { name: "Voltar e revisar" }).click();

    // Voltar não aplica nada: o diálogo continua aberto para revisão.
    await expect(dialogo).toBeVisible();
  });
});

/**
 * Prévia de papel — o RoleSwitcher fica no cabeçalho de TODA tela.
 *
 * A tela decidia o que mostrar por `useAuth().role`, que é o papel REAL, e
 * ignorava o `previewRole`. Resultado: o admin "vendo como corretor" continuava
 * com cadastro, lápis, vínculo em massa, campos de meta e a meta global — que é
 * exatamente o que a prévia existe para desmentir.
 */
test.describe("equipes · prévia de papel", () => {
  test("admin em prévia de corretor perde os controles que o corretor não tem", async ({ page }) => {
    const seletor = page.getByRole("combobox", { name: "Pré-visualizar como papel" });

    await page.goto("/equipes");
    await aguardarCarregamento(page);

    // O positivo primeiro: sem ele, o sumiço seria verdade por acidente.
    await expect(page.getByRole("button", { name: "Novo colaborador" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Salvar metas de / }).first()).toBeVisible();

    await seletor.click();
    await page.getByRole("option", { name: "Ver como Corretor" }).click();

    await expect(page.getByRole("button", { name: "Novo colaborador" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Vincular em massa" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Salvar metas de / })).toHaveCount(0);
    await expect(page.getByText("Meta global do mês")).toHaveCount(0);

    // Sair da prévia devolve tudo: prévia que não volta é tela quebrada.
    await seletor.click();
    await page.getByRole("option", { name: "Administrador (você)" }).click();
    await expect(page.getByRole("button", { name: "Novo colaborador" })).toBeVisible();
  });
});

/**
 * Trocar a função pela ficha — e não perder a pessoa de vista ao fazer isso.
 *
 * A gravação da ficha não tinha teste nenhum: o único e2e conferia que o
 * diálogo abre. Aqui a asserção é no banco (`user_roles` com o conjunto NOVO,
 * não acumulado) e na tela, porque marcar "SDR" e desmarcar "Corretor" fazia a
 * pessoa DESAPARECER — a tela só montava quatro colunas e não havia caminho
 * nenhum para reabrir a ficha de quem saía delas.
 */
test.describe("equipes · ficha do colaborador", () => {
  const FICHA_NOME = `E2E Ficha ${tag}`;
  const FICHA_EMAIL = `e2e.ficha.${tag}@faceimob.test`;
  let fichaId = "";

  test.beforeAll(async () => {
    const res = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({
        email: FICHA_EMAIL,
        email_confirm: true,
        user_metadata: { full_name: FICHA_NOME, e2e: true },
      }),
    });
    const corpo = await res.json();
    if (!res.ok || !corpo.id) throw new Error(`não consegui criar ${FICHA_EMAIL}: ${res.status}`);
    fichaId = corpo.id as string;
  });

  test.afterAll(async () => {
    await removerConta(FICHA_EMAIL);
  });

  test("marcar SDR e desmarcar Corretor grava o conjunto novo e a pessoa continua alcançável", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    // O positivo primeiro: nasce corretor (trigger `handle_new_auth_user`).
    const corretores = page.getByRole("region", { name: "Corretores" });
    await expect(corretores.getByText(FICHA_NOME, { exact: true })).toBeVisible();

    // O lápis tinha ícone e nenhum nome acessível — este seletor é a prova.
    await page.getByRole("button", { name: `Editar ficha de ${FICHA_NOME}` }).click();
    const ficha = page.getByRole("dialog").filter({ hasText: "Editar Colaborador" });
    await expect(ficha).toBeVisible();

    await ficha.getByLabel("SDR").check();
    await ficha.getByLabel("Corretor", { exact: true }).uncheck();
    await ficha.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Dados atualizados")).toBeVisible();

    // `set_profile_roles` SUBSTITUI o conjunto: acumular seria o defeito antigo.
    await expect(async () => {
      const papeis = await db.select<{ role: string }>(`user_roles?profile_id=eq.${fichaId}&select=role`);
      expect(papeis.map((p) => p.role).sort()).toEqual(["sdr"]);
    }).toPass({ timeout: 10_000 });

    // E a pessoa não some da tela: sai de Corretores e aparece em Outros papéis.
    await page.reload();
    await aguardarCarregamento(page);
    await expect(page.getByRole("region", { name: "Corretores" }).getByText(FICHA_NOME, { exact: true })).toHaveCount(0);
    const outros = page.getByRole("region", { name: "Outros papéis" });
    await expect(outros.getByText(FICHA_NOME, { exact: true })).toBeVisible();
    await expect(outros).toContainText("SDR");

    // E a ficha dela continua abrindo a partir dali.
    await page.getByRole("button", { name: `Editar ficha de ${FICHA_NOME}` }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Editar Colaborador" })).toBeVisible();
  });
});

/**
 * O CAMINHO DE ESCRITA do vínculo em massa — que não tinha teste nenhum.
 *
 * O caso acima para na confirmação de propósito ("Nenhuma linha de team_members
 * é tocada"), então as ~90 linhas de `applyBulk` (fechar vínculo anterior,
 * inserir, desligar, falha parcial) nunca rodavam. Aqui elas rodam, contra um
 * gerente e um corretor criados só para isto: mexer na equipe do gerente E2E
 * quebraria os specs de isolamento que dependem dela.
 *
 * O mesmo cenário cobre "Desativar equipe", que até agora não existia em tela
 * nenhuma — e era a saída que `activeTeamIdOfManager` manda procurar quando o
 * gerente tem mais de uma equipe ativa.
 */
test.describe("equipes · vínculo em massa grava e desliga de verdade", () => {
  const GER_NOME = `E2E GerVinculo ${tag}`;
  const GER_EMAIL = `e2e.gervinculo.${tag}@faceimob.test`;
  const COR_NOME = `E2E CorVinculo ${tag}`;
  const COR_EMAIL = `e2e.corvinculo.${tag}@faceimob.test`;
  let gerId = "";
  let corId = "";
  let equipeId = "";

  const criarConta = async (email: string, nome: string) => {
    const res = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: nome, e2e: true } }),
    });
    const corpo = await res.json();
    if (!res.ok || !corpo.id) throw new Error(`não consegui criar ${email}: ${res.status}`);
    return corpo.id as string;
  };

  const vinculosDoCorretor = () =>
    db.select<{ team_id: string; left_at: string | null }>(
      `team_members?profile_id=eq.${corId}&select=team_id,left_at`,
    );

  test.beforeAll(async () => {
    gerId = await criarConta(GER_EMAIL, GER_NOME);
    corId = await criarConta(COR_EMAIL, COR_NOME);
    // O trigger dá 'broker' a todo perfil novo; o gerente precisa do papel dele.
    await db.insert("user_roles", { profile_id: gerId, role: "manager" });
    const [equipe] = await db.insert<{ id: string }>("teams", {
      name: `Equipe ${GER_NOME}`,
      slug: `equipe-gervinculo-${tag}`,
      manager_id: gerId,
    });
    equipeId = equipe.id;
    // O gerente entra como membro da própria equipe, como `createTeamForManager`.
    await db.insert("team_members", { team_id: equipeId, profile_id: gerId });
  });

  test.afterAll(async () => {
    if (equipeId) await db.remove(`teams?id=eq.${equipeId}`);
    await removerConta(GER_EMAIL);
    await removerConta(COR_EMAIL);
  });

  test("vincular grava a linha, desmarcar desliga, e desativar a equipe fecha o resto", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    // ── 1) vincular ────────────────────────────────────────────────────────
    await page.getByRole("region", { name: "Corretores" })
      .getByRole("button", { name: "Vincular em massa" }).click();
    const dialogo = page.getByRole("dialog").filter({ hasText: "Vincular corretores a um gerente" });
    await dialogo.getByRole("combobox").click();
    await page.getByRole("option", { name: GER_NOME }).click();

    await dialogo.getByPlaceholder("Filtrar...").fill(COR_NOME);
    // O Checkbox do Radix é um `button` VAZIO: envolvê-lo num `<label>` não lhe
    // dá nome nenhum, e quem usa leitor de tela ouvia "caixa de seleção" sem
    // saber de quem — no diálogo em que desmarcar DESLIGA a pessoa da equipe.
    await expect(
      dialogo.getByRole("checkbox", { name: COR_NOME }),
      "cada linha do vínculo em massa precisa de nome acessível",
    ).toHaveCount(1);
    await dialogo.getByRole("button", { name: "Todos" }).click();
    // Ninguém sai: a equipe está vazia de corretores, não há confirmação a passar.
    await expect(dialogo.getByRole("status")).toHaveCount(0);
    await dialogo.getByRole("button", { name: /^Aplicar \(/ }).click();

    await expect(async () => {
      const linhas = await vinculosDoCorretor();
      expect(linhas, "toast verde sem linha em team_members é tela mentindo").toHaveLength(1);
      expect(linhas[0].team_id).toBe(equipeId);
      expect(linhas[0].left_at).toBeNull();
    }).toPass({ timeout: 10_000 });

    // E a tela passa a dizer de quem ele é — não mais "Sem gerente".
    await expect(page.getByRole("region", { name: "Corretores" })).toContainText(`↑ ${GER_NOME}`);

    // ── 2) desligar pelo desmarcar ─────────────────────────────────────────
    await page.getByRole("region", { name: "Corretores" })
      .getByRole("button", { name: "Vincular em massa" }).click();
    await dialogo.getByRole("combobox").click();
    await page.getByRole("option", { name: GER_NOME }).click();
    await dialogo.getByRole("button", { name: "Nenhum" }).click();
    await expect(dialogo.getByRole("status")).toContainText(COR_NOME);
    await dialogo.getByRole("button", { name: /^Aplicar \(/ }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Aplicar e desligar" }).click();

    await expect(async () => {
      const linhas = await vinculosDoCorretor();
      expect(linhas).toHaveLength(1);
      expect(linhas[0].left_at, "desligar tem de gravar left_at").not.toBeNull();
    }).toPass({ timeout: 10_000 });

    // ── 3) desativar a equipe ──────────────────────────────────────────────
    await page.reload();
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: `Desativar a equipe de ${GER_NOME}` }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Desativar" }).click();

    await expect(async () => {
      const [equipe] = await db.select<{ active: boolean }>(`teams?id=eq.${equipeId}&select=active`);
      expect(equipe.active, "sem isto não há caminho nenhum para desativar equipe").toBe(false);
      // O gerente era o vínculo aberto restante e sai junto: membro preso a uma
      // equipe inativa fica sem gerente e sem caminho de volta.
      const abertos = await db.select<{ id: string }>(
        `team_members?team_id=eq.${equipeId}&left_at=is.null&select=id`,
      );
      expect(abertos).toHaveLength(0);
    }).toPass({ timeout: 10_000 });
  });
});

/**
 * O ramo de TROCA de e-mail da edge function — 0 execuções na homologação até
 * aqui (`access_provision_log` só tinha `action='create'`).
 *
 * É o ramo que o botão "Atualizar e-mail de acesso" chama, e o único caminho da
 * reversão do Auth quando o espelho em `profiles` recusa. Sem este teste, o
 * botão da ficha nunca tinha sido exercitado por ninguém.
 */
test.describe("equipes · trocar o e-mail de acesso", () => {
  const NOME = `E2E Reset ${tag}`;
  const EMAIL_ANTIGO = `e2e.reset.${tag}@faceimob.test`;
  const EMAIL_NOVO = `e2e.reset.novo.${tag}@faceimob.test`;
  let perfilId = "";

  test.beforeAll(async () => {
    const res = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL_ANTIGO, email_confirm: true, user_metadata: { full_name: NOME, e2e: true } }),
    });
    const corpo = await res.json();
    if (!res.ok || !corpo.id) throw new Error(`não consegui criar ${EMAIL_ANTIGO}: ${res.status}`);
    perfilId = corpo.id as string;
  });

  test.afterAll(async () => {
    await removerConta(EMAIL_ANTIGO);
    await removerConta(EMAIL_NOVO);
  });

  test("o botão troca Auth e profiles juntos e deixa linha de auditoria", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: `Editar ficha de ${NOME}` }).click();
    const ficha = page.getByRole("dialog").filter({ hasText: "Editar Colaborador" });
    await expect(ficha).toBeVisible();

    await ficha.getByLabel("E-mail de login").fill(EMAIL_NOVO);
    // O gate existe porque a troca é de um clique e sem volta fácil.
    await expect(ficha.getByRole("button", { name: "Atualizar e-mail de acesso" })).toBeDisabled();
    await ficha.getByRole("button", { name: "Confirmar" }).click();
    await ficha.getByRole("button", { name: "Atualizar e-mail de acesso" }).click();

    await expect(page.getByText("E-mail de acesso atualizado")).toBeVisible();

    await expect(async () => {
      // Espelho: o login e a coluna mudam juntos, ou nenhum dos dois.
      const [perfil] = await db.select<{ email: string }>(`profiles?id=eq.${perfilId}&select=email`);
      expect(perfil.email).toBe(EMAIL_NOVO);
      const trilha = await db.select<{ action: string; email: string }>(
        `access_provision_log?profile_id=eq.${perfilId}&select=action,email`,
      );
      expect(trilha.map((t) => t.action), "o ramo de reset tem de deixar rastro").toContain("reset");
      expect(trilha.find((t) => t.action === "reset")?.email).toBe(EMAIL_NOVO);
    }).toPass({ timeout: 15_000 });

    // E a caixa verde mostra o endereço NOVO — é a razão de o modal não fechar.
    await expect(ficha).toContainText(EMAIL_NOVO);
  });

  /**
   * As duas tabelas de auditoria tinham policy de leitura só para admin e
   * NENHUMA tela: a trilha existia e ninguém a lia, que é o mesmo que não
   * existir no dia em que alguém pergunta quem mexeu no acesso de quem.
   */
  test("a trilha de auditoria mostra a troca que acabou de acontecer", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: "Ver últimos registros" }).click();
    await expect(page.getByText("trocou o e-mail de acesso").first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: EMAIL_NOVO }).first()).toBeVisible();
  });
});

/**
 * Desligamento definitivo. `profile_status` tem `terminated` no enum desde a
 * 0002 e NENHUMA tela escrevia nele: o Switch "Ativo" só sabia suspender.
 */
test.describe("equipes · desligar colaborador", () => {
  const NOME = `E2E Desligado ${tag}`;
  const EMAIL = `e2e.desligado.${tag}@faceimob.test`;
  let perfilId = "";

  test.beforeAll(async () => {
    const res = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, email_confirm: true, user_metadata: { full_name: NOME, e2e: true } }),
    });
    const corpo = await res.json();
    if (!res.ok || !corpo.id) throw new Error(`não consegui criar ${EMAIL}: ${res.status}`);
    perfilId = corpo.id as string;
  });

  test.afterAll(() => removerConta(EMAIL));

  test("desligar grava status e data juntos, e a tela passa a dizer 'Desligado'", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: `Editar ficha de ${NOME}` }).click();
    const ficha = page.getByRole("dialog").filter({ hasText: "Editar Colaborador" });

    await ficha.getByRole("button", { name: "Desligar definitivamente" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Desligar" }).click();
    await expect(page.getByText("Colaborador desligado")).toBeVisible();

    await expect(async () => {
      const [perfil] = await db.select<{ status: string; terminated_at: string | null }>(
        `profiles?id=eq.${perfilId}&select=status,terminated_at`,
      );
      expect(perfil.status).toBe("terminated");
      // `profiles_terminated_consistency` exige os dois juntos: um sem o outro
      // é 23514 garantido.
      expect(perfil.terminated_at, "status sem data viola o check da tabela").not.toBeNull();
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await aguardarCarregamento(page);
    const coluna = page.getByRole("region", { name: "Corretores" });
    await expect(coluna).toContainText(NOME);
    await expect(coluna).toContainText("Desligado");
  });

  /**
   * O buraco que o desligamento deixava aberto: `status = 'terminated'` tirava
   * a pessoa das listas e a CONTA continuava entrando. Quem saía da empresa
   * seguia lendo os próprios leads, negócios e o diário da equipe, e bloquear
   * era "tarefa do painel do Supabase" — ou seja, de ninguém.
   *
   * Roda depois do caso acima, no mesmo `describe`, porque depende do
   * desligamento que ele aplicou.
   */
  test("o desligamento bloqueia a entrada no Auth, e reativar devolve", async ({ page }) => {
    const contaDe = () =>
      authAdmin(`users/${perfilId}`).then((r) => r.json() as Promise<{ banned_until?: string | null }>);

    await expect(async () => {
      const conta = await contaDe();
      expect(conta.banned_until, "desligado com login aberto é o defeito").toBeTruthy();
    }).toPass({ timeout: 15_000 });

    const trilha = await db.select<{ action: string }>(
      `access_provision_log?profile_id=eq.${perfilId}&select=action`,
    );
    expect(trilha.map((t) => t.action), "bloquear a entrada tem de deixar rastro").toContain("revoked");

    // A volta: ligar o Switch "Ativo" reativa a ficha E devolve o acesso.
    await page.goto("/equipes");
    await aguardarCarregamento(page);
    await page.getByRole("button", { name: `Editar ficha de ${NOME}` }).click();
    const ficha = page.getByRole("dialog").filter({ hasText: "Editar Colaborador" });
    await expect(ficha).toContainText("Ligue o Switch e salve para reativar");

    await ficha.getByRole("switch", { name: /Reativar/ }).click();
    await ficha.getByRole("button", { name: "Salvar" }).click();
    // A frase é a que vale nos DOIS ramos do aviso. "ele volta a receber o
    // código" é o ramo com SMTP, e a função só o liga com `SMTP_CONFIGURED`:
    // esta homologação responde `login_ready: false` (medido no corpo da
    // resposta do ramo `access: restore`), então cobrar aquela frase aqui era
    // pedir à tela que prometesse um código que o ambiente não manda — o
    // oposto do que o unitário "reativar sem SMTP não promete o código de 6
    // dígitos" (src/components/BrokerEditModal.test.tsx) exige. O efeito de
    // verdade — banimento fora e status `active` — é o bloco logo abaixo.
    await expect(page.getByText("O bloqueio de entrada foi removido")).toBeVisible();

    await expect(async () => {
      const conta = await contaDe();
      // GoTrue devolve `null` ou uma data no passado quando o banimento sai.
      const preso = conta.banned_until && new Date(conta.banned_until) > new Date();
      expect(preso, "reativado com o login trancado é o mesmo defeito ao contrário").toBeFalsy();
      const [perfil] = await db.select<{ status: string }>(`profiles?id=eq.${perfilId}&select=status`);
      expect(perfil.status).toBe("active");
    }).toPass({ timeout: 15_000 });
  });
});

/**
 * 375 px. A linha de meta tem rótulo, dois campos numéricos e um botão numa só
 * `flex`, e o card de gerente ganhou ainda o campo "Equipe" e o "Desativar":
 * sem `flex-wrap` a coluna estourava a lateral no celular.
 */
test.describe("equipes · celular", () => {
  test.use({ viewport: { width: 375, height: 780 } });

  test("nenhuma coluna do organograma transborda na horizontal", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    for (const nome of ["Diretores", "Gerentes", "Corretores"]) {
      const excesso = await page.getByRole("region", { name: nome }).evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      expect(excesso, `a coluna ${nome} transborda ${excesso}px a 375`).toBeLessThanOrEqual(1);
    }
  });

  test("a ficha do colaborador cabe na tela do celular", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    await page.getByRole("button", { name: /^Editar ficha de / }).first().click();
    const ficha = page.getByRole("dialog").filter({ hasText: "Editar Colaborador" });
    await expect(ficha).toBeVisible();
    // `grid md:grid-cols-3` dentro de `max-w-3xl`: a 375 px o grid vira uma
    // coluna, mas o contêiner precisa acompanhar.
    const excesso = await ficha.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(excesso, `a ficha transborda ${excesso}px a 375`).toBeLessThanOrEqual(1);
  });
});

/**
 * O ramo de TROCA com e-mail já em uso — o caminho que a função inteira existe
 * para ter e que nunca tinha rodado.
 *
 * `updateUserById` falha quando o endereço pertence a outra conta. Esse erro
 * caía no `catch` geral e virava **500 com a mensagem crua do GoTrue**, sem
 * linha de auditoria e sem saída nenhuma para o admin — enquanto o ramo de
 * CRIAÇÃO, para a MESMA condição, já respondia 409 com `existing_profile_id`,
 * que é o que a tela usa para abrir a ficha de quem já tem o endereço.
 *
 * O teste cobra as duas metades: a resposta certa E a ausência de meia troca
 * (o `profiles.email` das duas pessoas e o e-mail do Auth continuam onde
 * estavam). 409 com o espelho já mexido seria pior que o 500.
 */
test.describe("provisionamento · e-mail já em uso no ramo de troca", () => {
  const EMAIL_OCUPADO = `e2e.ocupado.${tag}@faceimob.test`;
  const EMAIL_ALVO = `e2e.alvo.${tag}@faceimob.test`;
  let ocupadoId = "";
  let alvoId = "";

  const criarConta = async (email: string, nome: string) => {
    const res = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: nome, e2e: true } }),
    });
    const corpo = await res.json();
    if (!res.ok || !corpo.id) throw new Error(`não consegui criar ${email}: ${res.status}`);
    return corpo.id as string;
  };

  test.beforeAll(async () => {
    ocupadoId = await criarConta(EMAIL_OCUPADO, `E2E Ocupado ${tag}`);
    alvoId = await criarConta(EMAIL_ALVO, `E2E Alvo ${tag}`);
  });

  test.afterAll(async () => {
    await removerConta(EMAIL_OCUPADO);
    await removerConta(EMAIL_ALVO);
  });

  test("responde 409 com o perfil que já usa o endereço, e não troca nada pela metade", async () => {
    const { access_token } = await mintSession(userFor("admin").email);
    const res = await fetch(`${target.supabaseUrl}/functions/v1/provision-broker-user`, {
      method: "POST",
      headers: {
        apikey: target.anonKey,
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ broker_id: alvoId, email: EMAIL_OCUPADO, reset: true }),
    });

    expect(res.status, "e-mail duplicado é erro de usuário, não falha de servidor").toBe(409);
    const corpo = (await res.json()) as { error?: string; existing_profile_id?: string };
    expect(corpo.error).toMatch(/já existe/i);
    expect(
      corpo.existing_profile_id,
      "sem o id o admin fica sem caminho: é ele que abre a ficha de quem tem o endereço",
    ).toBe(ocupadoId);

    // Nenhuma metade gravada: espelho e Auth continuam como estavam.
    const [alvo] = await db.select<{ email: string }>(`profiles?id=eq.${alvoId}&select=email`);
    expect(alvo.email, "o espelho não pode andar sem o Auth").toBe(EMAIL_ALVO);
    const [ocupado] = await db.select<{ email: string }>(`profiles?id=eq.${ocupadoId}&select=email`);
    expect(ocupado.email).toBe(EMAIL_OCUPADO);

    const conta = await authAdmin(`users/${alvoId}`).then((r) => r.json() as Promise<{ email?: string }>);
    expect(conta.email, "o login recusado tem de continuar sendo o antigo").toBe(EMAIL_ALVO);
  });
});

/**
 * A hierarquia medida com o JWT de CADA papel, e não pela tela do admin.
 *
 * `auth_visible_profiles()` é a fonte única de visibilidade e não sobe a
 * hierarquia. Dois defeitos vinham daí, e os dois eram invisíveis para um teste
 * feito com a sessão do administrador (que vê tudo):
 *
 *  · o DIRETOR não enxergava o gerente das equipes que ele mesmo dirige — nada
 *    no schema obriga o gerente a ser membro da própria equipe, e o front é que
 *    fazia isso por convenção. Consequência medida: "Gerentes (0)", todo card
 *    de corretor com "Sem gerente" e "Vincular em massa" sem ninguém para
 *    vincular. A 0079 acrescentou o ramo do `teams.manager_id`;
 *  · o GERENTE não enxerga o diretor, e por isso o card dele escrevia "Sem
 *    diretor". A correção NÃO foi abrir `profiles` para cima — isso entregaria
 *    cpf e endereço junto —, foi a view `team_leader_names`. Este teste é o que
 *    separa as duas saídas: o nome vem, a ficha não.
 *
 * Tudo por PostgREST com o token real de cada um: é o recorte do banco que está
 * sendo medido, não o filtro que a tela faz por cima.
 */
test.describe("hierarquia · o recorte medido com o token de cada papel", () => {
  const comoUsuario = async <T,>(email: string, query: string): Promise<T[]> => {
    const { access_token } = await mintSession(email);
    const res = await fetch(`${target.supabaseUrl}/rest/v1/${query}`, {
      headers: { apikey: target.anonKey, Authorization: `Bearer ${access_token}` },
    });
    if (!res.ok) throw new Error(`select ${query} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T[]>;
  };

  const nomesVisiveis = (email: string) =>
    comoUsuario<{ full_name: string }>(email, "profiles?select=full_name&limit=200")
      .then((linhas) => linhas.map((l) => l.full_name));

  test("o diretor enxerga o gerente das equipes que dirige e os corretores delas", async () => {
    const nomes = await nomesVisiveis(userFor("director").email);

    expect(
      nomes,
      "sem isto /equipes abre 'Gerentes (0)' para o diretor e ele não vincula ninguém a si",
    ).toContain(userFor("manager").fullName);
    expect(nomes, "membro aberto da equipe que ele dirige").toContain(userFor("broker").fullName);
    expect(nomes).toContain(userFor("director").fullName);

    // E o ramo novo NÃO alargou nada além disso: quem não está na diretoria
    // continua fora.
    expect(nomes, "SDR não pertence a equipe nenhuma dele").not.toContain(userFor("sdr").fullName);
    expect(nomes).not.toContain(userFor("marketing").fullName);
  });

  test("o gerente lê o NOME do diretor, e a ficha dele continua fechada", async () => {
    const gerenteEmail = userFor("manager").email;
    const diretorId = await db.profileIdOf("director");

    const nomes = await comoUsuario<{ id: string; full_name: string }>(
      gerenteEmail,
      `team_leader_names?id=eq.${diretorId}&select=id,full_name`,
    );
    expect(nomes, "sem a view o card do gerente volta a escrever 'Sem diretor'").toHaveLength(1);
    expect(nomes[0].full_name).toBe(userFor("director").fullName);

    const ficha = await comoUsuario<{ id: string }>(
      gerenteEmail,
      `profiles?id=eq.${diretorId}&select=id,cpf,address`,
    );
    expect(
      ficha,
      "resolver o rótulo abrindo profiles entregaria cpf e endereço do diretor junto",
    ).toHaveLength(0);
  });

  test("SDR, marketing e CCA não ganharam ninguém com a mudança", async () => {
    // Os três não lideram nem pertencem a equipe: o conjunto deles é só eles
    // mesmos, e o ramo novo (gerente das equipes que EU lidero) devolve vazio.
    for (const papel of ["sdr", "marketing", "cca"] as const) {
      const eu = userFor(papel);
      const nomes = await nomesVisiveis(eu.email);
      expect(nomes, `${eu.fullName} tem de continuar se enxergando`).toContain(eu.fullName);
      expect(nomes, `${eu.fullName} não pode alcançar o cadastro do gerente`)
        .not.toContain(userFor("manager").fullName);
      expect(nomes, `${eu.fullName} não pode alcançar o cadastro de corretor`)
        .not.toContain(userFor("broker").fullName);
    }
  });
});
