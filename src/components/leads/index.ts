/**
 * Blocos da tela de Leads. A página é composição; a regra de cada bloco mora
 * aqui — a documentação visual está em `docs/design-system.md`.
 */
export {
  leadDetailKey,
  leadKeys,
  useAssignableBrokers,
  useAutomationSettings,
  useDeveloperProjects,
  useDevelopers,
  useInvalidateLeads,
  useLeadSources,
  useLeadDetail,
  useLeads,
  useLeadsRealtime,
  useNowTicker,
  useOpenLeads,
  useTimeoutReleasesToday,
  useWhatsappTemplates,
} from "./data";

export { ConvertLeadDialog } from "./ConvertLeadDialog";
export { LeadDialogs } from "./LeadDialogs";
export { FileDropzone } from "./FileDropzone";
export { LeadFilters } from "./LeadFilters";
export { LeadFormDialog } from "./LeadFormDialog";
export { LeadImportDialog } from "./LeadImportDialog";
export { LeadsSummary } from "./LeadsSummary";
export { LeadsTable, type LeadRowActions } from "./LeadsTable";
export { EmailDialog, WhatsAppDialog } from "./OutreachDialogs";
export { OverdueLeadsCard } from "./OverdueLeadsCard";
export { ReassignLeadDialog } from "./ReassignLeadDialog";
export { SourcePerformanceCard } from "./SourcePerformanceCard";
export { ImportError, MAX_IMPORT_ROWS, parseSheet, rowsToLeads } from "./importSheet";
export {
  emptyLeadFilters, hasActiveFilter, leadMetrics, matchesFilters, noLeadDialogs, waNumber,
  type LeadDialogState, type LeadFilterState, type LeadMetrics,
} from "./model";
