import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Filter, GitBranch, Plus, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { compareMonth, currentMonthBase } from "@/lib/dealStatus";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared";
import DealDetailModal from "@/components/DealDetailModal";
import LeadFunnel from "@/components/LeadFunnel";
import PipelineTopRanking from "@/components/PipelineTopRanking";
import { ConvertLeadDialog } from "@/components/leads/ConvertLeadDialog";
import { saveLegacyDeal, type LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { LeadRecord } from "@/integrations/supabase/leads";
import {
  CheckinQueueBar, CloseMonthDialog, DealFilters, DealsBoard, DealsToolbar,
  EMPTY_FILTERS, LoseDealDialog, PipelineAnalytics, ScheduleVisitDialog,
  applyDealFilters, dealMonth, downloadDealsCsv, hasActiveFilter, sortDeals,
  useClosedMonths, useDeals, useDealsRealtime, useDevelopers, useInvalidateDeals,
  useOpenSeason, usePeople, usePipelineStages,
  type DealFilterState,
} from "@/components/pipeline";
import { useDealActions } from "@/components/pipeline/useDealActions";

/** `null` = fechado · `{ deal: null }` = criando um negócio novo. */
type EditorState = { deal: LegacyDealRecord | null } | null;

/**
 * Pipeline de negócios.
 *
 * Tinha 1375 linhas, 44 `useState` e 26 toasts, com dois editores gravando o
 * mesmo registro (achado A02). Ficou a composição: os blocos vivem em
 * `@/components/pipeline`, cada um dono do próprio estado; aqui sobra o que
 * precisa ser compartilhado — o filtro (lido pela listagem e pelos indicadores)
 * e qual negócio está aberto.
 *
 * O editor é um só: o `DealDetailModal`, usado também para criar.
 *
 * **Nenhuma comemoração é disparada aqui.** O `EngagementLayer` já ouve
 * `game_events` e agrupa os INSERTs de uma venda rateada entre corretores;
 * chamar `celebrate("sale")` também nesta tela tocaria o som duas vezes e
 * quebraria o agrupamento.
 */
export default function Pipeline() {
  const { user, isAdmin } = useAuth();

  const [tab, setTab] = useState<"deals" | "leads">("deals");
  const [filters, setFilters] = useState<DealFilterState>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [editor, setEditor] = useState<EditorState>(null);
  const [visitDeal, setVisitDeal] = useState<LegacyDealRecord | null>(null);
  const [losing, setLosing] = useState<{ deal: LegacyDealRecord; preset?: string } | null>(null);
  const [closeMonthOpen, setCloseMonthOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<LeadRecord | null>(null);

  const dealsQuery = useDeals();
  const stagesQuery = usePipelineStages();
  const peopleQuery = usePeople();
  const developersQuery = useDevelopers();
  const closedMonths = useClosedMonths();
  const openSeason = useOpenSeason();
  const invalidateDeals = useInvalidateDeals();
  useDealsRealtime();

  const deals = useMemo(() => dealsQuery.data ?? [], [dealsQuery.data]);
  const stages = useMemo(() => stagesQuery.data ?? [], [stagesQuery.data]);
  const people = useMemo(() => peopleQuery.data ?? [], [peopleQuery.data]);
  const developers = useMemo(() => developersQuery.data ?? [], [developersQuery.data]);

  const requestLoss = useCallback(
    (deal: LegacyDealRecord, preset: string) => setLosing({ deal, preset }),
    [],
  );
  const { moveDeal, changeStatus } = useDealActions({ stages, onNeedsLossConfirmation: requestLoss });

  const brokers = useMemo(
    () => people.filter((person) => person.active && person.roles.includes("broker")),
    [people],
  );
  const managers = useMemo(
    () => people.filter((person) => person.active
      && (person.roles.includes("manager") || person.roles.includes("director"))),
    [people],
  );
  /** Meses presentes nos negócios — o filtro de mês era campo de texto livre. */
  // `compareMonth` e não `sort()` de string: "12/2025" vem depois de "01/2026"
  // na ordem alfabética, e a lista abriria com o mês errado no topo.
  const months = useMemo(
    () => [...new Set(deals.map(dealMonth).filter(Boolean))].sort((a, b) => compareMonth(b, a)),
    [deals],
  );

  const visible = useMemo(() => sortDeals(applyDealFilters(deals, filters)), [deals, filters]);
  const activeCount = useMemo(() => visible.filter((deal) => deal.active).length, [visible]);
  const pendingReviews = deals.filter((deal) => deal.document_review_status === "pending").length;
  const vgv = deals.filter((deal) => deal.active).reduce((total, deal) => total + (deal.deal_value || 0), 0);

  // O mês do fechamento é o do ciclo aberto do game (migration 0032), não o do
  // relógio nem o que estiver no filtro.
  const seasonMonth = openSeason.data
    ? `${openSeason.data.period_start.slice(5, 7)}/${openSeason.data.period_start.slice(0, 4)}`
    : null;
  const monthIsClosed = Boolean(seasonMonth && (closedMonths.data ?? []).includes(seasonMonth));

  const patchFilters = (patch: Partial<DealFilterState>) =>
    setFilters((previous) => ({ ...previous, ...patch }));

  return (
    <div className="space-y-4">
      <PipelineTopRanking deals={deals} />

      <PageHeader
        title="Pipeline"
        eyebrow="Comercial"
        icon={GitBranch}
        description={`${activeCount} negócio(s) ativo(s) · ${brl(vgv)} em VGV.`}
        actions={
          tab === "deals" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowFilters((open) => !open)}>
                <Filter className="mr-1 h-4 w-4" /> Filtrar
              </Button>
              <Button size="sm" onClick={() => setEditor({ deal: null })}>
                <Plus className="mr-1 h-4 w-4" /> Adicionar negócio
              </Button>
              <Button variant="outline" size="sm" disabled={visible.length === 0} onClick={() => downloadDealsCsv(visible)}>
                <Download className="mr-1 h-4 w-4" /> Extrair CSV
              </Button>
              {isAdmin && (
                <Button variant="highlight" size="sm" disabled={monthIsClosed} onClick={() => setCloseMonthOpen(true)}>
                  <Target className="mr-1 h-4 w-4" />
                  {monthIsClosed ? `${seasonMonth} fechado` : "Fechar mês"}
                </Button>
              )}
            </>
          ) : (
            // Criar lead é da tela de Leads (achado F02): o botão daqui inseria
            // direto em `leads` com `status: 'queued'` e um `assigned_to` que a
            // roleta sobrescreve — e a policy só aceita gestor, então o corretor
            // levava erro de RLS num botão que a tela mostrava a ele.
            <Button variant="outline" size="sm" asChild>
              <Link to="/leads"><Users className="mr-1 h-4 w-4" /> Abrir tela de Leads</Link>
            </Button>
          )
        }
      />

      <div className="flex w-fit rounded-full border border-border p-0.5" role="tablist" aria-label="Seções do pipeline">
        {([["deals", "Negócios"], ["leads", "Leads"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <CheckinQueueBar />

      {tab === "deals" ? (
        <div className="flex flex-col gap-4 lg:flex-row">
          {showFilters && (
            <DealFilters
              filters={filters}
              onChange={patchFilters}
              onClear={() => setFilters(EMPTY_FILTERS)}
              onClose={() => setShowFilters(false)}
              stages={stages}
              developers={developers}
              brokers={brokers}
              managers={managers}
              months={months}
            />
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <DealsToolbar
              search={filters.search}
              onSearch={(search) => patchFilters({ search })}
              view={view}
              onView={setView}
              analyticsOpen={showAnalytics}
              onToggleAnalytics={() => setShowAnalytics((open) => !open)}
              activeCount={activeCount}
              listedCount={visible.length}
              pendingReviews={pendingReviews}
              onFilterPendingReviews={() => patchFilters({ documentReview: "pending" })}
            />

            <DealsBoard
              view={view}
              deals={visible}
              stages={stages}
              isPending={dealsQuery.isPending || stagesQuery.isPending}
              error={dealsQuery.error ?? stagesQuery.error}
              filtered={hasActiveFilter(filters)}
              onRetry={() => { void dealsQuery.refetch(); void stagesQuery.refetch(); }}
              onClearFilters={() => setFilters(EMPTY_FILTERS)}
              onNewDeal={() => setEditor({ deal: null })}
              onOpen={(deal) => setEditor({ deal })}
              onMove={moveDeal}
              onStatusChange={changeStatus}
              onScheduleVisit={setVisitDeal}
              onLose={(deal) => setLosing({ deal })}
            />
          </div>

          {showAnalytics && <PipelineAnalytics deals={deals} stages={stages} />}
        </div>
      ) : (
        <LeadFunnel actorName={user?.email || "Usuário"} onConvert={setConvertingLead} />
      )}

      {editor && (
        <DealDetailModal
          key={editor.deal?.id ?? "novo"}
          deal={editor.deal}
          open
          stages={stages}
          people={people}
          developers={developers}
          defaultMonth={seasonMonth ?? undefined}
          onClose={() => setEditor(null)}
          onReviewChanged={invalidateDeals}
          onSave={async (updated) => {
            await saveLegacyDeal(updated);
            await invalidateDeals();
            setEditor(null);
          }}
        />
      )}

      {visitDeal && (
        <ScheduleVisitDialog
          deal={visitDeal}
          stages={stages}
          onClose={() => setVisitDeal(null)}
          onScheduled={invalidateDeals}
        />
      )}

      {losing && (
        <LoseDealDialog
          deal={losing.deal}
          presetStatus={losing.preset}
          stages={stages}
          onClose={() => setLosing(null)}
          onConfirmed={invalidateDeals}
        />
      )}

      {closeMonthOpen && (
        <CloseMonthDialog
          season={openSeason.data ?? null}
          fallbackMonth={seasonMonth ?? months[0] ?? currentMonthBase()}
          onClose={() => setCloseMonthOpen(false)}
        />
      )}

      {convertingLead && (
        <ConvertLeadDialog
          lead={convertingLead}
          onClose={() => setConvertingLead(null)}
          onConverted={async () => { await invalidateDeals(); setTab("deals"); }}
        />
      )}
    </div>
  );
}
