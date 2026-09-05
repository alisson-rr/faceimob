/**
 * Blocos da tela de Leads. A página é composição; a regra de cada bloco mora
 * aqui — a documentação visual está em `docs/design-system.md`.
 */
export {
  leadDetailKey,
  leadKeys,
  useAssignableBrokers,
  useAutomationSettings,
  useDebounced,
  useDistributionGroups,
  useDeveloperProjects,
  useDevelopers,
  useInvalidateLeads,
  useLeadSources,
  useGroupQueues,
  useLeadDetail,
  useLeads,
  useLeadsRealtime,
  useNowTicker,
  useOpenLeads,
  useTimeoutReleasesToday,
  useWhatsappTemplates,
} from "./data";

export { CloseLeadDialog } from "./CloseLeadDialog";
export { ConvertLeadDialog } from "./ConvertLeadDialog";
export { DeleteLeadDialog } from "./DeleteLeadDialog";
export { LeadDialogs } from "./LeadDialogs";
export { NextActionDialog } from "./NextActionDialog";
export { RouletteHealthCard } from "./RouletteHealthCard";
export { FileDropzone } from "./FileDropzone";
export { LeadFilters } from "./LeadFilters";
export { LeadFormDialog } from "./LeadFormDialog";
export { LeadImportDialog } from "./LeadImportDialog";
export { LeadsSummary } from "./LeadsSummary";
export { LeadsTable, type LeadPermissions, type LeadRowActions } from "./LeadsTable";
export { EmailDialog, WhatsAppDialog } from "./OutreachDialogs";
export { OverdueLeadsCard } from "./OverdueLeadsCard";
export { ReassignLeadDialog } from "./ReassignLeadDialog";
export { SourcePerformanceCard } from "./SourcePerformanceCard";
export {
  COLUMN_LABELS, ImportError, MAX_IMPORT_ROWS, mapColumns, parseSheet, rowsToLeads, splitDuplicates,
  type ColumnMap,
} from "./importSheet";
export {
  emptyLeadFilters, hasActiveFilter, leadMetrics, matchesFilters, nextActionPreset, noLeadDialogs,
  overdueByBroker, toDateTimeInput, waNumber,
  type LeadDialogState, type LeadFilterState, type LeadMetrics, type OverdueByBroker,
} from "./model";
