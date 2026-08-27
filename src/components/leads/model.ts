/**
 * Regras puras da tela de Leads: filtro, indicadores e o número do WhatsApp.
 *
 * Ficam fora dos componentes por dois motivos: são o que dá para exercitar sem
 * DOM (`model.test.ts`) e, num `.tsx`, exportar função junto de componente
 * quebra o fast refresh do Vite.
 */
import { isLeadOverdue, type LeadRecord } from "@/integrations/supabase/leads";

export type LeadFilterState = {
  search: string;
  status: string;
  source: string;
};

export const emptyLeadFilters: LeadFilterState = { search: "", status: "all", source: "all" };

export const hasActiveFilter = (filters: LeadFilterState) =>
  Boolean(filters.search.trim()) || filters.status !== "all" || filters.source !== "all";

/**
 * Um lead passa no filtro quando casa com a busca, o status e a origem.
 *
 * A busca cobre nome, e-mail, telefone e campanha — o corretor procura pelo que
 * tem na mão, e nem sempre é o nome. `"none"` na origem é o lead sem origem
 * cadastrada, que não é o mesmo que "todas".
 */
export const matchesFilters = (lead: LeadRecord, filters: LeadFilterState): boolean => {
  const term = filters.search.trim().toLowerCase();
  const matchSearch = !term
    || lead.name.toLowerCase().includes(term)
    || (lead.email || "").toLowerCase().includes(term)
    || (lead.phone || "").includes(term)
    || (lead.campaign_name || "").toLowerCase().includes(term);
  const matchStatus = filters.status === "all" || lead.status === filters.status;
  const matchSource = filters.source === "all"
    || lead.source_id === filters.source
    || (filters.source === "none" && !lead.source_id);
  return matchSearch && matchStatus && matchSource;
};

export type LeadMetrics = {
  total: number;
  queued: number;
  attending: number;
  converted: number;
  overdue: number;
};

/**
 * Indicadores da régua. "Atrasado" é `isLeadOverdue`, a mesma definição de
 * `overdue_lead_count` — é essa conta que bloqueia o check-in, e uma heurística
 * de tela diferente mentiria sobre o motivo do bloqueio.
 */
export const leadMetrics = (leads: LeadRecord[], now: number): LeadMetrics => ({
  total: leads.length,
  queued: leads.filter((lead) => lead.status === "queued").length,
  attending: leads.filter((lead) => lead.status === "attending" || lead.status === "in_progress").length,
  converted: leads.filter((lead) => lead.status === "converted").length,
  overdue: leads.filter((lead) => isLeadOverdue(lead, now)).length,
});

/** Qual diálogo da tela de Leads está aberto e sobre qual lead. */
export type LeadDialogState = {
  /** `open` separado do lead porque "novo lead" abre o formulário sem lead. */
  form: { open: boolean; lead: LeadRecord | null };
  reassign: LeadRecord | null;
  convert: LeadRecord | null;
  whatsapp: LeadRecord | null;
  email: LeadRecord | null;
  import: boolean;
};

export const noLeadDialogs: LeadDialogState = {
  form: { open: false, lead: null },
  reassign: null, convert: null, whatsapp: null, email: null, import: false,
};

/** `wa.me` exige o número só com dígitos e com DDI; sem telefone, string vazia. */
export const waNumber = (phone?: string | null): string => {
  const digits = (phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("55") ? digits : `55${digits}`;
};
