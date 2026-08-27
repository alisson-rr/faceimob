import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BarChart3, Inbox, Plus, Upload, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader, SectionCard } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import LeadDetailModal from "@/components/LeadDetailModal";
import {
  LeadDialogs, LeadFilters, LeadsSummary, LeadsTable, OverdueLeadsCard, SourcePerformanceCard,
  emptyLeadFilters, hasActiveFilter, leadMetrics, matchesFilters, noLeadDialogs,
  useAssignableBrokers, useAutomationSettings, useInvalidateLeads, useLeadSources,
  useLeads, useLeadsRealtime, useNowTicker, useWhatsappTemplates,
  type LeadDialogState, type LeadRowActions,
} from "@/components/leads";
import { claimLead, isLeadOverdue, type LeadRecord } from "@/integrations/supabase/leads";

const GESTOR_ROLES = ["admin", "director", "manager", "marketing"];

/**
 * Leads — a lista da operação.
 *
 * A tela é composição: cada bloco vive em `@/components/leads` e carrega o que
 * precisa por `useQuery`. Aqui ficam só o estado de filtro, qual diálogo está
 * aberto e as ações que mexem na lista inteira.
 */
export default function Leads() {
  const { user, role, profile } = useAuth();
  const profileId = user?.id || null;
  const isGestor = GESTOR_ROLES.includes(role);

  const leadsQuery = useLeads();
  const sourcesQuery = useLeadSources();
  const brokersQuery = useAssignableBrokers(isGestor);
  const settingsQuery = useAutomationSettings();
  const templatesQuery = useWhatsappTemplates();
  const invalidateLeads = useInvalidateLeads();
  useLeadsRealtime();

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data]);

  // O tique de 1s só vale enquanto existe trava correndo; fora disso um passo
  // lento basta para "atrasado" e "inativo".
  const now = useNowTicker(leads.some((lead) => lead.status === "assigned" && lead.attend_deadline));

  const [filters, setFilters] = useState(emptyLeadFilters);
  const [showSources, setShowSources] = useState(false);
  const [detailLeadId, setDetailLeadId] = useState<string | null>(null);
  const [dialogs, setDialogs] = useState<LeadDialogState>(noLeadDialogs);
  const openDialog = (patch: Partial<LeadDialogState>) => setDialogs((prev) => ({ ...prev, ...patch }));

  const [searchParams, setSearchParams] = useSearchParams();
  const focusLeadId = searchParams.get("lead");

  // Falha nas cargas auxiliares deixava filtros e selects vazios em silêncio.
  // Um aviso discreto avisa sem bloquear a lista, que é o que importa aqui.
  const auxErrors = [
    sourcesQuery.error ? "origens" : null,
    isGestor && brokersQuery.error ? "corretores" : null,
    templatesQuery.error ? "templates de WhatsApp" : null,
  ].filter((item): item is string => Boolean(item));

  const filtered = useMemo(() => leads.filter((lead) => matchesFilters(lead, filters)), [leads, filters]);
  const metrics = useMemo(() => leadMetrics(leads, now), [leads, now]);
  const overdueLeads = useMemo(() => leads.filter((lead) => isLeadOverdue(lead, now)), [leads, now]);

  // A notificação de lead atribuído aponta para o lead: `notify_lead_assigned`
  // grava `/leads/<id>` (rota inexistente) e o sino normaliza para
  // `/leads?lead=<id>`. O parâmetro é instrução de navegação, não estado da
  // tela: consumir na hora evita reabrir o modal que o corretor fechou a cada
  // recarga do realtime, e deixa a mesma notificação funcionar de novo depois.
  useEffect(() => {
    if (!focusLeadId || leadsQuery.isPending) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("lead");
      return next;
    }, { replace: true });
    if (leads.some((lead) => lead.id === focusLeadId)) {
      setDetailLeadId(focusLeadId);
    } else {
      toast({
        title: "Lead indisponível",
        description: "Ele pode ter voltado para a fila ou sido realocado para outro corretor.",
      });
    }
  }, [focusLeadId, leadsQuery.isPending, leads, setSearchParams]);

  // Deriva da lista para o modal acompanhar o realtime em vez de congelar uma cópia.
  const detailLead = useMemo(
    () => leads.find((lead) => lead.id === detailLeadId) ?? null,
    [leads, detailLeadId],
  );

  // "Atender": trava o lead com o corretor (`claim_lead`) e para o cronômetro.
  // O toast e o som de comemoração saem do realtime de `lead_events` no
  // EngagementLayer — chamar `celebrate()` aqui tocaria o som duas vezes.
  const attend = async (lead: LeadRecord) => {
    try {
      await claimLead(lead.id);
      toast({ title: "Lead em atendimento", description: `${lead.name} está travado com você.` });
    } catch (err) {
      // Caso comum: outro corretor assumiu antes, ou o prazo estourou e o lead
      // voltou à fila.
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: describeError(err, "outro corretor pode ter assumido antes; a lista já foi atualizada"),
      });
    }
    await invalidateLeads();
  };

  const actions: LeadRowActions = {
    onOpen: (lead) => setDetailLeadId(lead.id),
    onAttend: attend,
    onEdit: (lead) => openDialog({ form: { open: true, lead } }),
    onReassign: (lead) => openDialog({ reassign: lead }),
    onConvert: (lead) => openDialog({ convert: lead }),
    onWhatsApp: (lead) => openDialog({ whatsapp: lead }),
    onEmail: (lead) => openDialog({ email: lead }),
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leads"
        eyebrow="Operação"
        icon={Zap}
        description={
          leadsQuery.isPending
            ? "A roleta distribui os leads entre quem está com check-in aberto."
            : `${num(filtered.length)} de ${num(metrics.total)} leads · a roleta distribui entre quem está com check-in aberto.`
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowSources((open) => !open)}>
              <BarChart3 className="h-4 w-4" /> {showSources ? "Ocultar origens" : "Origens"}
            </Button>
            {isGestor && (
              <>
                <Button variant="outline" size="sm" onClick={() => openDialog({ import: true })}>
                  <Upload className="h-4 w-4" /> Importar planilha
                </Button>
                <Button size="sm" onClick={() => openDialog({ form: { open: true, lead: null } })}>
                  <Plus className="h-4 w-4" /> Novo lead
                </Button>
              </>
            )}
          </>
        }
      />

      {auxErrors.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>Parte dos filtros não carregou ({auxErrors.join(", ")}). A lista de leads continua correta.</span>
        </p>
      )}

      {leadsQuery.error ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar os leads"
          description={describeError(leadsQuery.error, "a lista não respondeu; verifique a conexão e tente de novo")}
          action={<Button onClick={() => void leadsQuery.refetch()}>Tentar de novo</Button>}
        />
      ) : leadsQuery.isPending ? (
        <>
          <LoadingState variant="kpi" rows={5} label="Carregando indicadores de leads…" />
          <LoadingState variant="table" rows={6} label="Carregando a lista de leads…" />
        </>
      ) : (
        <>
          <LeadsSummary metrics={metrics} />

          {showSources && <SourcePerformanceCard leads={leads} />}

          <OverdueLeadsCard
            leads={overdueLeads}
            threshold={settingsQuery.data?.overdue_block_threshold ?? 20}
            onOpen={(lead) => setDetailLeadId(lead.id)}
          />

          <SectionCard
            title="Lista de leads"
            description="Clique no nome do cliente para abrir o histórico completo."
            icon={Users}
            flush={filtered.length > 0}
          >
            <div className={filtered.length > 0 ? "border-b border-border p-4" : "pb-4"}>
              <LeadFilters filters={filters} onChange={setFilters} sources={sources} />
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={hasActiveFilter(filters) ? "Nenhum lead com esses filtros" : "Nenhum lead ainda"}
                description={
                  hasActiveFilter(filters)
                    ? "Tente outro termo de busca ou volte para todos os status e origens."
                    : "Assim que a Leadfy ou o Meta Ads entregarem um lead, ele aparece aqui e entra na roleta."
                }
                action={
                  hasActiveFilter(filters)
                    ? <Button variant="outline" onClick={() => setFilters(emptyLeadFilters)}>Limpar filtros</Button>
                    : isGestor
                      ? <Button onClick={() => openDialog({ form: { open: true, lead: null } })}>Novo lead</Button>
                      : undefined
                }
              />
            ) : (
              <LeadsTable
                leads={filtered}
                now={now}
                profileId={profileId}
                isGestor={isGestor}
                actions={actions}
              />
            )}
          </SectionCard>
        </>
      )}

      <LeadDialogs
        state={dialogs}
        onClose={openDialog}
        sources={sources}
        brokers={brokersQuery.data ?? []}
        templates={templatesQuery.data ?? []}
      />

      {/* Detalhe do lead — pela lista e pela notificação (`?lead=<id>`). */}
      <LeadDetailModal
        lead={detailLead}
        open={!!detailLead}
        onOpenChange={(open) => { if (!open) setDetailLeadId(null); }}
        actorName={profile?.name || "Você"}
        onConvert={(lead) => { setDetailLeadId(null); openDialog({ convert: lead }); }}
        onStageChanged={() => void invalidateLeads()}
      />
    </div>
  );
}
