import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Presença não altera catálogo de turnos nem os contadores de leads. */
export function useCheckinUpdates(profileId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const refresh = useCallback((includeCounts = false) => {
    if (!profileId) return Promise.resolve();
    const keys: unknown[][] = [
      ["checkin", "today", profileId],
      ["checkin", "current-shift"],
      ["checkin", "eligibility"],
    ];
    if (includeCounts) keys.push(["checkin", "counts", profileId]);
    return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries(
      { queryKey, exact: true }, { cancelRefetch: false },
    )));
  }, [profileId, queryClient]);

  useEffect(() => {
    if (!profileId || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let includeCounts = false;
    const schedule = (counts: boolean) => {
      includeCounts ||= counts;
      // Janela fixa: rajadas contínuas não adiam a atualização indefinidamente.
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const countsChanged = includeCounts;
        includeCounts = false;
        void refresh(countsChanged);
      }, 1_000);
    };
    const channel = supabase.channel(`checkin-updates-${profileId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${profileId}` }, () => schedule(false))
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments", filter: `profile_id=eq.${profileId}` }, () => schedule(true))
      .subscribe();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, profileId, refresh]);

  return refresh;
}
