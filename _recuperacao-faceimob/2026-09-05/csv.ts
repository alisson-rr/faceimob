import { date as formatDate } from "@/lib/format";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { dealMonth } from "./filters";

const HEADERS = [
  "Código", "Cliente", "Construtora", "Empreendimento", "Unidade", "Etapa",
  "Status 2", "VGV", "Dias", "Corretor 1", "% Corretor 1", "VGV Corretor 1",
  "Corretor 2", "% Corretor 2", "VGV Corretor 2",
  "Corretor 3", "% Corretor 3", "VGV Corretor 3",
  "Gerente 1", "Mês-base",
];

/** Aspas duplicadas: cliente com vírgula no nome quebrava a coluna seguinte. */
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/** Fatia do participante em reais — o número que a conferência de comissão usa.
 *
 *  Vazio (e não zero) quando não há corretor no slot ou quando o rateio ainda
 *  não foi calculado: zero afirmaria "este corretor não leva nada". */
export const shareValue = (value: number, share?: number | null) =>
  share == null ? "" : Math.round((value || 0) * Number(share)) / 100;

/**
 * Recorte filtrado da tela em CSV.
 *
 * O rateio (`deal_participants.share_pct`, calculado por `recalc_deal_shares`)
 * entrou aqui porque só existia dentro do modal, ao lado do nome do corretor:
 * quem precisava conferir a comissão do mês abria negócio por negócio. Com as
 * colunas de percentual e de VGV por corretor, o fechamento do mês vira uma
 * planilha só.
 */
export function dealsCsv(deals: LegacyDealRecord[]): string {
  const rows = deals.map((deal) => [
    deal.code, deal.client, deal.developer, deal.project, deal.unit,
    deal.stage_label, deal.status, deal.deal_value, deal.days_in_pipeline,
    deal.broker1, deal.broker1_share ?? "", shareValue(deal.deal_value, deal.broker1_share),
    deal.broker2, deal.broker2_share ?? "", shareValue(deal.deal_value, deal.broker2_share),
    deal.broker3, deal.broker3_share ?? "", shareValue(deal.deal_value, deal.broker3_share),
    deal.manager1, dealMonth(deal),
  ].map(cell).join(","));
  return [HEADERS.map(cell).join(","), ...rows].join("\n");
}

/** BOM na frente para o Excel abrir em UTF-8 sem trocar os acentos. */
export function downloadDealsCsv(deals: LegacyDealRecord[]): void {
  const blob = new Blob([`\uFEFF${dealsCsv(deals)}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `pipeline_${formatDate(new Date()).replace(/\//g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
