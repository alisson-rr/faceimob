/**
 * Blocos do Pipeline e da esteira CCA.
 *
 * `Pipeline.tsx` tinha 1375 linhas, 44 `useState` e 26 toasts (achado A02);
 * `CcaPipeline.tsx`, 408. Cada bloco daqui é dono do próprio estado — a tela só
 * guarda o que precisa ser compartilhado.
 */

// ── Pipeline ────────────────────────────────────────────────────────────────
export { CheckinQueueBar } from "./CheckinQueueBar";
export { CloseMonthDialog } from "./CloseMonthDialog";
export { DealCard } from "./DealCard";
export { DealCcaPanel } from "./DealCcaPanel";
export { DealCommentsPanel } from "./DealCommentsPanel";
export { DealFilters } from "./DealFilters";
export { DealForm } from "./DealForm";
export { DealsBoard } from "./DealsBoard";
export { DealsKanban } from "./DealsKanban";
export { DealsTable } from "./DealsTable";
export { DealsToolbar } from "./DealsToolbar";
export { LoseDealDialog } from "./LoseDealDialog";
export { PipelineAnalytics } from "./PipelineAnalytics";
export { ScheduleVisitDialog } from "./ScheduleVisitDialog";
export { ChoiceField, PersonField, Section, TextField } from "./fields";

// ── CCA ─────────────────────────────────────────────────────────────────────
export { CcaBoard } from "./CcaBoard";
export { CcaMoveDialog } from "./CcaMoveDialog";
export { CcaStageSettingsDialog } from "./CcaStageSettingsDialog";
export {
  ccaKeys, loadCcaBoard, saveCcaAnalysis, useCcaBoard, useInvalidateCcaBoard,
  type CcaAnalysis, type CcaDeal, type CcaStage,
} from "./ccaData";
export {
  CCA_STATUS_OPTIONS, CCA_TONE_CLASS, CCA_TONE_OPTIONS, ccaStageTone,
  ccaStatusLabel, isDecision, type CcaCaseStatus,
} from "./ccaStage";

// ── Dados e regras ──────────────────────────────────────────────────────────
export {
  pipelineKeys, useCheckinQueue, useClosedMonths, useDeals, useDealsRealtime,
  useDevelopers, useInvalidateDeals, useOpenSeason, usePeople, usePipelineStages,
} from "./data";
export { dealsCsv, downloadDealsCsv } from "./csv";
export {
  ALL, EMPTY_FILTERS, applyDealFilters, dealMonth, hasActiveFilter, sortDeals,
  type DealFilterState,
} from "./filters";
export { DOCUMENT_REVIEW_META } from "./review";
export {
  LOST_STAGE_CODE, funnelStages, stageLabelOf, stageSurface, stageTone,
  type PipelineStage,
} from "./stages";
export {
  FACEIMOB_STATUSES, STATUS_TONE_CLASS, faceimobStatusRank, faceimobStatusTone,
  statusChoices, type FaceimobStatus,
} from "./statuses";
