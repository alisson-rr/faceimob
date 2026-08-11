import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
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

export function useGameRanking(dealsInput?: DealLite[]) {
  const { role, user } = useAuth();
  const [ranking, setRanking] = useState<RankingRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const seasonId = await getCurrentSeasonId();
        setRanking(seasonId ? await listRanking(seasonId) : []);
      } catch (error) {
        console.error("Falha ao carregar ranking:", error);
        setRanking([]);
      }
    })();
  }, []);

  const allScores: ScoreRow[] = useMemo(() => ranking.map((row) => {
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
  }), [dealsInput, ranking]);

  const myBroker = useMemo(
    () => allScores.find((score) => score.broker.user_id === user?.id)?.broker || null,
    [allScores, user?.id],
  );

  // O servidor já devolve exatamente a casa/diretoria/equipe permitida.
  const scoped = allScores;

  return { role, myBroker, allScores, scoped };
}
