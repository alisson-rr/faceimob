import { describe, expect, it, vi } from "vitest";

// `useSeasonRanking` só chama `useQuery` — com o espião no lugar dele dá para
// ler a chave de cache montada sem subir React nem provider.
const { useQuery } = vi.hoisted(() => ({
  useQuery: vi.fn((_options: { queryKey: readonly unknown[] }) => ({ data: undefined, isLoading: false })),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery }));

// Renomeado na importação de propósito: `rules-of-hooks` proíbe chamar algo
// `use*` de dentro de um callback, e aqui o alvo do teste é a chave que a
// função monta, não o ciclo de vida do React.
import { recorteDoRanking, useSeasonRanking as consultaDoPlacar } from "./useGameRanking";

const chaveDaUltimaConsulta = () => useQuery.mock.calls.at(-1)?.[0].queryKey;

/**
 * A chave de cache do placar precisa das DUAS pontas do intervalo.
 *
 * `gameKeys.ranking` já aceita as duas, mas o hook mandava só o início: duas
 * leituras de intervalos diferentes que começam no mesmo dia — o mês e a
 * semana, sempre que o mês vira numa segunda — caíam na mesma entrada do cache
 * e uma devolvia o número da outra.
 */
describe("useSeasonRanking", () => {
  it("semana e mês que começam no mesmo dia não compartilham chave", () => {
    // 01/06/2026 é segunda: `weekRange` e `intervaloDoMes` abrem no mesmo dia.
    consultaDoPlacar("s1", { from: "2026-06-01", to: "2026-06-07" });
    const semana = chaveDaUltimaConsulta();

    consultaDoPlacar("s1", { from: "2026-06-01", to: "2026-06-30" });
    const mes = chaveDaUltimaConsulta();

    expect(semana).toContain("2026-06-07");
    expect(mes).toContain("2026-06-30");
    expect(semana).not.toEqual(mes);
  });

  it("sem intervalo a chave é a da temporada inteira", () => {
    consultaDoPlacar("s1");
    expect(chaveDaUltimaConsulta()).toEqual(["game", "ranking", "s1", null, null]);
  });
});

/**
 * Quem vê o quê no placar (decisão do cliente, 10/09/2026): gerente vê quem ele
 * gerencia, diretor quem ele dirige, admin e sócio a casa, e o corretor vê a
 * própria colocação em vez do pódio.
 *
 * O recorte dos DADOS é do servidor (`can_see_game_profile`, apertada na 0112 —
 * o assert de comportamento está em
 * `supabase/tests/98_ranking_recorte_diretoria.sql`). O que mora aqui é só o
 * DESENHO: do que já chegou, o que cada superfície mostra. Estes testes ficam ao
 * lado do hook porque é lá que a regra passou a morar — antes havia uma cópia
 * dela no card do Pipeline, e foi a divergência entre as duas que gerou o
 * defeito do cabeçalho mostrando o pódio da equipe ao corretor.
 */
describe("recorteDoRanking", () => {
  it("admin e sócio veem o pódio da empresa", () => {
    // Um caso só, e é o certo: `isAdmin` do AuthContext já responde por admin E
    // sócio (mesmo nível de permissão). A tela não repete a lista de papéis.
    expect(recorteDoRanking(["admin", "broker"], true)).toEqual({ soMinhaPosicao: false, escopo: "Empresa" });
    expect(recorteDoRanking(["partner", "broker"], true)).toEqual({ soMinhaPosicao: false, escopo: "Empresa" });
  });

  it("diretor e gerente veem o pódio do que lideram", () => {
    expect(recorteDoRanking(["director"], false)).toEqual({ soMinhaPosicao: false, escopo: "Sua diretoria" });
    expect(recorteDoRanking(["manager"], false)).toEqual({ soMinhaPosicao: false, escopo: "Sua equipe" });
  });

  it("corretor vê só a posição dele", () => {
    expect(recorteDoRanking(["broker"], false)).toEqual({ soMinhaPosicao: true, escopo: "Sua posição" });
  });

  it("papel desconhecido falha fechado, no recorte mais estreito", () => {
    // Papel novo no enum sem ninguém lembrar de voltar aqui é o caso real: o
    // padrão não pode ser "mostra o placar da empresa".
    for (const papel of ["cca", "sdr", "marketing"] as const) {
      expect(recorteDoRanking([papel], false).soMinhaPosicao, papel).toBe(true);
    }
    // Sem papel nenhum (perfil não carregado) também é o recorte estreito.
    expect(recorteDoRanking([], false).soMinhaPosicao).toBe(true);
  });

  it("papel é N:N: diretor que também é corretor vê a diretoria", () => {
    // `handle_new_auth_user` dá `broker` a TODA conta nova e nunca o retira, e
    // a ata de 23/07 é explícita quanto a acumular papel. Decidir pelo papel
    // singular derrubava o diretor em "Sua posição" — e, pior, dependia da
    // ordem em que `user_roles` voltasse da consulta.
    expect(recorteDoRanking(["broker", "director"], false)).toEqual({ soMinhaPosicao: false, escopo: "Sua diretoria" });
    expect(recorteDoRanking(["broker", "manager"], false)).toEqual({ soMinhaPosicao: false, escopo: "Sua equipe" });
    // Diretor que também gerencia uma equipe fica no recorte MAIOR dos dois.
    expect(recorteDoRanking(["manager", "director", "broker"], false).escopo).toBe("Sua diretoria");
  });

  it("prévia de papel derruba o pódio junto com o isAdmin", () => {
    // "Ver como Corretor" zera `isAdmin` no contexto; sem passar a flag daqui o
    // admin em prévia continuaria vendo o placar da empresa.
    expect(recorteDoRanking(["broker"], false).soMinhaPosicao).toBe(true);
  });
});
