import { describe, expect, it } from "vitest";
import { recorteDoRanking } from "./PipelineTopRanking";

/**
 * Quem vê o quê no card de ranking do Pipeline (decisão do dono, 05/09/2026).
 *
 * O card mostrava o pódio da equipe para TODO MUNDO. Para o corretor isso é
 * ruído no meio do trabalho — ele já tem o pódio completo em Gamificação; aqui
 * o que interessa é onde ele está.
 *
 * O recorte dos DADOS continua sendo do servidor (`visible_game_ranking`).
 * Isto aqui decide só o que a tela mostra do que já chegou.
 */
describe("recorteDoRanking", () => {
  it("admin e sócio veem o pódio da empresa", () => {
    // Um sócio com poderes de administrador entra por aqui: ele carrega
    // {admin, partner} e `primaryRole` devolve 'admin'. Sócio que só acompanha
    // (`partner` sozinho) cai no recorte estreito, coberto no caso abaixo.
    expect(recorteDoRanking("admin")).toEqual({ soMinhaPosicao: false, escopo: "Empresa" });
  });

  it("diretor e gerente veem o pódio do que lideram", () => {
    expect(recorteDoRanking("director")).toEqual({ soMinhaPosicao: false, escopo: "Sua diretoria" });
    expect(recorteDoRanking("manager")).toEqual({ soMinhaPosicao: false, escopo: "Sua equipe" });
  });

  it("corretor vê só a posição dele", () => {
    expect(recorteDoRanking("broker")).toEqual({ soMinhaPosicao: true, escopo: "Sua posição" });
  });

  it("papel desconhecido falha fechado, no recorte mais estreito", () => {
    // Papel novo no enum sem ninguém lembrar de voltar aqui é o caso real: o
    // padrão não pode ser "mostra o placar da empresa".
    for (const papel of ["cca", "sdr", "marketing", "papel_que_ainda_nao_existe", ""]) {
      expect(recorteDoRanking(papel).soMinhaPosicao, papel).toBe(true);
    }
  });
});
