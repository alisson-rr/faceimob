import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("./client", () => ({ supabase: { from, rpc } }));

import {
  authErrorMessage,
  createTeamForManager,
  deactivateTeam,
  getPersonDetails,
  leadsProfile,
  savePerson,
  setDirectorOfManagedTeams,
  setTeamByManager,
  updateProfile,
  type ProfileFields,
} from "./people";

type Resultado = { data: unknown; error: { code?: string; message?: string } | null };

type Registro = { tabela: string; metodo: string; argumentos: unknown[] };

/**
 * Builder mínimo do PostgREST — o mesmo desenho de `game.test.ts`.
 *
 * Cada método devolve a própria cadeia; a cadeia é "thenable", então tanto
 * `await from(...).insert(...)` quanto `await from(...).update(...).eq(...)
 * .select(...)` resolvem no resultado combinado. Isso importa: o defeito que
 * este arquivo cobre é justamente `update` SEM `.select()`, que volta 204 sem
 * erro — se alguém remover o `.select`, `chamadas` deixa de registrá-lo e o
 * teste reprova.
 */
function cadeia(tabela: string, resultado: Resultado, chamadas: Registro[]) {
  const registrar = (metodo: string) => (...argumentos: unknown[]) => {
    chamadas.push({ tabela, metodo, argumentos });
    return alvo;
  };
  const alvo = {
    select: registrar("select"),
    update: registrar("update"),
    insert: registrar("insert"),
    eq: registrar("eq"),
    is: registrar("is"),
    in: registrar("in"),
    order: registrar("order"),
    single: (...argumentos: unknown[]) => {
      chamadas.push({ tabela, metodo: "single", argumentos });
      return Promise.resolve(resultado);
    },
    maybeSingle: (...argumentos: unknown[]) => {
      chamadas.push({ tabela, metodo: "maybeSingle", argumentos });
      return Promise.resolve(resultado);
    },
    then: (ok: (v: Resultado) => unknown, falha?: (e: unknown) => unknown) =>
      Promise.resolve(resultado).then(ok, falha),
  };
  return alvo;
}

/** Resultados por tabela, consumidos na ordem em que a tabela é acessada. */
function prepararTabelas(fila: Record<string, Resultado[]>) {
  const chamadas: Registro[] = [];
  const restante: Record<string, Resultado[]> = Object.fromEntries(
    Object.entries(fila).map(([t, r]) => [t, [...r]]),
  );
  from.mockImplementation((tabela: string) => {
    const proximo = restante[tabela]?.shift();
    if (!proximo) throw new Error(`teste sem resultado preparado para "${tabela}"`);
    return cadeia(tabela, proximo, chamadas);
  });
  return chamadas;
}

const ok = (data: unknown = [{ id: "x" }]): Resultado => ({ data, error: null });
const vazio: Resultado = { data: [], error: null };

const PERFIL: ProfileFields = {
  full_name: "Maria Souza", email: "maria@faceimob.com.br", phone: null, avatar_url: null,
  cpf: null, creci: null, habilitation: null, birth_date: null, hired_at: null,
  address: null, division: null, indication: null,
  badge_requested_at: null, badge_delivered_at: null, bypass_ip_check: false,
};

beforeEach(() => { from.mockReset(); rpc.mockReset(); });

describe("updateProfile", () => {
  it("pede a linha de volta e trata 0 linhas como recusa, não como sucesso", async () => {
    const chamadas = prepararTabelas({ profiles: [vazio] });

    await expect(updateProfile("p1", PERFIL)).rejects.toThrow(/profiles/);
    expect(chamadas.some((c) => c.metodo === "select"), "update sem .select() volta 204 sem erro")
      .toBe(true);
  });

  it("linha devolvida é sucesso", async () => {
    prepararTabelas({ profiles: [ok()] });
    await expect(updateProfile("p1", PERFIL)).resolves.toBeUndefined();
  });
});

describe("savePerson", () => {
  it("grava na ordem perfil → papéis → equipe e diz o que já passou quando falha no meio", async () => {
    prepararTabelas({ profiles: [ok()] });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });

    const erro = await savePerson({ id: "p1", profile: PERFIL, roles: ["broker"] }).catch((e) => e);

    expect(erro).toBeInstanceOf(Error);
    expect(erro.name).toBe("SavePersonError");
    expect(erro.etapa).toBe("funções");
    // O que a tela precisa dizer: metade da ficha ficou gravada.
    expect(erro.gravadas).toEqual(["dados do perfil"]);
    expect(erro.message).toMatch(/Já foi gravado: dados do perfil/);
  });

  it("não mexe em papel, equipe nem diretor quando a tela não mandou esses campos", async () => {
    const chamadas = prepararTabelas({ profiles: [ok()] });

    await savePerson({ id: "p1", profile: PERFIL });

    expect(rpc).not.toHaveBeenCalled();
    expect(chamadas.every((c) => c.tabela === "profiles")).toBe(true);
  });
});

describe("getPersonDetails", () => {
  it("traz telefone, foto e status do BANCO — a ficha não pode gravar o que não leu", async () => {
    // O caminho de recuperação do e-mail duplicado abre a ficha só com id, nome
    // e e-mail. Sem estes campos, o primeiro Salvar mandava `phone: null` e
    // `avatar_url: null` por cima de quem já existia, e o Switch "Ativo" abria
    // ligado para quem estava suspenso — sem caminho de reativação.
    prepararTabelas({
      profiles: [ok({
        cpf: null, full_name: "Maria Souza", email: "maria@faceimob.com.br",
        phone: "11999998888", avatar_url: "https://exemplo/foto.png", status: "suspended",
      })],
      user_roles: [ok([{ role: "broker" }])],
      team_members: [ok({ team: { manager_id: "ger1", director_id: "dir1" } })],
    });

    const { identity } = await getPersonDetails("p1");

    expect(identity.phone, "ficha aberta sem phone não pode mandar phone: null").toBe("11999998888");
    expect(identity.avatar_url).toBe("https://exemplo/foto.png");
    expect(identity.active, "'ativo' chutado é o que travava a reativação").toBe(false);
    expect(identity.manager_id).toBe("ger1");
    expect(identity.director_id).toBe("dir1");
  });

  it("sem filiação aberta, gerente e diretor são nulos — não herdam o palpite da lista", async () => {
    prepararTabelas({
      profiles: [ok({ full_name: "Sem Equipe", email: "s@f.com", phone: null, avatar_url: null, status: "active" })],
      user_roles: [ok([])],
      team_members: [ok(null)],
    });

    const { identity } = await getPersonDetails("p2");

    expect(identity.manager_id).toBeNull();
    expect(identity.director_id).toBeNull();
    expect(identity.active).toBe(true);
  });
});

describe("activeTeamIdOfManager", () => {
  it("duas equipes ativas viram instrução, não PGRST116 — o schema permite as duas", async () => {
    // `teams` só tem índice NÃO único por `manager_id` (0002:127) e o cenário de
    // E2E cria alfa e beta com o mesmo gerente: `maybeSingle()` transformava um
    // caso legítimo em "Não foi possível carregar a equipe do gerente".
    const chamadas = prepararTabelas({
      teams: [ok([{ id: "t1", name: "Alfa" }, { id: "t2", name: "Beta" }])],
    });

    await expect(setTeamByManager("p1", "ger1")).rejects.toThrow(/2 equipes ativas \(Alfa, Beta\)/);
    expect(
      chamadas.some((c) => c.tabela === "team_members"),
      "nada pode ser fechado antes de saber em qual equipe a pessoa entra",
    ).toBe(false);
  });
});

describe("setTeamByManager", () => {
  it("reabre a filiação anterior quando a nova equipe é recusada", async () => {
    const chamadas = prepararTabelas({
      // Lista, não `maybeSingle`: a equipe ativa é resolvida por
      // `activeTeamIdOfManager`, que trata "nenhuma" e "mais de uma".
      teams: [ok([{ id: "t1", name: "Alfa" }])],
      team_members: [
        ok([{ id: "m1" }, { id: "m2" }]),              // fecha as abertas
        { data: null, error: { code: "42501", message: "denied" } }, // insert recusado
        ok(),                                           // reabertura
      ],
    });

    await expect(setTeamByManager("p1", "ger1")).rejects.toThrow(/team_members/);

    const reabertura = chamadas.find(
      (c) => c.metodo === "update" && JSON.stringify(c.argumentos[0]) === JSON.stringify({ left_at: null }),
    );
    expect(reabertura, "sem reabrir, a pessoa fica sem equipe nenhuma").toBeTruthy();
    expect(chamadas.some((c) => c.metodo === "in" && JSON.stringify(c.argumentos[1]) === '["m1","m2"]')).toBe(true);
  });

  it("gerente sem equipe ativa é recusado antes de fechar qualquer filiação", async () => {
    const chamadas = prepararTabelas({ teams: [ok(null)] });

    await expect(setTeamByManager("p1", "ger1")).rejects.toThrow(/não possui uma equipe ativa/);
    expect(chamadas.some((c) => c.tabela === "team_members")).toBe(false);
  });
});

describe("setDirectorOfManagedTeams", () => {
  it("só alcança equipe ATIVA — a inativa contava como sucesso", async () => {
    const chamadas = prepararTabelas({ teams: [ok()] });

    await setDirectorOfManagedTeams("ger1", "dir1");

    const filtros = chamadas.filter((c) => c.metodo === "eq").map((c) => c.argumentos);
    expect(filtros).toContainEqual(["manager_id", "ger1"]);
    expect(filtros).toContainEqual(["active", true]);
  });

  it("nenhuma equipe casada vira mensagem de regra, não toast verde", async () => {
    prepararTabelas({ teams: [vazio] });
    await expect(setDirectorOfManagedTeams("ger1", "dir1")).rejects.toThrow(/ainda não tem equipe ativa/);
  });
});

describe("createTeamForManager", () => {
  it("cria a equipe E inclui o gerente como membro — senão o diretor não o enxerga", async () => {
    const chamadas = prepararTabelas({
      teams: [ok({ id: "t9" })],
      team_members: [ok()],
    });

    const id = await createTeamForManager("ger1", "Equipe Nova", "equipe-nova", "dir1");

    expect(id).toBe("t9");
    const insercoes = chamadas.filter((c) => c.metodo === "insert").map((c) => c.argumentos[0]);
    expect(insercoes[0]).toEqual({ manager_id: "ger1", name: "Equipe Nova", slug: "equipe-nova", director_id: "dir1" });
    expect(insercoes[1], "equipe sem o gerente em team_members o esconde do diretor")
      .toEqual({ team_id: "t9", profile_id: "ger1" });
  });

  it("filiação recusada sobe como erro, não em silêncio", async () => {
    prepararTabelas({
      teams: [ok({ id: "t9" })],
      team_members: [{ data: null, error: { code: "23505", message: "duplicate" } }],
    });

    await expect(createTeamForManager("ger1", "Equipe Nova", "equipe-nova", null))
      .rejects.toThrow(/team_members/);
  });
});

/**
 * Desativar equipe mexe em DUAS tabelas sem transação, e a segunda tira o
 * direito sobre a primeira: `team_members_manage` exige
 * `team_id in auth_led_team_ids()`, e `auth_led_team_ids()` só devolve equipe
 * ATIVA. Por isso os vínculos são fechados ANTES — e por isso cada etapa tem de
 * conferir a linha devolvida em vez de confiar no 204.
 */
describe("deactivateTeam", () => {
  it("fecha os vínculos ANTES de desativar — inverter a ordem tiraria o direito de fechá-los", async () => {
    const chamadas = prepararTabelas({
      team_members: [ok([{ id: "m1" }, { id: "m2" }]), ok([{ id: "m1" }, { id: "m2" }])],
      teams: [ok([{ id: "t1" }])],
    });

    await expect(deactivateTeam("t1")).resolves.toBe(2);

    const ordem = chamadas.filter((c) => c.metodo === "update").map((c) => c.tabela);
    expect(ordem, "desativar antes revoga a própria permissão de fechar vínculo")
      .toEqual(["team_members", "teams"]);
    expect(
      chamadas.some((c) => c.tabela === "teams" && c.metodo === "select"),
      "update sem .select() volta 204 sem erro e o toast verde mentiria",
    ).toBe(true);
  });

  it("fechamento recusado pela RLS não desativa a equipe e reabre o que fechou", async () => {
    // Diretor com `teams.manage` revogado: o update casa 0 linhas e volta 204
    // SEM erro. Antes, `teams` era desativada logo depois (só exige diretor da
    // equipe) e os integrantes ficavam presos numa equipe inativa — sem gerente
    // e sem caminho de volta, que é o estado que esta função existe para evitar.
    const chamadas = prepararTabelas({
      team_members: [
        ok([{ id: "m1" }, { id: "m2" }]), // dois abertos
        vazio,                             // fechamento recusado pela RLS
      ],
    });

    await expect(deactivateTeam("t1")).rejects.toThrow(/Só 0 de 2 vínculo\(s\)/);
    expect(chamadas.some((c) => c.tabela === "teams"), "nada pode ser desativado com membro preso")
      .toBe(false);
  });

  it("equipe recusada depois do fechamento reabre os vínculos e diz que reabriu", async () => {
    const chamadas = prepararTabelas({
      team_members: [
        ok([{ id: "m1" }]),
        ok([{ id: "m1" }]),
        ok([{ id: "m1" }]), // reabertura
      ],
      teams: [vazio],
    });

    await expect(deactivateTeam("t1")).rejects.toThrow(/vínculos encerrados foram restaurados/);
    const reabertura = chamadas.find(
      (c) => c.metodo === "update" && JSON.stringify(c.argumentos[0]) === JSON.stringify({ left_at: null }),
    );
    expect(reabertura, "sem reabrir, todo mundo fica desvinculado de uma equipe que continua ativa")
      .toBeTruthy();
  });
});

/**
 * `leadsProfile` é o espelho de `manages_profile()` na tela. O ramo do DIRETOR
 * faltava: `auth_led_team_ids()` casa `manager_id` OU `director_id`, então o
 * diretor É gestor direto de quem está numa equipe que ele dirige — e a ficha
 * travava o Switch "Ativo" dele afirmando o contrário.
 */
describe("leadsProfile", () => {
  const alvo = { id: "cor1", manager_id: "ger1", director_id: "dir1" };

  it("gerente da equipe do alvo administra o alvo", () => {
    expect(leadsProfile("ger1", ["manager"], alvo)).toBe(true);
  });

  it("diretor da equipe do alvo também — era o ramo que a tela não tinha", () => {
    expect(leadsProfile("dir1", ["director"], alvo)).toBe(true);
  });

  it("quem não lidera a equipe do alvo não administra ninguém", () => {
    expect(leadsProfile("ger2", ["manager"], alvo)).toBe(false);
    expect(leadsProfile("dir2", ["director"], alvo)).toBe(false);
    // Papel sem o vínculo, e vínculo sem o papel: os dois têm de bater.
    expect(leadsProfile("dir1", ["broker"], alvo)).toBe(false);
    expect(leadsProfile("ger1", ["director"], alvo)).toBe(false);
  });

  it("ninguém administra a própria ficha nem sem perfil vinculado", () => {
    expect(leadsProfile("ger1", ["manager"], { id: "ger1", manager_id: "ger1" })).toBe(false);
    expect(leadsProfile(null, ["director"], alvo)).toBe(false);
  });
});

describe("authErrorMessage", () => {
  it("traduz a recusa mais comum do GoTrue", () => {
    expect(authErrorMessage("A user with this email address has already been registered"))
      .toBe("Já existe um acesso com esse e-mail.");
    expect(authErrorMessage("email_exists")).toBe("Já existe um acesso com esse e-mail.");
  });

  it("mensagem desconhecida passa como está — inventar tradução esconde o motivo", () => {
    expect(authErrorMessage("Falha na função (500)")).toBe("Falha na função (500)");
  });
});
