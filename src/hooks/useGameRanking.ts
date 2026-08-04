import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  listGameRanking,
  listPeople,
  type PersonRecord,
} from "@/integrations/supabase/newSchema";

// Os pesos vivem em `game_scoring_rules`; nada de constante duplicada aqui.
export type BrokerRow = PersonRecord;

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
  stage?: string | null;
  status?: string | null;
  active?: boolean | null;
};

export function useGameRanking(dealsInput?: DealLite[]) {
  const { role, user } = useAuth();
  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  const [ranking, setRanking] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [people, rows] = await Promise.all([
          listPeople(),
          listGameRanking(),
        ]);
        setBrokers(
          people.filter(
            (person) => person.active && person.roles.includes("broker"),
          ),
        );
        setRanking(rows);
      } catch (error) {
        console.error("Falha ao carregar ranking:", error);
        setBrokers([]);
        setRanking([]);
      }
    })();
  }, []);

  const myBroker = useMemo(
    () => brokers.find((b) => b.user_id === user?.id) || null,
    [brokers, user?.id]
  );

  const allScores: ScoreRow[] = useMemo(() => {
    return brokers
      .map((b) => {
        const serverRow = ranking.find((row) => row.profile_id === b.id);
        const breakdown = serverRow?.breakdown || {};
        const fallbackDeals = dealsInput?.filter(
          (deal: any) =>
            deal.broker1_name === b.name ||
            deal.broker2_name === b.name ||
            deal.broker1 === b.name ||
            deal.broker2 === b.name,
        ) || [];
        const leads = fallbackDeals.filter((deal) => deal.stage === "lead").length;
        const analises =
          Number(breakdown.esteira || 0) ||
          fallbackDeals.filter(
            (deal) =>
              deal.stage === "under_analysis" ||
              deal.stage === "visit_scheduled",
          ).length;
        const aprovados =
          Number(breakdown.aprovado || 0) ||
          fallbackDeals.filter(
            (deal) => deal.stage === "approved" || deal.stage === "contract",
          ).length;
        const vendas =
          Number(serverRow?.sales || breakdown.venda || 0) ||
          fallbackDeals.filter(
            (deal) => deal.stage === "closed" && deal.active !== false,
          ).length;
        const points = Number(serverRow?.points || 0);
        return { broker: b, leads, analises, aprovados, vendas, points };
      })
      .sort((a, b) => b.points - a.points);
  }, [brokers, dealsInput, ranking]);

  const scoped: ScoreRow[] = useMemo(() => {
    if (role === "admin") return allScores;
    if (role === "director" && myBroker) {
      return allScores.filter((s) => s.broker.director_id === myBroker.id || s.broker.id === myBroker.id);
    }
    if (role === "manager" && myBroker) {
      return allScores.filter((s) => s.broker.manager_id === myBroker.id || s.broker.id === myBroker.id);
    }
    if (myBroker) return allScores.filter((s) => s.broker.id === myBroker.id);
    return [];
  }, [allScores, role, myBroker]);

  return { role, myBroker, allScores, scoped };
}
