/**
 * Blocos do Dashboard. A tela (`src/pages/Dashboard.tsx`) e composicao destes —
 * antes eram 918 linhas num arquivo so, com sete graficos e quatro paletas.
 */
export { BarList, type BarListProps, type BarListRow } from "./BarList";
export { ChartData, type ChartDataProps } from "./ChartData";
export { KpiRow, type KpiRowProps } from "./KpiRow";
export { DeveloperOverview, DeveloperRanking } from "./DeveloperOverview";
export { SalesFunnelCard, type SalesFunnelCardProps } from "./SalesFunnelCard";
export { GoalCard, type GoalCardProps } from "./GoalCard";
export { TopBrokers, type TopBrokersProps } from "./TopBrokers";
export { MonthlyTrend } from "./MonthlyTrend";
export { LeadsPanel, type LeadsPanelProps } from "./LeadsPanel";
export { CcaStatusCard, StaffCard } from "./Breakdown";
export { DirectorPanel, type DirectorPanelProps } from "./DirectorPanel";
export {
  ALL_MONTHS,
  GOAL_SCOPE_LABEL,
  dashboardScope,
  dealCategory,
  defaultMonthOf,
  funnelRows,
  leadsInMonth,
  monthOptions,
  monthView,
  monthlySeries,
  perdaIds,
  pickSalesGoal,
  previousMonth,
  rankBy,
  readsAllDeals,
  useDashboardLeads,
  useDashboardPayload,
  useFunnelStages,
  useGoal,
  useMonthView,
  useMonthlySeries,
  useSalesGoal,
  useVgvGoal,
  vazioTotal,
  type DashboardScope,
  type DealCategory,
  type DealRow,
  type DeveloperStats,
  type GoalMetric,
  type GoalScope,
  type MonthStats,
  type MonthView,
  type MonthlySeries,
  type RankRole,
  type RankRow,
  type SalesGoal,
} from "./data";
