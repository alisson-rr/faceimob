import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { dbError } from "@/lib/supabaseError";
import { listLegacyDeals } from "@/integrations/supabase/newSchema";
import type { CcaCaseStatus } from "./ccaStage";

export interface CcaStage {
  id: string;
  name: string;
  color: string;
  position: number;
  status: CcaCaseStatus;
}

export interface CcaDeal {
  caseId: string;
  dealId: string;
  client: string;
  developer: string;
  project: string;
  broker: string;
  value: number;
  stageId: string;
  notes: string;
  status: string;
}

export type CcaAnalysis = Record<string, string>;

export const ccaKeys = {
  board: ["cca", "board"] as const,
  case: (dealId: string) => ["cca", "case", dealId] as const,
};

/**
 * Caso do negócio na esteira, para a aba CCA do detalhe.
 *
 * `maybeSingle` porque a maioria dos negócios não tem caso — a ausência é
 * estado normal, não erro. O erro do SELECT, esse, sobe: engoli-lo fazia a aba
 * afirmar "não entrou na esteira" para um negócio que pode ter entrado.
 */
export async function loadCcaCase(dealId: string): Promise<{ id: string; analysis: CcaAnalysis } | null> {
  const { data, error } = await supabase
    .from("cca_cases").select("id,analysis").eq("deal_id", dealId).maybeSingle();
  if (error) throw dbError("cca_cases", error);
  return data ? { id: data.id, analysis: (data.analysis as CcaAnalysis) ?? {} } : null;
}

/**
 * Grava a análise de crédito da aba CCA do negócio.
 *
 * Fica aqui, e não no componente, porque `cca_cases` já é assunto deste módulo
 * — e porque um arquivo de componente que também exporta função quebra o fast
 * refresh (o lint avisa).
 */
export async function saveCcaAnalysis(dealId: string, analysis: CcaAnalysis): Promise<void> {
  const { data, error } = await supabase
    .from("cca_cases").select("id").eq("deal_id", dealId).maybeSingle();
  if (error) throw dbError("cca_cases", error);
  if (!data) return; // Negócio fora da esteira: não há o que gravar.

  // `.select("id")` pelo mesmo motivo de `updateDeal`: a policy `cca_cases_write`
  // é `has_permission('cca.review')` e a aba habilitava por `roles`. Basta o
  // admin desmarcar a permissão para o UPDATE casar 0 linhas — o PostgREST
  // devolve 204 com `error: null` e o modal toastava "Alterações salvas" com a
  // análise de crédito descartada.
  const { data: gravado, error: updateError } = await supabase
    .from("cca_cases").update({ analysis }).eq("id", data.id).select("id");
  if (updateError) throw dbError("cca_cases", updateError);
  if (!gravado?.length) {
    throw dbError("cca_cases", {
      code: "P0001",
      message: "Seu perfil não pode gravar a análise deste caso.",
    });
  }
}

/**
 * Esteira inteira numa consulta só.
 *
 * O `stage_id` do caso pode estar nulo (o estágio foi excluído, ou o caso nasceu
 * antes de `cca_stages` existir): cai no estágio de mesmo desfecho e, em último
 * caso, no primeiro da esteira — nunca some da tela em silêncio.
 */
export async function loadCcaBoard(): Promise<{ stages: CcaStage[]; deals: CcaDeal[] }> {
  const [stagesResponse, casesResponse, dealRows] = await Promise.all([
    supabase.from("cca_stages").select("id,name,color,position,status,active").eq("active", true).order("position"),
    supabase.from("cca_cases").select("id,deal_id,status,stage_id,decision_notes"),
    listLegacyDeals(),
  ]);
  if (stagesResponse.error) throw stagesResponse.error;
  if (casesResponse.error) throw casesResponse.error;

  const stages = (stagesResponse.data || []) as CcaStage[];
  const deals = (casesResponse.data || []).map((row) => {
    const deal = dealRows.find((item) => item.id === row.deal_id);
    const stage = stages.find((item) => item.id === row.stage_id)
      || stages.find((item) => item.status === row.status)
      || stages[0];
    return {
      caseId: row.id,
      dealId: row.deal_id,
      client: deal?.client || "Cliente não informado",
      developer: deal?.developer || "",
      project: deal?.project || "",
      broker: deal?.broker1 || "",
      value: deal?.deal_value || 0,
      stageId: stage?.id || "",
      notes: row.decision_notes || deal?.notes || "",
      status: row.status,
    } satisfies CcaDeal;
  });

  return { stages, deals };
}

export const useCcaBoard = () => useQuery({ queryKey: ccaKeys.board, queryFn: loadCcaBoard });

export function useInvalidateCcaBoard() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ccaKeys.board });
}
