import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getMyQueues } from "@/integrations/supabase/checkin";
import { supabase } from "@/integrations/supabase/client";

// Um canal e um relógio por perfil/cache, mesmo com indicador e aviso montados.
const subscriptions = new WeakMap<QueryClient, Map<string, {
  consumers: number;
  schedule: () => void;
  dispose: () => void;
}>>();
const queueKey = (profileId: string | null) => ["my-queues", profileId] as const;

export function useMyQueues(profileId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queueKey(profileId),
    queryFn: () => getMyQueues(profileId!),
    enabled: Boolean(profileId),
    staleTime: 60_000,
    refetchOnWindowFocus: "always",
  });

  useEffect(() => {
    if (!profileId) return;
    let profiles = subscriptions.get(queryClient);
    if (!profiles) {
      profiles = new Map();
      subscriptions.set(queryClient, profiles);
    }
    let subscription = profiles.get(profileId);
    if (!subscription) {
      let pending: ReturnType<typeof setTimeout> | undefined;
      let disposed = false;
      const refresh = () => {
        if (!disposed) void queryClient.invalidateQueries(
          {
            queryKey: queueKey(profileId), exact: true,
            // Evento oculto fica dirty no cache; focus "always" fará a leitura.
            refetchType: document.visibilityState === "hidden" ? "none" : "active",
          },
          { cancelRefetch: false },
        );
      };
      const schedule = () => {
        if (disposed || pending !== undefined) return;
        if (document.visibilityState === "hidden") {
          refresh();
          return;
        }
        // Janela fixa: eventos seguintes não adiam a atualização.
        pending = setTimeout(() => {
          pending = undefined;
          refresh();
        }, 1_000);
      };
      const channel = supabase.channel(`my-queues-${profileId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments" }, schedule)
        .on("postgres_changes", { event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${profileId}` }, schedule)
        .subscribe();
      // A fila também muda por horário, sem evento no banco.
      const poll = setInterval(() => {
        if (document.visibilityState !== "hidden") refresh();
      }, 60_000);
      const onVisibilityChange = () => {
        if (document.visibilityState === "hidden" && pending !== undefined) {
          clearTimeout(pending);
          pending = undefined;
          refresh();
        }
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      subscription = {
        consumers: 0,
        schedule,
        dispose: () => {
          disposed = true;
          clearTimeout(pending);
          clearInterval(poll);
          document.removeEventListener("visibilitychange", onVisibilityChange);
          void supabase.removeChannel(channel);
        },
      };
      profiles.set(profileId, subscription);
    }
    subscription.consumers++;
    return () => {
      if (--subscription.consumers === 0) {
        subscription.dispose();
        profiles.delete(profileId);
      }
    };
  }, [profileId, queryClient]);

  const scheduleRefresh = useCallback(() => {
    if (profileId) subscriptions.get(queryClient)?.get(profileId)?.schedule();
  }, [profileId, queryClient]);

  return { ...query, scheduleRefresh };
}
