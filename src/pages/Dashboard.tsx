import { useState } from "react";
import { AlertTriangle, Inbox, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import {
  ALL_MONTHS,
  CcaStatusCard,
  DeveloperOverview,
  DeveloperRanking,
  GoalCard,
  KpiRow,
  LeadsPanel,
  MonthlyTrend,
  SalesFunnelCard,
  StaffCard,
  TopBrokers,
  useDashboardPayload,
  useMonthView,
  useMonthlySeries,
  useSalesGoal,
} from "@/components/dashboard";
import { describeError } from "@/lib/supabaseError";

const TABS = [
  ["geral", "Visão geral"],
  ["propostas", "Propostas"],
  ["vendas", "Vendas"],
  ["leads", "Leads"],
  ["metas", "Metas"],
] as const;

/**
 * Primeira tela depois do login: a leitura do mes em indicadores, graficos e
 * ranking.
 *
 * Aqui so mora a composicao — filtro de periodo, abas e os estados de espera,
 * erro e vazio. Cada bloco vive em `@/components/dashboard`, e o carregamento
 * inteiro passa por `useQuery` (nenhum `useEffect` de dados nesta tela).
 */
export default function Dashboard() {
  const [month, setMonth] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("geral");

  const { query, deals, months, closedMonths, defaultMonth, payload } = useDashboardPayload();
  // Derivado, nao sincronizado: enquanto o usuario nao escolhe, vale o mes
  // aberto mais recente — e ele ja esta certo na primeira pintura.
  const activeMonth = month ?? defaultMonth;

  const view = useMonthView(deals, activeMonth);
  const monthly = useMonthlySeries(deals);
  const goal = useSalesGoal(activeMonth);

  const isClosed = activeMonth !== ALL_MONTHS && closedMonths.includes(activeMonth);
  const periodo = activeMonth === ALL_MONTHS ? "todos os meses" : activeMonth;

  const goalCard = (
    <GoalCard
      month={activeMonth}
      vendas={view.stats.vendas}
      goal={goal.data}
      isLoading={goal.isLoading}
      error={goal.error ? describeError(goal.error, "A consulta da meta falhou.") : null}
      onRetry={() => void goal.refetch()}
    />
  );

  const header = (
    <PageHeader
      title="Dashboard"
      eyebrow="Visão geral"
      icon={LayoutDashboard}
      description={`Indicadores, esteira e ranking da operação — ${periodo}.`}
      actions={
        <>
          {activeMonth !== ALL_MONTHS && (
            <StatusBadge tone={isClosed ? "neutral" : "success"}>
              {isClosed ? "Mês fechado" : "Mês aberto"}
            </StatusBadge>
          )}
          <Select value={activeMonth} onValueChange={setMonth}>
            <SelectTrigger className="w-[190px]" aria-label="Filtrar por período">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_MONTHS}>Todos os meses</SelectItem>
              {months.map((item) => (
                <SelectItem key={item} value={item}>
                  {closedMonths.includes(item) ? `${item} · fechado` : item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
    />
  );

  if (query.isPending) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-5">
          <LoadingState variant="kpi" rows={6} label="Carregando os indicadores do painel…" />
          <LoadingState variant="block" />
        </div>
      </>
    );
  }

  if (query.isError) {
    return (
      <>
        {header}
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar o painel"
          description={describeError(
            query.error,
            "A consulta dos negócios falhou. Verifique a conexão e tente de novo.",
          )}
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      </>
    );
  }

  if (deals.length === 0 && !payload?.leadsCount) {
    return (
      <>
        {header}
        <EmptyState
          icon={Inbox}
          title="A base ainda está vazia"
          description="Não há negócio nem lead cadastrado. Assim que o primeiro entrar — pela roleta ou pelo pipeline — os indicadores aparecem aqui."
        />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="flex flex-col gap-5">
        <KpiRow
          stats={view.stats}
          leads={payload?.leadsCount ?? 0}
          previous={view.previous}
          previousLabel={view.previousMonth}
        />

        {/* O conteudo de cada aba vai num <div> interno. `flex` direto no
            TabsContent empata em especificidade com o `[hidden]` da preflight
            do Tailwind, a utility vence, e a aba inativa fica exibida (vazia) —
            um `gap` de espaco morto por aba. */}
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-5">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList>
              {TABS.map(([value, label]) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="geral" className="mt-0">
            <div className="flex flex-col gap-5">
              {/* `items-start` para o card de meta nao esticar ate a altura da esteira. */}
              <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
                {goalCard}
                <SalesFunnelCard stageCounts={view.stageCounts} />
              </div>
              <DeveloperOverview rows={view.developers} />
            </div>
          </TabsContent>

          <TabsContent value="propostas" className="mt-0">
            <div className="flex flex-col gap-5">
              <DeveloperRanking rows={view.developers} />
              <CcaStatusCard counts={payload?.ccaCounts ?? {}} />
              {payload && <StaffCard staff={payload.staff} />}
            </div>
          </TabsContent>

          <TabsContent value="vendas" className="mt-0">
            <div className="flex flex-col gap-5">
              <TopBrokers
                title="Ranking de corretores"
                description="Vendas fechadas no período, do maior para o menor"
                rows={view.brokers}
                scroll
              />
              <TopBrokers
                title="Ranking de gerentes"
                description="Vendas das equipes no período"
                rows={view.managers}
              />
              <TopBrokers
                title="Ranking de diretores"
                description="Vendas das diretorias no período"
                rows={view.directors}
              />
            </div>
          </TabsContent>

          <TabsContent value="leads" className="mt-0">
            <LeadsPanel />
          </TabsContent>

          <TabsContent value="metas" className="mt-0">
            <div className="flex flex-col gap-5">
              {goalCard}
              <MonthlyTrend series={monthly} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
