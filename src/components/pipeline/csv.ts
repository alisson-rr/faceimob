import { date as formatDate } from "@/lib/format";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { dealMonth } from "./filters";

const HEADERS = [
  "Código", "Cliente", "Construtora", "Empreendimento", "Unidade", "Etapa",
  "Status 2", "VGV", "Dias", "Corretor 1", "Gerente 1", "Mês-base",
];

/** Aspas duplicadas: cliente com vírgula no nome quebrava a coluna seguinte. */
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function dealsCsv(deals: LegacyDealRecord[]): string {
  const rows = deals.map((deal) => [
    deal.code, deal.client, deal.developer, deal.project, deal.unit,
    deal.stage_label, deal.status, deal.deal_value, deal.days_in_pipeline,
    deal.broker1, deal.manager1, dealMonth(deal),
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
