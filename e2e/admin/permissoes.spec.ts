import { test, expect, db, aguardarCarregamento, runTag } from "../support/fixtures";
import { resolveTarget } from "../support/target";
import { mintSession } from "../support/session";
import { userFor } from "../support/users";

/**
 * AdminPermissions: alterar uma permissão tem de SOBREVIVER ao recarregamento.
 *
 * A tela grava otimista — o switch vira antes da resposta. Uma auditoria já
 * encontrou telas que mostravam "salvo" sem gravar nada, então aqui a asserção
 * é dupla: a linha aparece em `role_permissions` E a tela continua marcada
 * depois de um F5 (que é quando a leitura vem do banco de novo).
 *
 * O papel escolhido é "Sócio" (`partner`) de propósito: nenhum usuário da suíte
 * tem esse papel, então mexer nele não muda o que outro agente está testando no
 * mesmo banco. E `menu.admin_developers` começa sem linha — ou seja, negado.
 */
const PAPEL = "partner";
const CODIGO = "menu.admin_developers";
const ROTULO = /Construtoras para Sócio/;

const linhaNoBanco = () =>
  db.select<{ allowed: boolean }>(
    `role_permissions?role=eq.${PAPEL}&permission=eq.${CODIGO}&select=allowed`,
  );

const apagarLinha = () =>
  db.remove(`role_permissions?role=eq.${PAPEL}&permission=eq.${CODIGO}`);

/** Estado inicial explícito: cada caso decide o seu, sem herdar do anterior. */
async function prepararLinha(allowed: boolean | null) {
  await apagarLinha();
  if (allowed !== null) {
    await db.insert("role_permissions", { role: PAPEL, permission: CODIGO, allowed });
  }
}

test.afterAll(apagarLinha);

test("conceder uma permissão grava no banco e sobrevive ao recarregar", async ({ page }) => {
  await prepararLinha(null); // sem linha = negado

  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);

  // O <h1> tem de sair do PageHeader (regra 2 de docs/design-system.md): escrito
  // à mão, esta tela ficava em `text-xl` contra o `text-2xl sm:text-3xl` das
  // outras 17 — e um <h1> por tela é o que a navegação por cabeçalho usa.
  await expect(page.getByRole("heading", { name: "Permissões", level: 1 })).toBeVisible();

  const chave = page.getByRole("switch", { name: ROTULO });
  await expect(chave).toBeVisible();
  await expect(chave).not.toBeChecked();

  await chave.click();
  await expect(chave).toBeChecked();

  await expect(async () => {
    expect(await linhaNoBanco()).toEqual([{ allowed: true }]);
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByRole("switch", { name: ROTULO })).toBeChecked();
});

test("revogar a mesma permissão também persiste", async ({ page }) => {
  await prepararLinha(true);

  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);

  const chave = page.getByRole("switch", { name: ROTULO });
  await expect(chave).toBeChecked();

  await chave.click();
  await expect(chave).not.toBeChecked();

  await expect(async () => {
    expect(await linhaNoBanco()).toEqual([{ allowed: false }]);
  }).toPass({ timeout: 10_000 });

  await page.reload();
  await aguardarCarregamento(page);
  await expect(page.getByRole("switch", { name: ROTULO })).not.toBeChecked();
});

/**
 * Aba "Funcionalidades": onze dos doze códigos gravavam e ninguém lia (auditoria
 * de 01/09). A tela passou a dizer, ao lado de cada switch, se a permissão vale
 * no banco, só na tela, ou ainda em lugar nenhum — e o texto vem do mapa
 * `src/lib/featurePermissions.ts`, que o vitest confere contra a migration E
 * contra o fonte das telas (o selo não pode ser uma afirmação do próprio mapa).
 *
 * "Ver dados financeiros" era o caso que mais enganava — ao contrário: o selo
 * dizia "Ainda sem efeito" e o código já era predicado de `ad_campaigns_select`,
 * `marketing_investments_select` e `marketing_campaign_stats()` desde a 0045. O
 * vitest agora lê TODAS as migrations que citam permissão, não só a 0044, que é
 * o que deixava esse rótulo mentir. "Editar VGV" passou a valer na 0061.
 */
test("a aba Funcionalidades diz onde cada permissão vale", async ({ page }) => {
  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);
  await page.getByRole("tab", { name: /funcionalidades/i }).click();

  const linha = (rotulo: string) => page.getByRole("row", { name: new RegExp(rotulo) });
  await expect(linha("Realocar leads")).toContainText("Aplicada no banco");
  await expect(linha("Ver dados financeiros")).toContainText("Aplicada no banco");
  await expect(linha("Editar VGV")).toContainText("Aplicada no banco");
  // O alcance real do switch precisa estar escrito ao lado dele.
  await expect(linha("Editar VGV")).toContainText(/VGV bruto e desconto/i);
});

/**
 * Aba "Acesso ao Menu": desde a 0044 um item de menu virou predicado de RLS
 * (`allowed_ips_read` lê `menu.admin_allowed_ips`). Conceder "Admin · IPs"
 * deixou de ser cosmético — entrega a lista de faixas do check-in, que é o
 * controle antifraude. A tela tem de avisar antes do clique.
 */
test("a aba Menu avisa qual item também libera dado no banco", async ({ page }) => {
  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);

  const linhaIps = page.getByRole("row", { name: /Admin . IPs/ }).first();
  await expect(linhaIps).toContainText("Aplicada no banco");
  await expect(linhaIps).toContainText(/faixas de IP/i);

  // Segundo item de menu que virou trava de banco: desde a 0065/0066
  // `perform_checkin` exige `menu.checkin`. Revogar não esconde uma tela — tira
  // a pessoa da roleta. Usar só "Dashboard" como prova de que "os demais valem
  // só na tela" deixava justamente este passar por cosmético.
  const linhaCheckin = page.getByRole("row", { name: /^Check-in/ }).first();
  await expect(linhaCheckin).toContainText("Aplicada no banco");
  await expect(linhaCheckin).toContainText(/roleta|perform_checkin/i);

  // Os demais itens continuam valendo só na tela — o aviso não pode virar ruído.
  await expect(page.getByRole("row", { name: /Dashboard/ }).first()).toContainText("Aplicada na tela");
});

/**
 * E a prova de que o selo de Check-in não é enfeite.
 *
 * `perform_checkin` levanta 42501 antes de qualquer outra checagem quando
 * `has_permission('menu.checkin')` é falso — e o catálogo da 0015 não dá o item
 * a `sdr`. Só que o papel DECLARADO em `E2E_USERS` não é o papel que o banco
 * guarda: o gatilho `handle_new_auth_user` (0002) grava `broker` para toda conta
 * nova ("todo mundo entra como corretor") e `provisionE2EUsers()` apenas
 * ACRESCENTA os papéis da matriz, sem nunca tirar esse. O "SDR" da suíte é, no
 * banco, {sdr, broker} — e `broker` tem `menu.checkin`. Resultado: a RPC passava
 * pela trava de permissão e o teste media a recusa seguinte (P0001 "IP não
 * identificado"), deixando o selo de check-in sem cobertura nenhuma.
 *
 * O papel extra sai só durante este caso e volta no fim — a suíte roda serial
 * (`workers: 1`), então a janela não alcança outro spec. O conserto definitivo é
 * em `provisionE2EUsers()`, que deveria deixar exatamente os papéis declarados.
 *
 * O `client_ip` vai preenchido de propósito (TEST-NET-3, nunca autorizada): se a
 * trava de permissão cair de novo, a chamada não pode ser barrada pela falta de
 * IP e devolver um erro qualquer que passe por recusa de permissão.
 */
test("o menu de Check-in é trava de banco: quem não o tem é recusado pela RPC", async () => {
  const t = resolveTarget();
  const papeisDeclarados: string[] = userFor("sdr").roles;
  const sdrId = await db.profileIdOf("sdr");

  const comCheckin = new Set(
    (await db.select<{ role: string }>(
      "role_permissions?permission=eq.menu.checkin&allowed=is.true&select=role",
    )).map((r) => r.role),
  );
  expect(
    papeisDeclarados.filter((r) => comCheckin.has(r)),
    "cenário inválido: o papel em teste precisa ser um que NÃO tem menu.checkin",
  ).toEqual([]);

  const extras = (await db.select<{ role: string }>(`user_roles?profile_id=eq.${sdrId}&select=role`))
    .filter((r) => !papeisDeclarados.includes(r.role));
  for (const { role } of extras) {
    await db.remove(`user_roles?profile_id=eq.${sdrId}&role=eq.${role}`);
  }

  try {
    const { access_token } = await mintSession(userFor("sdr").email);
    const res = await fetch(`${t.supabaseUrl}/rest/v1/rpc/perform_checkin`, {
      method: "POST",
      headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ client_ip: "203.0.113.7" }),
    });
    const body = await res.text();
    expect(res.status, `esperava 403 do banco, veio ${res.status}: ${body}`).toBe(403);
    expect(body).toContain("42501");
  } finally {
    if (extras.length) {
      await db.insert("user_roles", extras.map(({ role }) => ({ profile_id: sdrId, role })));
    }
  }
});

/**
 * "Aplicada no banco" tem de ser verdade: desligar "Realocar leads" para o
 * gerente faz `reassign_lead` recusar com o JWT dele — não é a tela escondendo
 * botão. A chamada sai daqui (node), com a sessão real do gerente E2E, porque o
 * project `admin` só tem a sessão do admin no navegador.
 */
test.describe("efeito no banco", () => {
  const tag = runTag();
  const GRANT = "role_permissions?role=eq.manager&permission=eq.leads.reassign";
  let leadId = "";

  const grantNoBanco = () => db.select<{ allowed: boolean }>(`${GRANT}&select=allowed`);
  const restaurarGrant = async () => {
    await db.remove(GRANT);
    await db.insert("role_permissions", { role: "manager", permission: "leads.reassign", allowed: true });
  };

  /** `reassign_lead` como o gerente E2E; devolve o status HTTP (403 = 42501 do Postgres). */
  const realocarComoGerente = async (target: string) => {
    const t = resolveTarget();
    const { access_token } = await mintSession(userFor("manager").email);
    const res = await fetch(`${t.supabaseUrl}/rest/v1/rpc/reassign_lead`, {
      method: "POST",
      headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_lead_id: leadId, p_target: target }),
    });
    return { status: res.status, body: await res.text() };
  };

  test.beforeAll(async () => {
    await restaurarGrant();
    const [lead] = await db.insert<{ id: string }>("leads", { full_name: `E2E realocar ${tag}`, phone: "11977770044" });
    leadId = lead.id;
  });

  test.afterAll(async () => {
    // O gerente E2E precisa do grant nos outros specs; e o lead cascateia
    // `lead_assignments` e `lead_events`.
    await restaurarGrant();
    if (leadId) await db.remove(`leads?id=eq.${leadId}`);
  });

  test("desligar 'Realocar leads' do gerente faz o banco recusar a RPC; religar libera", async ({ page }) => {
    const brokerId = await db.profileIdOf("broker"); // Alfa, equipe que o gerente E2E lidera

    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /funcionalidades/i }).click();

    const chave = page.getByRole("switch", { name: /Realocar leads para Gerente/ });
    await expect(chave).toBeChecked();
    await chave.click();
    await expect(chave).not.toBeChecked();
    await expect(async () => {
      expect(await grantNoBanco()).toEqual([{ allowed: false }]);
    }).toPass({ timeout: 10_000 });

    const recusa = await realocarComoGerente(brokerId);
    expect(recusa.status, `esperava 403 do banco, veio ${recusa.status}: ${recusa.body}`).toBe(403);
    expect(recusa.body).toContain("42501");

    await chave.click();
    await expect(chave).toBeChecked();
    await expect(async () => {
      expect(await grantNoBanco()).toEqual([{ allowed: true }]);
    }).toPass({ timeout: 10_000 });

    const aceite = await realocarComoGerente(brokerId);
    expect(aceite.status, `esperava 200 do banco, veio ${aceite.status}: ${aceite.body}`).toBe(200);
    const [lead] = await db.select<{ assigned_to: string | null }>(`leads?id=eq.${leadId}&select=assigned_to`);
    expect(lead.assigned_to, "com o grant de volta, a realocação tem de ter valido").toBe(brokerId);
  });
});

/**
 * Aba "Etapas do Pipeline" — a única das três sem teste de interface.
 *
 * A matriz por etapa era conferida pelo BANCO (`07_core_fixes.sql`) e pelo
 * arraste do corretor (`broker/etapas.spec.ts`), mas nada reprovava se o switch
 * desta aba parasse de gravar. O papel escolhido é "Sócio" pelo mesmo motivo do
 * bloco de cima: nenhum usuário da suíte o tem, e ele começa sem linha nenhuma
 * em `stage_permissions` — ou seja, negado.
 */
test.describe("aba de etapas", () => {
  let etapaId = "";
  let etapaLabel = "";

  const linhaDaEtapa = () =>
    db.select<{ can_enter: boolean; can_exit: boolean }>(
      `stage_permissions?role=eq.partner&stage_id=eq.${etapaId}&select=can_enter,can_exit`,
    );

  test.beforeAll(async () => {
    const [etapa] = await db.select<{ id: string; label: string }>(
      "pipeline_stages?active=eq.true&order=position&limit=1&select=id,label",
    );
    etapaId = etapa.id;
    etapaLabel = etapa.label;
    await db.remove(`stage_permissions?role=eq.partner&stage_id=eq.${etapaId}`);
  });

  test.afterAll(async () => {
    await db.remove(`stage_permissions?role=eq.partner&stage_id=eq.${etapaId}`);
  });

  test("ligar 'Pode entrar' grava a linha e sobrevive ao F5", async ({ page }) => {
    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /etapas/i }).click();
    await page.getByRole("button", { name: "Sócio" }).click();

    const entrar = page.getByRole("switch", { name: `Entrar em ${etapaLabel}` });
    await expect(entrar).not.toBeChecked();
    await entrar.click();
    await expect(entrar).toBeChecked();

    await expect(async () => {
      // Linha ausente = negado; o primeiro clique não pode gravar "sair" junto.
      expect(await linhaDaEtapa()).toEqual([{ can_enter: true, can_exit: false }]);
    }).toPass({ timeout: 10_000 });

    await page.reload();
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /etapas/i }).click();
    await page.getByRole("button", { name: "Sócio" }).click();
    await expect(page.getByRole("switch", { name: `Entrar em ${etapaLabel}` })).toBeChecked();
    // A coluna que faltava: quem mais entra nesta etapa, sem trocar de papel.
    await expect(page.getByRole("row", { name: new RegExp(etapaLabel) }).first()).toContainText("Sócio");
  });
});

/**
 * Segundo código com prova de efeito no banco.
 *
 * Até aqui só `leads.reassign` tinha o teste que importa — o que chama a API com
 * o JWT do papel e cobra a recusa. `settings.integrations` é o outro extremo do
 * risco (é o cofre de credenciais), e a RPC `list_integrations` levanta 42501
 * sozinha quando a permissão falta.
 */
test.describe("efeito no banco · integrações", () => {
  const GRANT = "role_permissions?role=eq.manager&permission=eq.settings.integrations";

  const listarComoGerente = async () => {
    const t = resolveTarget();
    const { access_token } = await mintSession(userFor("manager").email);
    const res = await fetch(`${t.supabaseUrl}/rest/v1/rpc/list_integrations`, {
      method: "POST",
      headers: { apikey: t.anonKey, Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    return { status: res.status, body: await res.text() };
  };

  test.beforeAll(() => db.remove(GRANT));
  test.afterAll(() => db.remove(GRANT));

  test("conceder 'Gerenciar integrações' ao gerente abre o cofre; revogar fecha", async ({ page }) => {
    // O negativo primeiro: sem a linha, a RPC recusa.
    const antes = await listarComoGerente();
    expect(antes.status, `esperava 403 do banco, veio ${antes.status}: ${antes.body}`).toBe(403);
    expect(antes.body).toContain("42501");

    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /funcionalidades/i }).click();

    const chave = page.getByRole("switch", { name: /Gerenciar integrações para Gerente/ });
    await expect(chave).not.toBeChecked();
    await chave.click();
    await expect(chave).toBeChecked();
    await expect(async () => {
      expect(await db.select<{ allowed: boolean }>(`${GRANT}&select=allowed`)).toEqual([{ allowed: true }]);
    }).toPass({ timeout: 10_000 });

    const depois = await listarComoGerente();
    expect(depois.status, `esperava 200 do banco, veio ${depois.status}: ${depois.body}`).toBe(200);

    await chave.click();
    await expect(chave).not.toBeChecked();
    await expect(async () => {
      expect(await db.select<{ allowed: boolean }>(`${GRANT}&select=allowed`)).toEqual([{ allowed: false }]);
    }).toPass({ timeout: 10_000 });

    const revogado = await listarComoGerente();
    expect(revogado.status, "revogar tem de fechar o cofre de novo").toBe(403);
  });
});

/**
 * Switch sem leitor tem de aparecer como sem leitor.
 *
 * Três códigos do catálogo (`deals.view_all`, `users.manage_roles`,
 * `game.close_season`) nunca tiveram quem os lesse: as decisões são por papel,
 * no código. Não dá para apagá-los — `supabase/seed.sql` os reinsere depois de
 * todas as migrations — então a promessa que a tela pode cumprir é o RÓTULO:
 * "Ainda sem efeito" exatamente nesses três, "Aplicada no banco" nos outros.
 *
 * As asserções são escopadas à TABELA porque a legenda da própria aba contém as
 * duas frases como texto exato: medir na página inteira reprovaria sempre num
 * caso e passaria sem provar nada no outro.
 */
test("o selo de cada switch diz a verdade sobre quem lê o código", async ({ page }) => {
  await page.goto("/admin/permissions");
  await aguardarCarregamento(page);
  await page.getByRole("tab", { name: /funcionalidades/i }).click();

  const tabelas = page.getByRole("table");
  await expect(tabelas.first()).toBeVisible();

  // Quantos dos três ainda existem no catálogo deste alvo — assim o teste
  // continua valendo no dia em que o seed parar de reinseri-los e uma migration
  // posterior os apagar: aí a conta esperada vira zero sozinha.
  const semLeitor = await db.select<{ code: string; label: string }>(
    "permissions?code=in.(deals.view_all,users.manage_roles,game.close_season)&select=code,label",
  );
  await expect(
    tabelas.getByText("Ainda sem efeito", { exact: true }),
    "só código sem leitor pode aparecer inerte na tabela",
  ).toHaveCount(semLeitor.length);

  for (const { label } of semLeitor) {
    const linha = page.getByRole("row").filter({ hasText: label });
    await expect(
      linha.getByText("Ainda sem efeito", { exact: true }),
      `${label} não tem leitor — o selo não pode prometer efeito`,
    ).toHaveCount(1);
    // E não há o que clicar. O rótulo honesto reduzia o dano; o switch continuava
    // gravando linha em `role_permissions` e o admin saía acreditando ter negado
    // algo. Sem controle, sobra a frase de quem decide de verdade.
    await expect(
      linha.getByRole("switch"),
      `${label} não pode oferecer switch: gravar não muda nada`,
    ).toHaveCount(0);
    await expect(linha).toContainText(/não há o que controlar/i);
  }

  // E o inverso: um switch com leitor de verdade não pode ser rotulado inerte.
  await expect(
    page.getByRole("row").filter({ hasText: "Gerenciar equipes" }).getByText("Aplicada no banco", { exact: true }),
    "teams.manage é predicado de team_members_manage desde a 0044",
  ).toHaveCount(1);
});

/**
 * Terceiro código com prova de efeito no BANCO — e o primeiro do domínio de
 * equipes.
 *
 * `teams.manage` é o único código de funcionalidade que a tela também lê (ele
 * decide o botão "Vincular em massa"), e é predicado de `team_members_manage`
 * desde a 0044. Até aqui o selo "Aplicada no banco" dele era conferido pelo
 * vitest contra o fonte da migration, não contra a recusa medida: ninguém
 * tinha chamado a API com o JWT do gerente para ver o 403 aparecer e sumir.
 *
 * O corretor é criado só para este caso: mexer em quem já está numa equipe
 * quebraria os specs de isolamento que rodam no mesmo banco.
 */
test.describe("efeito no banco · gerenciar equipes", () => {
  const tagEquipe = runTag();
  const EMAIL = `e2e.permteam.${tagEquipe}@faceimob.test`;
  const GRANT = "role_permissions?role=eq.manager&permission=eq.teams.manage";
  let corId = "";
  let equipeId = "";

  const authAdmin = (path: string, init: RequestInit = {}) => {
    const t = resolveTarget();
    return fetch(`${t.supabaseUrl}/auth/v1/admin/${path}`, {
      ...init,
      headers: {
        apikey: t.serviceRoleKey,
        Authorization: `Bearer ${t.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  };

  /** Insere a filiação com o JWT do GERENTE — quem barra é a policy, não a tela. */
  const vincularComoGerente = async () => {
    const t = resolveTarget();
    const { access_token } = await mintSession(userFor("manager").email);
    const res = await fetch(`${t.supabaseUrl}/rest/v1/team_members`, {
      method: "POST",
      headers: {
        apikey: t.anonKey,
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ team_id: equipeId, profile_id: corId }),
    });
    return { status: res.status, body: await res.text() };
  };

  const restaurarGrant = async () => {
    await db.remove(GRANT);
    await db.insert("role_permissions", { role: "manager", permission: "teams.manage", allowed: true });
  };

  test.beforeAll(async () => {
    await restaurarGrant();
    const res = await authAdmin("users", {
      method: "POST",
      body: JSON.stringify({
        email: EMAIL,
        email_confirm: true,
        user_metadata: { full_name: `E2E PermTeam ${tagEquipe}`, e2e: true },
      }),
    });
    const corpo = await res.json();
    if (!res.ok || !corpo.id) throw new Error(`não consegui criar ${EMAIL}: ${res.status}`);
    corId = corpo.id as string;
    const gerenteId = await db.profileIdOf("manager");
    const equipes = await db.select<{ id: string }>(
      `teams?manager_id=eq.${gerenteId}&active=is.true&select=id&order=created_at&limit=1`,
    );
    if (!equipes.length) throw new Error("cenário inválido: o gerente E2E precisa de uma equipe ativa");
    equipeId = equipes[0].id;
  });

  test.afterAll(async () => {
    // O grant volta: outros specs contam com o gerente podendo gerenciar equipe.
    await restaurarGrant();
    if (corId) await db.remove(`team_members?profile_id=eq.${corId}`);
    const busca = await authAdmin(`users?filter=${encodeURIComponent(EMAIL)}`);
    const corpo = (await busca.json()) as { users?: { id: string; email?: string }[] };
    const conta = (corpo.users ?? []).find((u) => u.email === EMAIL);
    if (conta) await authAdmin(`users/${conta.id}`, { method: "DELETE" });
  });

  test("desligar 'Gerenciar equipes' faz o banco recusar a filiação; religar libera", async ({ page }) => {
    await page.goto("/admin/permissions");
    await aguardarCarregamento(page);
    await page.getByRole("tab", { name: /funcionalidades/i }).click();

    const chave = page.getByRole("switch", { name: /Gerenciar equipes para Gerente/ });
    await expect(chave).toBeChecked();
    await chave.click();
    await expect(chave).not.toBeChecked();
    await expect(async () => {
      expect(await db.select<{ allowed: boolean }>(`${GRANT}&select=allowed`)).toEqual([{ allowed: false }]);
    }).toPass({ timeout: 10_000 });

    const recusa = await vincularComoGerente();
    expect(recusa.status, `esperava 403 do banco, veio ${recusa.status}: ${recusa.body}`).toBe(403);

    await chave.click();
    await expect(chave).toBeChecked();
    await expect(async () => {
      expect(await db.select<{ allowed: boolean }>(`${GRANT}&select=allowed`)).toEqual([{ allowed: true }]);
    }).toPass({ timeout: 10_000 });

    const aceite = await vincularComoGerente();
    expect(aceite.status, `esperava 201 do banco, veio ${aceite.status}: ${aceite.body}`).toBe(201);
    const linhas = await db.select<{ team_id: string }>(
      `team_members?profile_id=eq.${corId}&left_at=is.null&select=team_id`,
    );
    expect(linhas.map((l) => l.team_id), "com o grant de volta a filiação tem de valer").toEqual([equipeId]);
  });
});
