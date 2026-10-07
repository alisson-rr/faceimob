import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

// A RPC nasceu na 0196 e ganhou o diretor na 0238. O tipo gerado será
// atualizado na próxima regeneração contra o banco migrado.
const reviewRpc = supabase as unknown as SupabaseClient;

export const reviewKeys = {
  pendingCounts: ["document-review", "pending-count"] as const,
  pendingCount: (profileId: string | null) => ["document-review", "pending-count", profileId] as const,
};

export async function getMyPendingReviewCount(): Promise<number> {
  const { data, error } = await reviewRpc.rpc("minhas_conferencias_pendentes");
  if (error) throw dbError("minhas_conferencias_pendentes", error);
  return Number(data) || 0;
}

/** Pendências que esta liderança pode aprovar, atualizadas quando um negócio muda. */
export function useMyPendingReviewCount(profileId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: reviewKeys.pendingCount(profileId),
    queryFn: getMyPendingReviewCount,
    enabled: enabled && Boolean(profileId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!enabled || !profileId) return;
    const channel = supabase
      .channel("my-pending-document-reviews")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deals" }, () => {
        void queryClient.invalidateQueries({ queryKey: reviewKeys.pendingCounts });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, profileId, queryClient]);

  return query;
}
