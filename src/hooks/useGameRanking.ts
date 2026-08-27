import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  gameKeys,
  getCurrentSeasonId,
  listRanking,
  type RankingRow,
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
  analises: number;
  aprovados: number;
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
 * e o `EngagementLayer` invalida a chave `["game"]` a cada INSERT em
 * `game_events` — o placar acompanha o realtime sem cada tela assinar um canal.
 */
export function useSeasonRanking(seasonId: string | null | undefined) {
  return useQuery({
    queryKey: gameKeys.ranking(seasonId ?? null),
    queryFn: () => listRanking(seasonId as string),
    enabled: Boolean(seasonId),
    staleTime: 30_000,
  });
}

export function useGameRanking(dealsInput?: DealLite[]) {
  const { role, user } = useAuth();
  const { data: seasonId } = useCurrentSeasonId();
  const { data: ranking, isLoading } = useSeasonRanking(seasonId);

  const rows: RankingRow[] = useMemo(() => ranking ?? [], [ranking]);

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
      analises: Number(breakdown.esteira || 0),
      aprovados: Number(breakdown.aprovado || 0),
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

  // `isLoading` e nao `isPending`: consulta desabilitada (sem temporada aberta)
  // fica `pending` para sempre e travaria qualquer esqueleto ligado nele.
  return { role, myBroker, allScores, scoped, seasonId: seasonId ?? null, loading: isLoading };
}
