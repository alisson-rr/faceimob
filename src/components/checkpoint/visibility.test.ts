import { describe, expect, it } from "vitest";
import { checkpointTeams, readsEveryReport, showsEveryTeam, teamsNoQuadro } from "./visibility";

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
 * "pedir o número a um administrador" — sendo que `can_read_all()` (admin,
 * DIRETOR e sócio) entrega o diário inteiro a ele. A causa real era outra:
 * ninguém lançou nada naquela semana.
 */
describe("teamsNoQuadro", () => {
  const ativa = { id: "ativa", active: true };
  const morta = { id: "morta", active: false };
  const TIME = [ativa, morta];
  const SEM_NADA = new Set<string>();
  const COM_MORTA = new Set(["morta"]);

  it("os papéis de leitura irrestrita são os de can_read_all(): admin, diretor e sócio", () => {
    expect(readsEveryReport(["admin"])).toBe(true);
    expect(readsEveryReport(["director"])).toBe(true);
    expect(readsEveryReport(["partner"])).toBe(true);
    expect(readsEveryReport(["manager"])).toBe(false);
    expect(readsEveryReport(["broker"])).toBe(false);
    // O quadro, porém, é mais estreito de propósito: o diretor vê as equipes
    // que lidera, não a empresa inteira somada no funil dele.
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
    for (const papeis of [["admin"], ["partner"], ["director"]] as const) {
      const r = teamsNoQuadro(TIME, [...papeis], SEM_NADA);
      expect(r.foraPorRecorte, `papel ${papeis[0]}`).toEqual([]);
      expect(r.quadro.map(t => t.id), `papel ${papeis[0]}`).toEqual(["ativa"]);
    }
  });

  it("desativada SEM lançamento vira aviso para gerente — aí o banco pode ter recortado", () => {
    const r = teamsNoQuadro(TIME, ["manager"], SEM_NADA);
    expect(r.quadro.map(t => t.id)).toEqual(["ativa"]);
    expect(r.foraPorRecorte.map(t => t.id)).toEqual(["morta"]);
  });

  it("diretor que também gerencia continua lendo tudo — papel é N:N", () => {
    // `can_read_all()` é `has_any_role`: basta um dos papéis.
    const r = teamsNoQuadro(TIME, ["manager", "director"], SEM_NADA);
    expect(r.foraPorRecorte).toEqual([]);
  });
});
