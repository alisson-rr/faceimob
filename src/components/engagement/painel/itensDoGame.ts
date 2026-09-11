import type { RankingRow, ScoringRule } from "@/integrations/supabase/game";
import { ordenarRanking } from "../ranking";

/**
 * Os itens do game que contaram ponto na temporada, somados no recorte de quem
 * está olhando — a coluna da esquerda do Painel.
 *
 * O recorte é o do GAME, não o do dia (pedido do cliente, 11/09/2026): a versão
 * anterior lia o diário de HOJE, que é outra fonte e outro período.
 *
 *   · corretor → só a linha dele (o servidor devolve a equipe inteira para ele,
 *     por causa dos Destaques);
 *   · gerente, diretor, admin e sócio → a soma do recorte que o servidor
 *     devolveu, na mesma lista (só ativos) que os Destaques mostram.
 *
 * QUAIS linhas chegam é decisão de `can_see_game_profile` no banco; aqui só se
 * soma o que já chegou.
 */

export type ItemDoGame = { code: string; label: string; points: number };

export function itensDoGame(
  ranking: RankingRow[],
  regras: ScoringRule[],
  recorte: { soMinhaPosicao: boolean; meuId: string | null },
): { total: number; itens: ItemDoGame[] } {
  const linhas = recorte.soMinhaPosicao
    ? ranking.filter((linha) => linha.profile_id === recorte.meuId)
    : ordenarRanking(ranking);

  const somas = new Map<string, number>();
  for (const linha of linhas) {
    for (const [code, pontos] of Object.entries(linha.breakdown ?? {})) {
      somas.set(code, (somas.get(code) ?? 0) + Number(pontos));
    }
  }

  const regraPorCodigo = new Map(regras.map((regra) => [regra.event_code, regra]));
  // Código que pontuou e não tem mais regra ativa (desligada no meio da
  // temporada) continua na lista: sem ele os itens não fechariam com o total.
  const codigos = new Set([...regraPorCodigo.keys(), ...somas.keys()]);

  const itens = [...codigos]
    .map((code) => ({
      code,
      label: regraPorCodigo.get(code)?.label ?? code,
      points: somas.get(code) ?? 0,
      peso: regraPorCodigo.get(code)?.points ?? Number.POSITIVE_INFINITY,
    }))
    // Ordem do funil: do item que vale menos ao que vale mais, e o que tira
    // ponto (distrato) por último. Empate de peso desempata pelo código, para a
    // lista não trocar de ordem entre um carregamento e outro.
    .sort(
      (a, b) =>
        Number(a.peso < 0) - Number(b.peso < 0) ||
        (a.peso === b.peso ? a.code.localeCompare(b.code) : a.peso - b.peso),
    )
    .map((item) => ({ code: item.code, label: item.label, points: item.points }));

  return { total: itens.reduce((soma, item) => soma + item.points, 0), itens };
}
