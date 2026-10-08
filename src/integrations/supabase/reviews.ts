import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

// A RPC nasceu na 0196 e ganhou o diretor na 0238. O tipo gerado será
// atualizado na próxima regeneração contra o banco migrado.
const reviewRpc = supabase as unknown as SupabaseClient;

export const reviewKeys = {
  pendingQueues: ["document-review", "pending-queue"] as const,
  pendingQueue: (profileId: string | null) => ["document-review", "pending-queue", profileId] as const,
};

export async function getMyPendingReviewDealIds(): Promise<string[]> {
  const { data, error } = await reviewRpc.rpc("minhas_conferencias_pendentes_ids");
  if (error) throw dbError("minhas_conferencias_pendentes_ids", error);
  return (Array.isArray(data) ? data : [])
    .map((row) => String((row as { deal_id?: unknown }).deal_id ?? ""))
    .filter(Boolean);
}

/** Pendências que esta liderança pode aprovar, atualizadas quando um negócio muda. */
export function useMyPendingReviewDealIds(profileId: string | null, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: reviewKeys.pendingQueue(profileId),
    queryFn: getMyPendingReviewDealIds,
    enabled: enabled && Boolean(profileId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!enabled || !profileId) return;
    const channel = supabase
      .channel("my-pending-document-reviews")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deals" }, () => {
        void queryClient.invalidateQueries({ queryKey: reviewKeys.pendingQueues });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, profileId, queryClient]);

  return query;
}
