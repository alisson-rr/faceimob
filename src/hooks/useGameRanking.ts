import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
// Caminho direto, e não o barril `@/components/engagement`: o barril arrasta
// EngagementLayer, confete e áudio para dentro de um hook que só quer a ordem.
import { ordenarRanking } from "@/components/engagement/ranking";
import { primaryRole } from "@/integrations/supabase/newSchema";
import {
  gameKeys,
  getCurrentSeasonId,
  listRanking,
  type RankingRow,
  type WeekRange,
} from "@/integrations/supabase/game";

export type BrokerRow = {
  id: string;
  user_id: string;
  name: string;
  full_name: string;
  avatar_url: string | null;
  active: boolean;
  team_id: string | null;
  team: string;
  manager_id: string | null;
  manager_name: string | null;
  director_id: string | null;
  director_name: string | null;
};

export type ScoreRow = {
  broker: BrokerRow;
  leads: number;
  /**
   * PONTOS de cada regra, não contagem de eventos.
   *
   * `breakdown` é `jsonb_object_agg(event_code, code_points)` (0010/0027): a
   * chave 'esteira' vale 140 PONTOS por análise enviada (0078). Os campos se
   * chamavam `analises` e `aprovados` e ninguém os renderizava — a próxima tela
   * que pegasse `analises` escreveria "140 análises" na cara do corretor.
   */
  pontosEsteira: number;
  pontosAprovacao: number;
  vendas: number;
  points: number;
};

type DealLite = {
  broker1_name?: string | null;
  broker2_name?: string | null;
  broker1?: string | null;
  broker2?: string | null;
  stage?: string | null;
  active?: boolean | null;
};

/**
 * Temporada aberta. `null` quando o admin não abriu nenhuma — nesse estado o
 * `award_game_points` devolve null em silêncio e o jogo está parado.
 */
export function useCurrentSeasonId() {
  return useQuery({
    queryKey: gameKeys.season,
    queryFn: getCurrentSeasonId,
    staleTime: 60_000,
  });
}

/**
 * Ranking da temporada, já no escopo que o servidor permite ver.
 *
 * Era um `useEffect` com `useState` que buscava uma vez e nunca mais: uma venda
 * fechada com a tela aberta não mexia o placar. Agora é cache do TanStack Query,
 * e o `EngagementLayer` refaz o ranking depois de cada rajada de INSERTs em
 * `game_events` (uma releitura por janela de `PLACAR_MS`, não uma por linha) —
 * o placar acompanha o realtime sem cada tela assinar um canal.
 *
 * `week` recorta a MESMA pontuação num intervalo de dias (premiação semanal,
 * pedido de 10/09/2026). É filtro de leitura: a temporada continua sendo o
 * ciclo, e sem `week` o comportamento é exatamente o de antes.
 */
export function useSeasonRanking(seasonId: string | null | undefined, week?: WeekRange | null) {
  return useQuery({
    // As DUAS pontas do intervalo na chave: mês e semana podem começar no mesmo
    // dia, e aí só o `from` faria as duas leituras colidirem no cache.
    queryKey: gameKeys.ranking(seasonId ?? null, week?.from ?? null, week?.to ?? null),
    queryFn: () => listRanking(seasonId as string, week),
    enabled: Boolean(seasonId),
    staleTime: 30_000,
  });
}

/**
 * O que cada papel vê do placar — a regra, escrita UMA vez.
 *
 * Ela mora aqui, e não em cada tela, porque o defeito que a originou foi
 * justamente ter duas: o cabeçalho do `AppLayout` mostrava o pódio da equipe ao
 * corretor enquanto o card do Pipeline mostrava a colocação dele. Quem chama o
 * hook recebe o resultado pronto em `recorte`.
 *
 * `isAdmin` vem do `AuthContext` e já responde por administrador E sócio (mesmo
 * nível de permissão, decisão do cliente em 10/09/2026); nenhuma tela repete
 * `|| roles.includes('partner')` na mão.
 *
 * Falha FECHADO: papel desconhecido cai no recorte mais estreito (só a própria
 * posição). Errar para o lado estreito esconde informação de quem talvez
 * pudesse vê-la; errar para o largo publica o placar da empresa para quem não
 * deveria — e papel novo no enum é exatamente o caso em que ninguém lembra de
 * voltar aqui.
 *
 * `soMinhaPosicao` é DESENHO, não permissão: quem decide quais linhas chegam ao
 * navegador é `can_see_game_profile` (migration 0060, estreitada na 0112). O
 * corretor enxerga a equipe dele no banco — é o que o Painel mostra em
 * "Destaques", conforme o print do cliente —, e nas duas tiras que espelham o
 * card do Pipeline o cliente pediu a própria colocação no lugar do pódio.
 *
 * Recebe TODOS os papéis, não um só: papel é N:N em `user_roles` e
 * `handle_new_auth_user` dá `broker` a toda conta nova, então um diretor é
 * `{director, broker}` no caso normal. Quem desempata é `primaryRole` — a
 * mesma precedência de `auth_effective_role()` no banco —, e não a ordem em que
 * as linhas voltaram da consulta.
 */
export function recorteDoRanking(roles: AppRole[], isAdmin: boolean): { soMinhaPosicao: boolean; escopo: string } {
  if (isAdmin) return { soMinhaPosicao: false, escopo: "Empresa" };
  const efetivo = primaryRole(roles);
  if (efetivo === "director") return { soMinhaPosicao: false, escopo: "Sua diretoria" };
  if (efetivo === "manager") return { soMinhaPosicao: false, escopo: "Sua equipe" };
  return { soMinhaPosicao: true, escopo: "Sua posição" };
}

export function useGameRanking(dealsInput?: DealLite[]) {
  const { role, roles, isAdmin, user } = useAuth();
  const { data: seasonId } = useCurrentSeasonId();
  const { data: ranking, isLoading } = useSeasonRanking(seasonId);

  /**
   * Ativo, pontos desc, nome no empate — a MESMA `ordenarRanking` do pódio da
   * Gamificação e do `EngagementLayer`, e o mesmo desempate que
   * `close_game_season` grava.
   *
   * Sem ela, `visible_game_ranking` vinha só com `order('points')`: no começo
   * da temporada, com todo mundo em 0, o pódio do Pipeline mostrava três nomes
   * quaisquer e trocava a cada carregamento — e quem foi desativado continuava
   * ocupando degrau.
   */
  const rows: RankingRow[] = useMemo(() => ordenarRanking(ranking ?? []), [ranking]);

  const allScores: ScoreRow[] = useMemo(() => rows.map((row) => {
    const breakdown = row.breakdown || {};
    const deals = dealsInput?.filter((deal) =>
      deal.broker1_name === row.full_name ||
      deal.broker2_name === row.full_name ||
      deal.broker1 === row.full_name ||
      deal.broker2 === row.full_name
    ) || [];
    return {
      broker: {
        id: row.profile_id,
        user_id: row.profile_id,
        name: row.full_name,
        full_name: row.full_name,
        avatar_url: row.avatar_url,
        active: row.active,
        team_id: row.team_id,
        team: row.team_name || "",
        manager_id: row.manager_id,
        manager_name: row.manager_name,
        director_id: row.director_id,
        director_name: row.director_name,
      },
      leads: deals.filter((deal) => deal.stage === "lead").length,
      pontosEsteira: Number(breakdown.esteira || 0),
      pontosAprovacao: Number(breakdown.aprovado || 0),
      vendas: row.sales,
      points: row.points,
    };
  }), [dealsInput, rows]);

  const myBroker = useMemo(
    () => allScores.find((score) => score.broker.user_id === user?.id)?.broker || null,
    [allScores, user?.id],
  );

  // O servidor já devolve exatamente a casa/diretoria/equipe permitida.
  const scoped = allScores;

  /**
   * A linha de quem está olhando, e a posição dela.
   *
   * A posição é o índice em `allScores`, que é o recorte do SERVIDOR na ordem
   * de `ordenarRanking` — a mesma do pódio desta tela e a mesma que o banco
   * congela no fim da temporada. Contar em cima de outro recorte, ou da ordem
   * crua da RPC, daria um "4º lugar" que não bate com ranking nenhum. QUEM vê
   * esta colocação no lugar do pódio é decisão de `recorteDoRanking`, acima — a
   * regra está lá, e só lá.
   *
   * `null` quando a pessoa não está no ranking — conta sem venda na temporada,
   * papel que não pontua, ou perfil desativado. Quem mostra a diferença é a
   * tela.
   */
  const minhaPosicao = useMemo(() => {
    const indice = allScores.findIndex((score) => score.broker.user_id === user?.id);
    return indice < 0 ? null : indice + 1;
  }, [allScores, user?.id]);

  const meuScore = useMemo(
    () => allScores.find((score) => score.broker.user_id === user?.id) ?? null,
    [allScores, user?.id],
  );

  // `isLoading` e nao `isPending`: consulta desabilitada (sem temporada aberta)
  // fica `pending` para sempre e travaria qualquer esqueleto ligado nele.
  return {
    role, myBroker, allScores, scoped, meuScore, minhaPosicao,
    recorte: recorteDoRanking(roles, isAdmin),
    seasonId: seasonId ?? null, loading: isLoading,
  };
}
