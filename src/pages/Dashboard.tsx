import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Inbox, LayoutDashboard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import {
  ALL_MONTHS,
  CcaStatusCard,
  DeveloperOverview,
  DeveloperRanking,
  DirectorPanel,
  GoalCard,
  KpiRow,
  LeadsPanel,
  MonthlyTrend,
  SalesFunnelCard,
  StaffCard,
  TopBrokers,
  dashboardScope,
  leadsInMonth,
  useDashboardLeads,
  useDashboardPayload,
  useMonthView,
  useMonthlySeries,
  useSalesGoal,
  useVgvGoal,
  vazioTotal,
} from "@/components/dashboard";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";

/**
 * Primeira tela depois do login: a leitura do mes em indicadores, graficos e
 * ranking.
 *
 * Aqui so mora a composicao — filtro de periodo, abas e os estados de espera,
 * erro e vazio. Cada bloco vive em `@/components/dashboard`, e o carregamento
 * inteiro passa por `useQuery` (nenhum `useEffect` de dados nesta tela).
 *
 * O diretor abre ESTE painel, com uma aba a mais ("Diretoria") para o diario
 * declarado × pipeline medido. Antes ele era desviado para uma tela separada que
 * so tinha o comparativo: quem manda na operacao via menos numero que o corretor
 * que ele dirige, e nao havia caminho de volta.
 */
export default function Dashboard() {
  const [month, setMonth] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("geral");
  const { roles, previewRole, can } = useAuth();
  const queryClient = useQueryClient();
  // Mesmo padrao do `can()`: o papel previsualizado vem na frente.
  const effectiveRoles = previewRole ? [previewRole] : roles;
  // Todo o recorte por papel vive numa funcao pura testada (`dashboardScope`):
  // cada linha dela e o espelho de uma policy do banco, e espelho sem teste
  // racha calado. `leads.view_queue` entra porque a `leads_select` so libera
  // lead SEM DONO a quem tem a permissao — o socio enxerga todo perfil e ainda
  // assim ve uma base menor que a real.
  const recorte = useMemo(
    () => dashboardScope(effectiveRoles, can("leads.view_queue")),
    // `can` muda de identidade a cada matriz carregada; o que importa e o papel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveRoles.join(","), can],
  );
  const { seesEveryone, leadsIsWholeBase, seesAllCca, isDirector, canManageGoal } = recorte;
  // O gerente ganha a MESMA aba, com a equipe dele: `auth_led_team_ids()` casa
  // `teams.manager_id`, entao a RLS de `daily_reports`/`daily_entries` ja
  // liberava o diario para ele — faltava a tela que o pusesse ao lado do
  // medido. Sem isto o comparativo so existia para o gerente em /checkpoint.
  const isManager = effectiveRoles.includes("manager");
  const temAbaDeLideranca = isDirector || isManager;

  const { query, deals, months, monthsWithDeals, closedMonths, defaultMonth, payload } =
    useDashboardPayload();
  // Derivado, nao sincronizado: enquanto o usuario nao escolhe, vale o mes
  // aberto mais recente — e ele ja esta certo na primeira pintura.
  const activeMonth = month ?? defaultMonth;

  const view = useMonthView(deals, activeMonth);
  const monthly = useMonthlySeries(deals);
  const goal = useSalesGoal(activeMonth);
  const vgvGoal = useVgvGoal(activeMonth);
  const leadsQuery = useDashboardLeads();
  const leadsNoPeriodo = useMemo(
    () => (leadsQuery.data ? leadsInMonth(leadsQuery.data, activeMonth).length : null),
    [leadsQuery.data, activeMonth],
  );

  const isClosed = activeMonth !== ALL_MONTHS && closedMonths.includes(activeMonth);
  const periodo = activeMonth === ALL_MONTHS ? "todos os meses" : activeMonth;
  const atualizando = query.isFetching || leadsQuery.isFetching;

  const tabs: [string, string][] = [
    ["geral", "Visão geral"],
    ["propostas", "Propostas"],
    ["vendas", "Vendas"],
    ["leads", "Leads"],
    ["metas", "Metas"],
    ...(temAbaDeLideranca
      ? ([["diretoria", isDirector ? "Diretoria" : "Minha equipe"]] as [string, string][])
      : []),
  ];

  const goalCard = (
    <GoalCard
      month={activeMonth}
      vendas={view.stats.vendas}
      goal={goal.data?.target ?? null}
      // O palpite enquanto a consulta nao volta segue `can_read_all()`, nao
      // `auth_visible_profiles()`: o realizado embaixo do rotulo sai de `deals`,
      // e o diretor le os negocios de toda a empresa.
      scope={goal.data?.scope ?? (recorte.readsAllDeals ? "global" : "profile")}
      canManage={canManageGoal}
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
          {/* Sem isto a unica forma de ver dado novo era esperar os 60 s de
              `staleTime` (App.tsx) ou recarregar a pagina inteira. O prefixo
              "dashboard" cobre payload, leads, metas, etapas e a aba da
              diretoria — todas as chaves desta tela comecam por ele. */}
          <Button
            variant="outline"
            size="icon"
            aria-label="Recarregar o painel"
            title="Recarregar o painel"
            disabled={atualizando}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["dashboard"] })}
          >
            <RefreshCw className={`h-4 w-4 ${atualizando ? "animate-spin" : ""}`} aria-hidden />
          </Button>
          {activeMonth !== ALL_MONTHS && (
            <StatusBadge tone={isClosed ? "neutral" : "success"}>
              {isClosed ? "Mês fechado" : "Mês aberto"}
            </StatusBadge>
          )}
          <Select value={activeMonth} onValueChange={setMonth}>
            <SelectTrigger className="w-[210px]" aria-label="Filtrar por período">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_MONTHS}>Todos os meses</SelectItem>
              {/* O mes corrente entra na lista mesmo sem negocio (e nele que a
                  meta do mes e cadastrada); o rotulo diz que ele esta vazio, em
                  vez de deixar quem escolhe achar que o painel quebrou. */}
              {months.map((item) => (
                <SelectItem key={item} value={item}>
                  {closedMonths.includes(item)
                    ? `${item} · fechado`
                    : monthsWithDeals.has(item)
                      ? item
                      : `${item} · sem negócio`}
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

  // Negocio e lead saem recortados pela RLS (`can_see_deal` e `leads_select`),
  // entao zero aqui so prova que a BASE esta vazia para quem enxerga todo mundo.
  // Para o corretor recem-entrado na roleta o vazio e o dele, e afirmar que o
  // CRM esta vazio o deixava sem saber se era falta de permissao ou de lead.
  if (deals.length === 0 && !payload?.leadsCount) {
    return (
      <>
        {header}
        <EmptyState icon={Inbox} {...vazioTotal(recorte.readsAllDeals, leadsIsWholeBase)} />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="flex flex-col gap-5">
        <KpiRow
          stats={view.stats}
          leadsNoPeriodo={leadsNoPeriodo}
          leadsError={!!leadsQuery.error}
          onLeadsRetry={() => void leadsQuery.refetch()}
          // A LISTA, nao o `payload.leadsCount`: as duas contagens saem da mesma
          // `listLegacyLeads`, mas de consultas diferentes — se uma atualiza e a
          // outra ainda serve cache, o cartao "Base de leads" do topo diverge do
          // cartao de mesmo nome dentro da aba Leads.
          leadsNaBase={leadsQuery.data?.length ?? payload?.leadsCount ?? 0}
          dealsLabel={recorte.dealsLabel}
          leadsLabel={recorte.leadsLabel}
          month={activeMonth}
          vgvGoal={vgvGoal.data?.target ?? null}
          previous={view.previous}
          previousLabel={view.previousMonth}
        />

        {/* O conteudo de cada aba vai num <div> interno. `flex` direto no
            TabsContent empata em especificidade com o `[hidden]` da preflight
            do Tailwind, a utility vence, e a aba inativa fica exibida (vazia) —
            um `gap` de espaco morto por aba. */}
        {/* Se o papel mudar no meio (previsualizacao do admin), a aba da
            diretoria some — sem este desvio a area de conteudo ficaria em
            branco, com nenhuma aba marcada. */}
        <Tabs
          value={tab === "diretoria" && !temAbaDeLideranca ? "geral" : tab}
          onValueChange={setTab}
          className="flex flex-col gap-5"
        >
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList>
              {tabs.map(([value, label]) => (
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
              <CcaStatusCard counts={payload?.ccaCounts ?? {}} toda={seesAllCca} />
              {/* So quem enxerga todos os perfis: para corretor e gerente o card
                  contava o proprio recorte da RLS e dizia "Gerentes 0 · Diretores 0"
                  sob o titulo "Composicao da operacao hoje", enquanto a aba
                  Vendas listava esses mesmos gerentes e diretores no ranking. */}
              {payload && seesEveryone && <StaffCard staff={payload.staff} />}
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
            {/* `leadsIsWholeBase`, nao `seesEveryone`: enxergar todo PERFIL nao
                e enxergar todo LEAD. O socio passa em `auth_visible_profiles()`
                mas nao tem `leads.view_queue`, e a `leads_select` esconde dele o
                lead sem dono — com `toda` ligado ele lia "A base tem 69 leads"
                para uma base de 74, ao lado do rotulo que dizia o contrario. */}
            <LeadsPanel month={activeMonth} scopeLabel={recorte.leadsLabel} toda={leadsIsWholeBase} />
          </TabsContent>

          <TabsContent value="metas" className="mt-0">
            <div className="flex flex-col gap-5">
              {goalCard}
              <MonthlyTrend series={monthly} />
            </div>
          </TabsContent>

          {temAbaDeLideranca && (
            <TabsContent value="diretoria" className="mt-0">
              <DirectorPanel
                month={activeMonth}
                deals={deals}
                leads={leadsQuery}
                escopo={isDirector ? "diretoria" : "equipe"}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </>
  );
}
