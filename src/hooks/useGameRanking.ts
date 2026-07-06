import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const SCORING = {
  incomplete_with_doc: 10,
  envio_esteira_agil: 140,
  approved: 250,
  venda: 600,
  distrato_penalty: -600,
};

export type BrokerRow = {
  id: string;
  name: string;
  active: boolean;
  user_id: string | null;
  manager_id: string | null;
  director_id: string | null;
  avatar_url: string | null;
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
  stage?: string | null;
  status?: string | null;
  active?: boolean | null;
};

export function useGameRanking(dealsInput?: DealLite[]) {
  const { role, user } = useAuth();
  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  const [cachedDeals, setCachedDeals] = useState<DealLite[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("brokers")
        .select("id,name,active,user_id,manager_id,director_id,avatar_url")
        .eq("active", true)
        .order("name");
      setBrokers((data as any) || []);
    })();
  }, []);

  useEffect(() => {
    if (dealsInput) return;
    (async () => {
      const { data } = await supabase
        .from("dashboard_bi_cache" as any)
        .select("payload")
        .eq("id", true)
        .maybeSingle();
      setCachedDeals(((data as any)?.payload?.deals || []) as DealLite[]);
    })();
  }, [dealsInput]);

  const deals = dealsInput ?? cachedDeals ?? [];

  const myBroker = useMemo(
    () => brokers.find((b) => b.user_id === user?.id) || null,
    [brokers, user?.id]
  );

  const allScores: ScoreRow[] = useMemo(() => {
    return brokers
      .map((b) => {
        const bd = deals.filter(
          (d: any) => d.broker1_name === b.name || d.broker2_name === b.name || d.broker1 === b.name || d.broker2 === b.name
        );
        const leads = bd.filter((d) => d.stage === "lead").length;
        const incompletos = bd.filter((d) => d.stage === "incomplete").length;
        const analises = bd.filter((d) => d.stage === "under_analysis" || d.stage === "visit_scheduled").length;
        const aprovados = bd.filter((d) => d.stage === "approved" || d.stage === "contract").length;
        const vendas = bd.filter((d) => d.stage === "closed" && d.active !== false).length;
        const distratos = bd.filter((d) => d.stage === "closed" && d.active === false).length;
        const points = Math.max(
          0,
          incompletos * SCORING.incomplete_with_doc +
            analises * SCORING.envio_esteira_agil +
            aprovados * SCORING.approved +
            vendas * SCORING.venda +
            distratos * SCORING.distrato_penalty
        );
        return { broker: b, leads, analises, aprovados, vendas, points };
      })
      .sort((a, b) => b.points - a.points);
  }, [brokers, deals]);

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
