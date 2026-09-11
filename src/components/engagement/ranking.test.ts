import { describe, expect, it } from "vitest";
import { buildFrozenScores, buildScores, ordenarRanking, UNKNOWN_PERSON } from "./ranking";
import type { RankingRow, SeasonResultRow } from "@/integrations/supabase/game";

const row = (over: Partial<RankingRow>): RankingRow => ({
  season_id: "s1",
  profile_id: "p",
  full_name: "Fulano",
  avatar_url: null,
  active: true,
  points: 0,
  sales: 0,
  vgv: 0,
  breakdown: null,
  team_id: null,
  team_name: null,
  manager_id: null,
  manager_name: null,
  director_id: null,
  director_name: null,
  ...over,
});

const frozen = (over: Partial<SeasonResultRow>): SeasonResultRow => ({
  season_id: "s1",
  profile_id: "p",
  rank: 1,
  points: 0,
  sales: 0,
  vgv: 0,
  breakdown: null,
  ...over,
});

/**
 * A regra que o pódio do Pipeline e os "Destaques" do Painel liam CRUA da RPC —
 * e por isso mostravam três nomes quaisquer no começo da temporada, em ordem
 * diferente a cada carregamento. `listRanking` pede ao servidor só
 * `order('points')`; o desempate e o filtro de ativo são daqui.
 */
describe("ordenarRanking", () => {
  it("empate em 0 sai em ordem de nome, não na ordem de chegada", () => {
    const ordenado = ordenarRanking([
      row({ profile_id: "c", full_name: "Carlos", points: 0 }),
      row({ profile_id: "a", full_name: "Ana", points: 0 }),
      row({ profile_id: "b", full_name: "Bruno", points: 0 }),
    ]);

    expect(ordenado.map((r) => r.full_name)).toEqual(["Ana", "Bruno", "Carlos"]);
  });

  it("a mesma lista embaralhada dá o mesmo pódio", () => {
    // É o defeito, escrito: dois carregamentos do MESMO placar não podem
    // devolver três primeiros diferentes.
    const linhas = [
      row({ profile_id: "a", full_name: "Ana", points: 0 }),
      row({ profile_id: "b", full_name: "Bruno", points: 0 }),
      row({ profile_id: "c", full_name: "Carlos", points: 0 }),
      row({ profile_id: "d", full_name: "Dora", points: 0 }),
    ];
    const podio = (l: typeof linhas) => ordenarRanking(l).slice(0, 3).map((r) => r.profile_id);

    expect(podio([...linhas].reverse())).toEqual(podio(linhas));
    expect(podio([linhas[2], linhas[0], linhas[3], linhas[1]])).toEqual(["a", "b", "c"]);
  });

  it("desempata como o banco congela: pontos desc, depois nome", () => {
    // `close_game_season` usa `order by r.points desc, r.full_name`. Ordem
    // diferente aqui faria a medalha da tela brigar com a do congelado.
    const ordenado = ordenarRanking([
      row({ full_name: "Ana", points: 10 }),
      row({ full_name: "Zeca", points: 50 }),
      row({ full_name: "Bruno", points: 10 }),
    ]);

    expect(ordenado.map((r) => r.full_name)).toEqual(["Zeca", "Ana", "Bruno"]);
  });

  it("quem foi desativado não ocupa degrau do pódio", () => {
    const ordenado = ordenarRanking([
      row({ profile_id: "x", full_name: "Ex-corretor", points: 900, active: false }),
      row({ profile_id: "b", full_name: "Bruno", points: 3 }),
    ]);

    expect(ordenado.map((r) => r.profile_id)).toEqual(["b"]);
  });

  it("não mexe na lista recebida", () => {
    // `sort` é in-place: sem a cópia, ordenar o cache do TanStack Query mutaria
    // o objeto que outras telas estão lendo.
    const linhas = [row({ full_name: "Ana", points: 1 }), row({ full_name: "Zeca", points: 9 })];
    ordenarRanking(linhas);
    expect(linhas.map((r) => r.full_name)).toEqual(["Ana", "Zeca"]);
  });
});

describe("buildScores", () => {
  it("desempata por nome, como o banco faz ao congelar", () => {
    // Ordem de chegada invertida de propósito: sem desempate, o pódio trocava
    // de degrau entre dois carregamentos com o mesmo dado.
    const scores = buildScores([
      row({ profile_id: "c", full_name: "Carlos", points: 0 }),
      row({ profile_id: "a", full_name: "Ana", points: 0 }),
      row({ profile_id: "b", full_name: "Bruno", points: 0 }),
      row({ profile_id: "z", full_name: "Zeca", points: 10 }),
    ]);

    expect(scores.map((s) => s.brokerName)).toEqual(["Zeca", "Ana", "Bruno", "Carlos"]);
  });

  it("descarta corretor inativo e nomeia quem está sem equipe", () => {
    const scores = buildScores([
      row({ profile_id: "a", full_name: "Ana", points: 5, active: false }),
      row({ profile_id: "b", full_name: "Bruno", points: 3 }),
    ]);

    expect(scores).toHaveLength(1);
    expect(scores[0].team).toBe("Sem equipe");
  });
});

describe("buildFrozenScores", () => {
  const people = new Map<string, RankingRow>([
    ["a", row({ profile_id: "a", full_name: "Ana", team_name: "Alfa" })],
  ]);

  it("com keepUnknown, mantém quem saiu da equipe: congelado que muda não é congelado", () => {
    const scores = buildFrozenScores(
      [frozen({ profile_id: "a", rank: 1, points: 90 }), frozen({ profile_id: "x", rank: 2, points: 40 })],
      people,
      { keepUnknown: true },
    );

    expect(scores.map((s) => s.brokerName)).toEqual(["Ana", UNKNOWN_PERSON]);
    expect(scores[1].unknownPerson).toBe(true);
    expect(scores[1].points).toBe(40);
  });

  it("sem keepUnknown, descarta a linha de quem o escopo de hoje não alcança", () => {
    // Quem não é admin/diretor/sócio não pode receber ponto e VGV de gente fora
    // do próprio escopo — e enquanto a policy da 0060 não estiver aplicada o
    // SELECT de `game_season_results` ainda devolve a casa inteira.
    const scores = buildFrozenScores(
      [frozen({ profile_id: "a", rank: 1, points: 90 }), frozen({ profile_id: "x", rank: 2, points: 40 })],
      people,
      { keepUnknown: false },
    );

    expect(scores.map((s) => s.brokerId)).toEqual(["a"]);
  });

  it("carrega o rank gravado, porque a lista filtrada fica descontínua", () => {
    // A tela numera a coluna "#" por este campo: pelo índice do array, o 7º
    // colocado do fechamento ganhava a coroa de 1º quando as linhas do meio
    // saíam do recorte.
    const scores = buildFrozenScores(
      [frozen({ profile_id: "a", rank: 7, points: 90 })],
      people,
      { keepUnknown: false },
    );

    expect(scores[0].rank).toBe(7);
  });

  it("respeita o rank gravado no fechamento, não a ordem da consulta", () => {
    const scores = buildFrozenScores(
      [
        frozen({ profile_id: "b", rank: 2, points: 100 }),
        frozen({ profile_id: "a", rank: 1, points: 100 }),
      ],
      people,
      { keepUnknown: true },
    );

    // Empate de pontos: quem manda é o `rank` congelado, não o valor.
    expect(scores.map((s) => s.brokerId)).toEqual(["a", "b"]);
  });
});
