import { describe, expect, it } from "vitest";
import {
  checkpointManagers, checkpointTeams, managerFocus,
  readsEveryReport, showsEveryTeam, teamsNoQuadro,
} from "./visibility";

/**
 * O recorte do Checkpoint por equipe, não por papel primário.
 *
 * Cada caso aqui é um usuário que a versão anterior (baseada em `role`, o papel
 * de maior precedência) mostrava errado — papel é N:N desde a 0002.
 */

const EU = "perfil-1";
const OUTRO = "perfil-2";

const equipe = (id: string, manager: string | null, director: string | null) =>
  ({ id, manager_id: manager, director_id: director });

const ALFA = equipe("alfa", EU, OUTRO);       // eu gerencio, outro dirige
const BETA = equipe("beta", OUTRO, EU);       // eu dirijo
const GAMA = equipe("gama", OUTRO, OUTRO);    // nem uma coisa nem outra
const DELTA = equipe("delta", EU, EU);        // eu dirijo E gerencio
const TODAS = [ALFA, BETA, GAMA, DELTA];

describe("checkpointTeams", () => {
  it("admin lê todas as equipes, como can_read_all() no banco", () => {
    const escopo = checkpointTeams(TODAS, ["admin"], EU);
    expect(escopo.directed).toEqual(TODAS);
    expect(escopo.managed).toEqual([]);
    expect(escopo.visible).toHaveLength(4);
  });

  it("sócio que também é gerente continua vendo tudo", () => {
    // O defeito: `primaryRole` devolvia "manager" e a tela recortava para a
    // equipe dele, escondendo o resto que `can_read_all()` já lhe entrega.
    const escopo = checkpointTeams(TODAS, ["manager", "partner"], EU);
    expect(escopo.visible).toHaveLength(4);
    expect(showsEveryTeam(["manager", "partner"])).toBe(true);
  });

  it("gerente vê o que gerencia, como card de equipe", () => {
    const escopo = checkpointTeams([ALFA, GAMA], ["manager"], EU);
    expect(escopo.managed.map(t => t.id)).toEqual(["alfa"]);
    expect(escopo.directed).toEqual([]);
    expect(escopo.visible.map(t => t.id)).toEqual(["alfa"]);
  });

  it("o recorte é por liderança da equipe, não pelo papel do usuário", () => {
    // É a mesma regra de `auth_led_team_ids()`: quem está em `teams.director_id`
    // lê aqueles diários no banco, tenha ou não o papel 'director' em
    // `user_roles`. Recortar de novo por papel na tela escondia número que o
    // banco entrega.
    const escopo = checkpointTeams(TODAS, ["broker"], EU);
    expect(escopo.directed.map(t => t.id)).toEqual(["beta", "delta"]);
    expect(escopo.managed.map(t => t.id)).toEqual(["alfa"]);
  });

  it("diretor que também gerencia não perde a equipe que gerencia", () => {
    // O defeito: caía em `role === "director"` e só as equipes com
    // `director_id = ele` apareciam — a Alfa sumia, embora
    // `auth_led_team_ids()` a libere para ele no banco.
    const escopo = checkpointTeams(TODAS, ["director", "manager"], EU);
    expect(escopo.directed.map(t => t.id)).toEqual(["beta", "delta"]);
    expect(escopo.managed.map(t => t.id)).toEqual(["alfa"]);
    expect(escopo.visible.map(t => t.id)).toEqual(["beta", "delta", "alfa"]);
  });

  it("quem dirige e gerencia a mesma equipe a vê uma vez só", () => {
    const escopo = checkpointTeams([DELTA], ["director", "manager"], EU);
    expect(escopo.directed.map(t => t.id)).toEqual(["delta"]);
    expect(escopo.managed).toEqual([]);
    expect(escopo.visible).toHaveLength(1);
  });

  it("quem não lidera equipe nenhuma não vê nada", () => {
    expect(checkpointTeams([GAMA], ["broker"], EU).visible).toEqual([]);
    expect(checkpointTeams([GAMA], ["director"], EU).visible).toEqual([]);
  });

  it("sem perfil carregado, nada é mostrado — falha fechada", () => {
    expect(checkpointTeams(TODAS, ["director"], null).visible).toEqual([]);
    // Admin não depende do perfil: a leitura dele é irrestrita no banco.
    expect(checkpointTeams(TODAS, ["admin"], null).visible).toHaveLength(4);
  });
});

/**
 * Papel × equipe desativada: quem entra no quadro e quem vira aviso.
 *
 * Foi aqui que a tela deu diagnóstico falso: ela dizia ao ADMIN que "o banco
 * libera o diário apenas de equipe ativa para quem a lidera" e mandava ele
 * "pedir o número a um administrador" — sendo que o primeiro ramo de
 * `daily_reports_select` entrega o diário inteiro a ele. A causa real era
 * outra: ninguém lançou nada naquela semana. Esse ramo é admin e sócio desde a
 * 0109; o diretor entrou na regra do gerente.
 */
describe("teamsNoQuadro", () => {
  const ativa = { id: "ativa", active: true };
  const morta = { id: "morta", active: false };
  const TIME = [ativa, morta];
  const SEM_NADA = new Set<string>();
  const COM_MORTA = new Set(["morta"]);

  it("leitura irrestrita do diário é admin e sócio — o diretor saiu na 0109", () => {
    // A 0109 estreitou `daily_reports_select` de `can_read_all()` (admin,
    // diretor e sócio) para `has_any_role('admin','partner')`: o diretor passou
    // a entrar pelas equipes que lidera, como o gerente. Enquanto esta função
    // dizia `true` para ele, a tela explicava um recorte que o banco faz.
    expect(readsEveryReport(["admin"])).toBe(true);
    expect(readsEveryReport(["director"])).toBe(false);
    expect(readsEveryReport(["partner"])).toBe(true);
    expect(readsEveryReport(["manager"])).toBe(false);
    expect(readsEveryReport(["broker"])).toBe(false);
    expect(showsEveryTeam(["director"])).toBe(false);
    expect(showsEveryTeam(["admin"])).toBe(true);
    expect(showsEveryTeam(["partner"])).toBe(true);
  });

  it("equipe ativa sempre entra no quadro, para qualquer papel", () => {
    for (const papeis of [["admin"], ["partner"], ["director"], ["manager"]] as const) {
      const r = teamsNoQuadro(TIME, [...papeis], SEM_NADA);
      expect(r.quadro.map(t => t.id)).toContain("ativa");
    }
  });

  it("desativada COM lançamento entra no quadro — o banco já entregou o número", () => {
    // Vale inclusive para o gerente: o terceiro ramo de `daily_reports_select`
    // casa por `team_members` e não exige `teams.active`. Se o diário chegou,
    // escondê-lo tira total da semana sem explicação.
    for (const papeis of [["admin"], ["partner"], ["director"], ["manager"]] as const) {
      const r = teamsNoQuadro(TIME, [...papeis], COM_MORTA);
      expect(r.quadro.map(t => t.id), `papel ${papeis[0]}`).toEqual(["ativa", "morta"]);
      expect(r.foraPorRecorte, `papel ${papeis[0]}`).toEqual([]);
    }
  });

  it("desativada SEM lançamento não vira aviso para quem lê tudo", () => {
    // O defeito de origem: o admin abria qualquer semana em que a equipe
    // arquivada não lançou nada e lia um aviso de permissão sobre si mesmo.
    // O diretor saiu daqui na 0109 — para ele o banco RECORTA mesmo, porque
    // `auth_led_team_ids()` exige `teams.active`; o caso dele está abaixo.
    for (const papeis of [["admin"], ["partner"]] as const) {
      const r = teamsNoQuadro(TIME, [...papeis], SEM_NADA);
      expect(r.foraPorRecorte, `papel ${papeis[0]}`).toEqual([]);
      expect(r.quadro.map(t => t.id), `papel ${papeis[0]}`).toEqual(["ativa"]);
    }
  });

  it("desativada SEM lançamento vira aviso para gerente e diretor — aí o banco recortou", () => {
    // `auth_led_team_ids()` exige `teams.active`, então o diário da equipe
    // desativada pode existir e não ter vindo. Desde a 0109 vale para o diretor
    // pelo mesmo motivo que já valia para o gerente.
    for (const papeis of [["manager"], ["director"], ["manager", "director"]] as const) {
      const r = teamsNoQuadro(TIME, [...papeis], SEM_NADA);
      expect(r.quadro.map(t => t.id), `papel ${papeis.join("+")}`).toEqual(["ativa"]);
      expect(r.foraPorRecorte.map(t => t.id), `papel ${papeis.join("+")}`).toEqual(["morta"]);
    }
  });

  it("sócio que também gerencia continua lendo tudo — papel é N:N", () => {
    // A policy é `has_any_role`: basta um dos papéis casar.
    const r = teamsNoQuadro(TIME, ["manager", "partner"], SEM_NADA);
    expect(r.foraPorRecorte).toEqual([]);
  });
});

/**
 * Hierarquia do checkpoint (cliente, 10/09/2026): o diretor vê o dele e o dos
 * gerentes dele, e ENTRA no checkpoint de um gerente. O caso que interessa aqui
 * é o de baixo: o gerente que edita `?gerente=` na URL para o id de um colega.
 */
describe("checkpointManagers / managerFocus", () => {
  it("o diretor lista os gerentes das equipes que dirige, sem ele mesmo", () => {
    const escopo = checkpointTeams(TODAS, ["director"], EU);
    // Dirige BETA (gerente OUTRO) e DELTA (gerente EU).
    expect(checkpointManagers(escopo.visible, EU).map((g) => g.id)).toEqual([OUTRO]);
  });

  it("gerente não tem ninguém abaixo — a lista fica vazia e o seletor some", () => {
    const escopo = checkpointTeams([ALFA, GAMA], ["manager"], EU);
    expect(checkpointManagers(escopo.visible, EU)).toEqual([]);
  });

  it("admin alcança todos os gerentes, com as equipes de cada um", () => {
    const escopo = checkpointTeams(TODAS, ["admin"], null);
    const lista = checkpointManagers(escopo.visible, null);
    expect(lista.map((g) => g.id).sort()).toEqual([EU, OUTRO]);
    expect(lista.find((g) => g.id === OUTRO)?.teams.map((t) => t.id)).toEqual(["beta", "gama"]);
  });

  it("entrar no gerente devolve as equipes dele como card, sem funil de diretoria", () => {
    const escopo = checkpointTeams(TODAS, ["director"], EU);
    const foco = managerFocus(escopo.visible, OUTRO);
    expect(foco?.managed.map((t) => t.id)).toEqual(["beta"]);
    expect(foco?.directed).toEqual([]);
    expect(foco?.visible.map((t) => t.id)).toEqual(["beta"]);
  });

  it("gerente que troca o id na URL não entra no quadro de outro — falha fechada", () => {
    // GAMA é de OUTRO e não está no recorte de EU: o parâmetro é recusado aqui
    // e, mesmo se não fosse, `daily_reports_select` não entrega o diário dela.
    const escopo = checkpointTeams([ALFA, GAMA], ["manager"], EU);
    expect(managerFocus(escopo.visible, OUTRO)).toBeNull();
  });

  it("diretor não entra em gerente de outra diretoria", () => {
    // Equipe real, gerente real — só que sob OUTRO. O diretor EU não a dirige,
    // então o gerente dela não é porta para o quadro dela.
    const deOutraDiretoria = equipe("epsilon", "perfil-3", OUTRO);
    const escopo = checkpointTeams([...TODAS, deOutraDiretoria], ["director"], EU);
    expect(checkpointManagers(escopo.visible, EU).map((g) => g.id)).toEqual([OUTRO]);
    expect(managerFocus(escopo.visible, "perfil-3")).toBeNull();
  });
});
