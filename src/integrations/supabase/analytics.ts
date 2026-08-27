import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Consolidado anual, campanhas e trilha de auditoria.
 *
 * As três superfícies existiam no schema e nenhuma tela as usava:
 * `Resultados.tsx` recalculava o anual a cada abertura a partir de todos os
 * negócios — o que ignorava `closed_months` e reabria discrepância em mês já
 * fechado, exatamente a queixa que originou a tabela.
 */

export type AnnualResultRow = {
  id: string;
  year: number;
  month: number;
  sales_count: number;
  vgv: number;
  notes: string | null;
  updated_at: string;
};

/** Sem `year`, devolve a tabela inteira - sao ~12 linhas por ano. */
export async function listAnnualResults(year?: number): Promise<AnnualResultRow[]> {
  let query = supabase
    .from("annual_results")
    .select("id,year,month,sales_count,vgv,notes,updated_at");
  if (year !== undefined) query = query.eq("year", year);
  const { data, error } = await query.order("year", { ascending: false }).order("month");
  if (error) throw dbError("listar resultados anuais", error);
  return (data ?? []) as AnnualResultRow[];
}

/** Upsert por (year, month) — a tabela tem unique nessa dupla. */
export async function upsertAnnualResult(input: {
  year: number;
  month: number;
  salesCount: number;
  vgv: number;
  notes?: string | null;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("annual_results")
    .upsert(
      {
        year: input.year,
        month: input.month,
        sales_count: input.salesCount,
        vgv: input.vgv,
        notes: input.notes ?? null,
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: "year,month" },
    );
  if (error) throw dbError("salvar resultado anual", error);
}

// -----------------------------------------------------------------------------
// Campanhas
// -----------------------------------------------------------------------------

export type AdCampaignRow = {
  id: string;
  external_id: string;
  platform: string;
  name: string;
  developer_id: string | null;
  status: string | null;
  daily_budget: number | null;
  total_spend: number;
  synced_at: string | null;
};

export async function listAdCampaigns(): Promise<AdCampaignRow[]> {
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select("id,external_id,platform,name,developer_id,status,daily_budget,total_spend,synced_at")
    .order("name");
  if (error) throw dbError("listar campanhas", error);
  return (data ?? []) as AdCampaignRow[];
}

export async function upsertAdCampaign(input: {
  externalId: string;
  platform: string;
  name: string;
  developerId?: string | null;
  dailyBudget?: number | null;
  totalSpend?: number;
}): Promise<void> {
  const { error } = await supabase
    .from("ad_campaigns")
    .upsert(
      {
        external_id: input.externalId,
        platform: input.platform,
        name: input.name,
        developer_id: input.developerId ?? null,
        daily_budget: input.dailyBudget ?? null,
        ...(input.totalSpend !== undefined ? { total_spend: input.totalSpend } : {}),
      },
      { onConflict: "platform,external_id" },
    );
  if (error) throw dbError("salvar campanha", error);
}

export type CampaignPerformance = {
  campaignId: string;
  campaignName: string;
  totalSpend: number;
  leads: number;
  sales: number;
  costPerLead: number | null;
  costPerSale: number | null;
};

/**
 * Custo por lead e por venda, por campanha.
 *
 * O cruzamento usa `leads.campaign_id`, que o `meta-ads-webhook` grava com o id
 * externo da campanha — o mesmo `external_id` de `ad_campaigns`. Sem esse
 * casamento o investimento fica solto do resultado, que é a pergunta que o
 * marketing faz.
 */
export async function campaignPerformance(): Promise<CampaignPerformance[]> {
  const [campaigns, leadRows] = await Promise.all([
    listAdCampaigns(),
    supabase.from("leads").select("campaign_id,converted_at"),
  ]);
  if (leadRows.error) throw dbError("ler leads das campanhas", leadRows.error);

  const leads = (leadRows.data ?? []) as { campaign_id: string | null; converted_at: string | null }[];

  return campaigns.map((c) => {
    const mine = leads.filter((l) => l.campaign_id === c.external_id);
    // Conversão do lead é `converted_at`; não existe FK para o negócio aqui.
    const sales = mine.filter((l) => l.converted_at !== null).length;
    const spend = Number(c.total_spend ?? 0);
    return {
      campaignId: c.id,
      campaignName: c.name,
      totalSpend: spend,
      leads: mine.length,
      sales,
      // Divisão por zero vira null: "R$ 0,00 por lead" mentiria sobre campanha
      // sem lead nenhum.
      costPerLead: mine.length > 0 ? spend / mine.length : null,
      costPerSale: sales > 0 ? spend / sales : null,
    };
  });
}

// -----------------------------------------------------------------------------
// Trilha de auditoria
// -----------------------------------------------------------------------------

export type HistoryEntry = {
  id: string;
  actor_id: string | null;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

/** Log imutável do negócio — escrito por `deals_log_changes` (SECURITY DEFINER). */
export async function listDealHistory(dealId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("deal_history")
    .select("id,actor_id,kind,from_value,to_value,detail,created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw dbError("histórico do negócio", error);
  return (data ?? []) as HistoryEntry[];
}

export async function listCcaCaseEvents(caseId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("cca_case_events")
    .select("id,actor_id,kind,from_value,to_value,detail,created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (error) throw dbError("eventos do caso CCA", error);
  return (data ?? []) as HistoryEntry[];
}
