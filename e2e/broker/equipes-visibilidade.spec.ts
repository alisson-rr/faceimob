import { test, expect, db, aguardarCarregamento } from "../support/fixtures";
import { resolveTarget } from "../support/target";
import { mintSession } from "../support/session";
import { userFor } from "../support/users";

/**
 * Equipes pelos olhos do corretor.
 *
 * A tela filtrava a hierarquia por uma regra própria (`inScope`) que só sabia
 * tratar admin e diretor: para corretor, gerente, CCA e parceiro devolvia
 * `false` em tudo e a página abria "Diretores (0) · Gerentes (0) ·
 * Corretores (0)", sem uma palavra explicando. Quem recorta é a RLS
 * (`profiles_select` = `auth_visible_profiles()`), então o teste cobra os dois
 * lados: o que a RLS entrega tem de aparecer, o que ela esconde não pode
 * aparecer — e coluna vazia tem de dizer por quê.
 */
const eu = userFor("broker");
const rival = userFor("brokerRival");
const meuGerente = userFor("manager");
const meuDiretor = userFor("director");

test.describe("corretor · hierarquia em Equipes", () => {
  test("vê a si mesmo, não vê a equipe rival, e a coluna vazia explica o motivo", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);
    await expect(page.getByRole("heading", { name: "Equipes", level: 1 })).toBeVisible();

    // O positivo primeiro: sem ele, a ausência do rival seria verdade por
    // acidente (tela que não carregou passaria no teste).
    const corretores = page.getByRole("region", { name: "Corretores" });
    await expect(corretores.getByText(eu.fullName, { exact: true })).toBeVisible();
    await expect(corretores).toContainText("Corretores (1)");
    await expect(corretores.getByText(rival.fullName, { exact: true })).toHaveCount(0);

    // E o card DIZ de quem ele é. Conferir só o nome e o contador deixava passar
    // o defeito que estava ali: `auth_visible_profiles()` não sobe a hierarquia,
    // então o nome do gerente não vinha em `profiles` e a tela escrevia
    // "Sem gerente" — informação falsa, com o vínculo existindo no banco.
    await expect(corretores).toContainText(`↑ ${meuGerente.fullName}`);
    await expect(corretores, "vínculo existe: dizer 'Sem gerente' é mentir")
      .not.toContainText("Sem gerente");

    // O corretor não lidera equipe: `auth_visible_profiles()` devolve só ele, e
    // as outras duas colunas ficam legitimamente vazias — com texto, não em branco.
    await expect(page.getByRole("region", { name: "Gerentes" }))
      .toContainText("Nenhum gerente visível para o seu acesso.");
    await expect(page.getByRole("region", { name: "Diretores" }))
      .toContainText("Nenhum diretor visível para o seu acesso.");
  });

  test("Meu Perfil mostra gerente e diretor pelo nome, não dois travessões", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    const meuPerfil = page.getByRole("region", { name: "Meu Perfil" });
    await expect(meuPerfil).toContainText(eu.fullName);
    await expect(meuPerfil).toContainText(meuGerente.fullName);
    await expect(meuPerfil).toContainText(meuDiretor.fullName);
  });

  test("o corretor rival existe no banco — a ausência na tela é do RLS, não do cenário", async () => {
    const linhas = await db.select<{ id: string }>(
      `profiles?email=eq.${encodeURIComponent(rival.email)}&select=id`,
    );
    expect(linhas).toHaveLength(1);
  });

  test("não recebe botões que o servidor recusaria", async ({ page }) => {
    await page.goto("/equipes");
    await aguardarCarregamento(page);

    // Cadastrar exige service role e a edge function só aceita admin.
    await expect(page.getByRole("button", { name: "Novo colaborador" })).toHaveCount(0);
    // Meta de perfil: `goals_write` é admin e diretor.
    await expect(page.getByRole("button", { name: /^Salvar metas de / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Vincular em massa" })).toHaveCount(0);
  });
});

/**
 * A quinta coluna ("Outros papéis") não pode virar um vazamento.
 *
 * Ela existe porque admin, SDR, marketing e sócio sumiam da tela — uma pessoa
 * desaparecia pelo próprio ato de receber o papel certo. Mas quem recorta
 * continua sendo `auth_visible_profiles()`: para o corretor a coluna tem de vir
 * vazia, com o texto explicando, e sem lápis nenhum.
 */
test("corretor vê a coluna Outros papéis vazia, e sem botão de editar ficha", async ({ page }) => {
  await page.goto("/equipes");
  await aguardarCarregamento(page);

  const outros = page.getByRole("region", { name: "Outros papéis" });
  await expect(outros).toBeVisible();
  await expect(outros).toContainText("Outros papéis (0)");
  await expect(page.getByRole("button", { name: /^Editar ficha de / })).toHaveCount(0);
});

/**
 * O 403 da edge function — a única porta de criação de gente no sistema.
 *
 * `provision-broker-user` tem a service role e confere sozinha se o chamador é
 * admin: esconder o botão "Novo colaborador" da tela é conveniência, e não
 * havia teste nenhum do caminho de recusa. Aqui a chamada sai de fora do
 * navegador, com a sessão real do corretor, que é como um atacante faria.
 */
test("a edge function de provisionamento recusa quem não é admin", async () => {
  const t = resolveTarget();
  const { access_token } = await mintSession(eu.email);
  const res = await fetch(`${t.supabaseUrl}/functions/v1/provision-broker-user`, {
    method: "POST",
    headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "invasor.corretor@faceimob.test", full_name: "Invasor" }),
  });
  expect(res.status, "criar acesso é do admin, e quem barra é a função").toBe(403);
  expect(await res.text()).toMatch(/administradores/i);

  // E nada foi criado: 403 com perfil no banco seria pior que 200.
  const perfis = await db.select<{ id: string }>(
    "profiles?email=eq.invasor.corretor%40faceimob.test&select=id",
  );
  expect(perfis).toHaveLength(0);
});

/**
 * O ramo que BLOQUEIA a entrada de alguém está atrás da mesma porta.
 *
 * Ele foi acrescentado para o desligamento fechar o login de quem sai da
 * empresa — e, mal guardado, seria o contrário: um corretor trancando o gerente
 * para fora com um POST. A checagem de papel acontece antes de qualquer ramo,
 * e este teste é o que cobra isso de fora do navegador.
 */
test("o corretor não bloqueia a entrada de ninguém", async () => {
  const t = resolveTarget();
  const { access_token } = await mintSession(eu.email);
  const alvo = (await db.select<{ id: string }>(
    `profiles?email=eq.${encodeURIComponent(meuGerente.email)}&select=id`,
  ))[0].id;

  const res = await fetch(`${t.supabaseUrl}/functions/v1/provision-broker-user`, {
    method: "POST",
    headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: alvo, access: "revoke" }),
  });
  expect(res.status, "bloquear entrada é do admin, e quem barra é a função").toBe(403);

  // E o gerente continua entrando: o 403 tem de ser antes de qualquer efeito.
  const conta = await fetch(`${t.supabaseUrl}/auth/v1/admin/users/${alvo}`, {
    headers: { apikey: t.serviceRoleKey, Authorization: `Bearer ${t.serviceRoleKey}` },
  }).then((r) => r.json() as Promise<{ banned_until?: string | null }>);
  const preso = conta.banned_until && new Date(conta.banned_until) > new Date();
  expect(preso, "403 com a conta já banida seria pior que 200").toBeFalsy();
});

/**
 * O nome do líder chega; a FICHA dele não.
 *
 * A correção do "Sem gerente" tinha duas saídas possíveis: alargar
 * `auth_visible_profiles()` para cima — o que entregaria cpf, endereço e
 * nascimento do diretor a trinta corretores, porque RLS é por linha — ou uma
 * view só com nome. Este teste é o que separa as duas: o nome vem, a linha de
 * `profiles` continua fechada. Se alguém "resolver" o rótulo abrindo a tabela,
 * ele reprova.
 */
test("o corretor lê o NOME do gerente, e nada além disso", async () => {
  const t = resolveTarget();
  const { access_token } = await mintSession(eu.email);
  const comoCorretor = (query: string) =>
    fetch(`${t.supabaseUrl}/rest/v1/${query}`, {
      headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}` },
    }).then((r) => r.json());

  const gerenteId = (await db.select<{ id: string }>(
    `profiles?email=eq.${encodeURIComponent(meuGerente.email)}&select=id`,
  ))[0].id;

  const nomes = await comoCorretor(`team_leader_names?id=eq.${gerenteId}&select=id,full_name`);
  expect(nomes, "sem isto o card do corretor volta a escrever 'Sem gerente'").toHaveLength(1);
  expect(nomes[0].full_name).toBe(meuGerente.fullName);

  const ficha = await comoCorretor(`profiles?id=eq.${gerenteId}&select=id,cpf,address`);
  expect(ficha, "o cadastro do gerente continua fora do alcance do corretor").toHaveLength(0);
});
