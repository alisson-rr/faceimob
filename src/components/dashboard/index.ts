/**
 * Blocos do Dashboard. A tela (`src/pages/Dashboard.tsx`) e composicao destes —
 * antes eram 918 linhas num arquivo so, com sete graficos e quatro paletas.
 */
export { BarList, type BarListProps, type BarListRow } from "./BarList";
export { KpiRow, type KpiRowProps } from "./KpiRow";
export { DeveloperOverview, DeveloperRanking } from "./DeveloperOverview";
export { SalesFunnelCard, type SalesFunnelCardProps } from "./SalesFunnelCard";
export { GoalCard, type GoalCardProps } from "./GoalCard";
export { TopBrokers, type TopBrokersProps } from "./TopBrokers";
export { MonthlyTrend } from "./MonthlyTrend";
export { LeadsPanel } from "./LeadsPanel";
export { CcaStatusCard, StaffCard } from "./Breakdown";
export {
  ALL_MONTHS,
  previousMonth,
  useDashboardLeads,
  useDashboardPayload,
  useMonthView,
  useMonthlySeries,
  useSalesGoal,
  type DealRow,
  type DeveloperStats,
  type MonthStats,
  type MonthlySeries,
  type RankRow,
} from "./data";
