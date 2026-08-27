/**
 * Consultas do Pipeline.
 *
 * Antes eram sete `useState` alimentados por `useEffect` com `catch` que só
 * toastava: quando `listLegacyDeals()` falhava, `deals` ficava `[]` e a tela
 * dizia "Nenhum negócio encontrado" — erro de rede e filtro sem resultado davam
 * exatamente a mesma tela (achado A01). Aqui cada carga é um `useQuery` com
 * chave estável, e quem renderiza decide entre `LoadingState`, `EmptyState` e
 * erro com "Tentar de novo". `staleTime: 60_000` vem do `App.tsx`.
 */
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { listDevelopers } from "@/integrations/supabase/leads";
import { listPipelineStages } from "@/integrations/supabase/permissions";
import { listSeasons } from "@/integrations/supabase/game";
import {
  listLegacyDeals,
  listOpenCheckins,
  listPeople,
  toDisplayMonth,
} from "@/integrations/supabase/newSchema";

export const pipelineKeys = {
  root: ["pipeline"] as const,
  /** A lista de negócios é compartilhada com o Dashboard: chave curta e estável. */
  deals: ["deals"] as const,
  stages: ["pipeline", "stages"] as const,
  people: ["pipeline", "people"] as const,
  developers: ["pipeline", "developers"] as const,
  closedMonths: ["closed_months"] as const,
  queue: ["pipeline", "checkins"] as const,
  openSeason: ["pipeline", "open-season"] as const,
};

export const useDeals = () =>
  useQuery({ queryKey: pipelineKeys.deals, queryFn: listLegacyDeals });

/** Catálogo de etapas — fonte única do rótulo e dono do `id` que o RLS autoriza. */
export const usePipelineStages = () =>
  useQuery({ queryKey: pipelineKeys.stages, queryFn: listPipelineStages, staleTime: 5 * 60_000 });

export const usePeople = () =>
  useQuery({ queryKey: pipelineKeys.people, queryFn: listPeople, staleTime: 5 * 60_000 });

export const useDevelopers = () =>
  useQuery({ queryKey: pipelineKeys.developers, queryFn: listDevelopers, staleTime: 5 * 60_000 });

export const useClosedMonths = () =>
  useQuery({
    queryKey: pipelineKeys.closedMonths,
    queryFn: async () => {
      const result = await supabase.from("closed_months").select("period");
      if (result.error) throw dbError("closed_months", result.error);
      return (result.data ?? [])
        .map((row) => toDisplayMonth(row.period))
        .filter((month): month is string => Boolean(month));
    },
  });

/**
 * Temporada aberta do game. Desde a migration `0032` o mês-base do negócio segue
 * o ciclo do jogo, então é ELE que o "Fechar Mês" congela — não o mês do
 * relógio nem o que estiver digitado no filtro.
 */
export const useOpenSeason = () =>
  useQuery({
    queryKey: pipelineKeys.openSeason,
    queryFn: async () => (await listSeasons()).find((season) => !season.closed_at) ?? null,
  });

/**
 * Fila de atendimento do dia. O realtime de `checkins` invalida a chave: a
 * roleta muda a fila pelo banco e a barra não pode mostrar quem já saiu.
 */
export function useCheckinQueue() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: pipelineKeys.queue, queryFn: listOpenCheckins });

  useEffect(() => {
    const channel = supabase
      .channel("pipeline-checkins")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins" }, () => {
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.queue });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}

/**
 * Recarrega os negócios depois de uma escrita.
 *
 * Também assina `deals`: o CCA aprova pela outra tela e o fechamento de mês
 * move proposta em massa — sem ouvir a tabela, o Pipeline aberto continua
 * mostrando o funil de antes.
 */
export function useDealsRealtime() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel("pipeline-deals")
      .on("postgres_changes", { event: "*", schema: "public", table: "deals" }, () => {
        void queryClient.invalidateQueries({ queryKey: pipelineKeys.deals });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);
}

export function useInvalidateDeals() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: pipelineKeys.deals });
}
