/**
 * Fila CCA por corretor e reativação de Offs (migration 0184).
 *
 * Duas frentes do pedido de 06/10/2026:
 *   1. Posição na fila: `my_cca_queue_position()` retorna todos os negócios do
 *      corretor em análise com sua posição (1º, 2º, etc.) ordenada por
 *      submitted_at. O front usa para popup "Você é o N° na fila" e alertar
 *      quando chega a vez.
 *   2. Reativar Offs: `reactivate_deal(p_deal_id, p_broker_id)` permite
 *      corretor/gerente/diretor reativar negócio OFF/DISTRATO de mês anterior.
 *      Corretor reativa próprio; gerente/diretor informam corretor alvo.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

export type CcaQueueEntry = {
  deal_id: string;
  deal_code: string;
  client_name: string;
  queue_position: number;
  submitted_at: string;
};

export async function getMyCcaQueuePosition(): Promise<CcaQueueEntry[]> {
  const { data, error } = await supabase.rpc("my_cca_queue_position");
  if (error) throw dbError("my_cca_queue_position", error);
  return (data ?? []) as CcaQueueEntry[];
}

export const ccaKeys = {
  queue: ["cca", "queue"] as const,
};

export const useMyCcaQueue = () =>
  useQuery({
    queryKey: ccaKeys.queue,
    queryFn: getMyCcaQueuePosition,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

export type ReactivateDealParams = {
  dealId: string;
  brokerId?: string | null;
};

export type ReactivateDealResult = {
  deal_id: string;
  reactivated: boolean;
  new_month: string;
  broker_id: string;
};

export async function reactivateDeal(params: ReactivateDealParams): Promise<ReactivateDealResult> {
  const { data, error } = await supabase.rpc("reactivate_deal", {
    p_deal_id: params.dealId,
    p_broker_id: params.brokerId ?? null,
  });
  if (error) throw dbError("reactivate_deal", error);
  return data as ReactivateDealResult;
}

export const useReactivateDeal = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reactivateDeal,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ccaKeys.queue });
    },
  });
};