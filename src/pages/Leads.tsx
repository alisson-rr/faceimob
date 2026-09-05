import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BarChart3, Inbox, Plus, Upload, Users, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, PageHeader, SectionCard } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { useAuth, type AppRole } from "@/contexts/AuthContext";
import LeadDetailModal from "@/components/LeadDetailModal";
import {
  LeadDialogs, LeadFilters, LeadsSummary, LeadsTable, OverdueLeadsCard, RouletteHealthCard,
  SourcePerformanceCard,
  emptyLeadFilters, hasActiveFilter, leadMetrics, matchesFilters, noLeadDialogs,
  useAssignableBrokers, useAutomationSettings, useDebounced, useDistributionGroups, useGroupQueues,
  useInvalidateLeads, useLeadSources,
  useLeads, useLeadsRealtime, useNowTicker, useWhatsappTemplates,
  type LeadDialogState, type LeadPermissions, type LeadRowActions,
} from "@/components/leads";
import {
  canWriteLead, claimLead, distributeQueuedLead, isLeadOverdue, isLeadUnattended, LEADS_PAGE_SIZE,
  type LeadRecord,
} from "@/integrations/supabase/leads";

/**
 * Papéis que a policy `leads_insert` aceita. É a lista do banco, não uma
 * escolha da tela: quem não está aqui recebe 42501 ao gravar, então o botão de
 * "Novo lead" e o de importação não aparecem para ele. O SDR entra porque a
 * policy o aceita — é ele quem cadastra o lead que a IA qualificou.
 */
const LEAD_INSERT_ROLES: AppRole[] = ["admin", "director", "manager", "marketing", "sdr"];

/**
 * Leads — a lista da operação.
 *
 * A tela é composição: cada bloco vive em `@/components/leads` e carrega o que
 * precisa por `useQuery`. Aqui ficam só o estado de filtro, qual diálogo está
 * aberto e as ações que mexem na lista inteira.
 *
 * Quem pode o quê sai de `can()` (a matriz de `role_permissions`, a mesma que o
 * banco lê) e de `canWriteLead` — nunca de uma lista fixa de papéis dentro do
 * componente. Era `GESTOR_ROLES.includes(role)`: o sócio ganhava Editar e
 * Converter em leads que não são dele e descobria a recusa depois do clique, o
 * marketing aparecia na lista sem ter `menu.leads`, e desligar "Realocar leads"
 * na matriz não tirava o botão da tela.
 */
export default function Leads() {
  const { user, roles, previewRole, isAdmin, can, profile } = useAuth();
  const profileId = user?.id || null;

  // Pré-visualizar papel precisa mudar esta tela como muda o menu: sem isto o
  // admin em preview "broker" continuava com os três botões de gestor.
  const effectiveRoles = useMemo<AppRole[]>(
    () => (previewRole ? [previewRole] : roles),
    [previewRole, roles],
  );
  const canInsertLead = isAdmin || effectiveRoles.some((role) => LEAD_INSERT_ROLES.includes(role));
  const canReassign = can("leads.reassign");
  const canViewQueue = can("leads.view_queue");
  const canDelete = can("leads.delete");

  const [filters, setFilters] = useState(emptyLeadFilters);
  // A busca vai ao BANCO: a lista trunca em `LEADS_PAGE_SIZE` e filtrar no
  // cliente deixava o lead antigo inalcançável por qualquer termo. O atraso
  // evita uma consulta por tecla.
  const buscaNoBanco = useDebounced(filters.search);

  const leadsQuery = useLeads(buscaNoBanco);
  // Duas leituras de propósito. `leadsQuery` é o RECORTE da busca e alimenta só
  // a tabela; os cards acima dela (régua de KPIs, atrasados, saúde da roleta,
  // "sem atendimento") são o panorama e não podem mudar porque alguém digitou
  // três letras no campo que fica dentro do card de baixo — o corretor com 20
  // atrasados via "Tudo em dia · nada aqui bloqueia o seu check-in" ao buscar um
  // termo sem correspondência. Sem busca, `useLeads("")` é a MESMA entrada de
  // cache de `leadsQuery`: custo zero no caso comum.
  const baseQuery = useLeads("");
  const sourcesQuery = useLeadSources();
  const brokersQuery = useAssignableBrokers(canReassign);
  const groupsQuery = useDistributionGroups();
  const settingsQuery = useAutomationSettings();
  const templatesQuery = useWhatsappTemplates();
  const queuesQuery = useGroupQueues(canViewQueue);
  const invalidateLeads = useInvalidateLeads();
  useLeadsRealtime();

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  /** Panorama: a base inteira, sem o recorte da busca. */
  const base = useMemo(() => baseQuery.data ?? [], [baseQuery.data]);
  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data]);

  // O tique de 1s só vale enquanto existe trava correndo; fora disso um passo
  // lento basta para "atrasado" e "inativo". Olha as duas listas: com uma busca
  // ativa o cronômetro pode estar num lead que só o recorte trouxe.
  const temTrava = (lista: LeadRecord[]) =>
    lista.some((lead) => lead.status === "assigned" && lead.attend_deadline);
  const now = useNowTicker(temTrava(leads) || temTrava(base));

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
    canReassign && brokersQuery.error ? "corretores" : null,
    groupsQuery.error ? "grupos de distribuição" : null,
    templatesQuery.error ? "templates de WhatsApp" : null,
  ].filter((item): item is string => Boolean(item));

  const filtered = useMemo(() => leads.filter((lead) => matchesFilters(lead, filters)), [leads, filters]);
  const metrics = useMemo(() => leadMetrics(base, now, profileId), [base, now, profileId]);
  const overdueLeads = useMemo(() => base.filter((lead) => isLeadOverdue(lead, now)), [base, now]);
  const queuedLeads = useMemo(() => base.filter((lead) => lead.status === "queued"), [base]);
  const maxRounds = settingsQuery.data?.roulette_max_rounds ?? 5;
  // A bandeja é do gestor, mas o número precisa aparecer no cabeçalho: um lead
  // fora da roleta não volta sozinho, e ninguém abre um card por hábito.
  const semAtendimento = useMemo(
    () => base.filter((lead) => isLeadUnattended(lead, maxRounds)).length,
    [base, maxRounds],
  );

  const permissions = useMemo<LeadPermissions>(() => ({
    canWrite: (lead) => canWriteLead(lead, {
      profileId, isAdmin, managesTeam: canReassign, canViewQueue,
    }),
    canReassign,
    canDelete,
  }), [profileId, isAdmin, canReassign, canViewQueue, canDelete]);

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
    if (base.some((lead) => lead.id === focusLeadId) || leads.some((lead) => lead.id === focusLeadId)) {
      setDetailLeadId(focusLeadId);
    } else {
      toast({
        title: "Lead indisponível",
        description: "Ele pode ter voltado para a fila ou sido realocado para outro corretor.",
      });
    }
  }, [focusLeadId, leadsQuery.isPending, leads, base, setSearchParams]);

  /**
   * Aviso de lead que saiu da mão do corretor com a tela aberta.
   *
   * O cronômetro chegava a 00:00 e a linha mudava sozinha quando o cron passava
   * — sem nada dizer que o lead tinha voltado para a fila. Quem estava em outra
   * aba do sistema perdia o lead em silêncio.
   *
   * O mapa começa vazio: numa primeira carga ninguém é avisado de nada. "Sair
   * da minha mão" é deixar de estar comigo (`assigned_to`), não mudar de
   * status: atender move para `attending` e o lead continua sendo meu.
   */
  //
  // Roda sobre `base`, e não sobre o recorte da busca: digitar um termo encolhe
  // `leads` e cada lead meu que sai do recorte pareceria ter saído da minha mão
  // — um toast vermelho por lead, sem nada ter acontecido no banco.
  const meusNaTrava = useRef(new Map<string, string>());
  useEffect(() => {
    if (!profileId) return;
    const atuais = new Map(
      base
        .filter((lead) => lead.status === "assigned" && lead.assigned_to === profileId)
        .map((lead) => [lead.id, lead.name] as const),
    );
    for (const [id, nome] of meusNaTrava.current) {
      if (atuais.has(id)) continue;
      const agora = base.find((lead) => lead.id === id);
      if (agora && agora.assigned_to === profileId) continue;
      toast({
        variant: "destructive",
        title: "Lead fora da sua mão",
        description: `${nome}: o prazo de atendimento venceu ou o lead foi realocado. Ele voltou para a roleta.`,
      });
    }
    meusNaTrava.current = atuais;
  }, [base, profileId]);

  // Deriva da lista para o modal acompanhar o realtime em vez de congelar uma
  // cópia. As duas listas, porque o modal abre pela tabela (recorte da busca) e
  // pelos cards de panorama: procurar só numa delas deixava o clique no card de
  // atrasados sem efeito enquanto houvesse busca ativa.
  const detailLead = useMemo(
    () => leads.find((lead) => lead.id === detailLeadId)
      ?? base.find((lead) => lead.id === detailLeadId)
      ?? null,
    [leads, base, detailLeadId],
  );

  // "Atender": trava o lead com o corretor (`claim_lead`) e para o cronômetro.
  // O toast e o som de comemoração saem do realtime de `lead_events` no
  // EngagementLayer — chamar `celebrate()` aqui tocaria o som duas vezes.
  //
  // Em seguida a tela pede a próxima ação. `claim_lead` já grava um padrão
  // (`now() + no_response_hours`), mas quem sabe quando volta a falar com o
  // cliente é o corretor — e é essa data que decide se o lead vai atrasar e
  // travar o check-in dele em 20.
  const attend = async (lead: LeadRecord) => {
    let travado = false;
    try {
      await claimLead(lead.id);
      travado = true;
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
    if (travado) openDialog({ nextAction: lead });
  };

  /**
   * "Distribuir" um lead parado na fila.
   *
   * A RPC não escolhe corretor — empurra para a roleta e devolve quem era o
   * primeiro da fila. É por isso que o retorno é conferido: fingir sucesso com
   * o lead ainda parado é o defeito que este botão existe para acabar.
   *
   * As causas de recusa vêm do banco com o próprio texto (`P0001`, repassado
   * por `describeError`): distribuição pausada em Admin, lead sem grupo, lead
   * que já saiu da fila. A tela dizia uma frase só — "ninguém com check-in
   * aberto" — e mandava o gestor procurar ponto quando a roleta estava pausada.
   * Depois da 0056, `null` significa uma coisa só: a fila está vazia agora.
   */
  const [distributingId, setDistributingId] = useState<string | null>(null);
  const distribute = async (lead: LeadRecord) => {
    setDistributingId(lead.id);
    try {
      const alvo = await distributeQueuedLead(lead.id);
      if (alvo) {
        toast({ title: "Lead distribuído", description: `${lead.name} foi para o primeiro da fila.` });
      } else {
        toast({
          variant: "destructive",
          title: "Ninguém para receber agora",
          description: "A fila do grupo está vazia: ninguém com check-in aberto dentro do horário de distribuição, ou todos bloqueados por leads atrasados. O lead continua esperando.",
        });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível distribuir",
        description: describeError(err, "o lead pode já ter saído da fila"),
      });
    } finally {
      setDistributingId(null);
    }
    await invalidateLeads();
    void queuesQuery.refetch();
  };

  const actions: LeadRowActions = {
    onOpen: (lead) => setDetailLeadId(lead.id),
    onAttend: attend,
    onEdit: (lead) => openDialog({ form: { open: true, lead } }),
    onReassign: (lead) => openDialog({ reassign: lead }),
    onConvert: (lead) => openDialog({ convert: lead }),
    onWhatsApp: (lead) => openDialog({ whatsapp: lead }),
    onEmail: (lead) => openDialog({ email: lead }),
    onCloseLead: (lead) => openDialog({ close: lead }),
    onDelete: (lead) => openDialog({ remove: lead }),
  };

  // A lista busca no máximo `LEADS_PAGE_SIZE` linhas. Bateu no teto, há mais
  // leads no banco do que na tela — e filtrar aqui filtraria só o que veio. Vale
  // para as duas leituras: o panorama continua truncado mesmo quando a busca
  // devolve poucas linhas, e é aí que o aviso é mais útil.
  const truncated = base.length >= LEADS_PAGE_SIZE || leads.length >= LEADS_PAGE_SIZE;

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
              + (canViewQueue && semAtendimento > 0
                ? ` ${num(semAtendimento)} sem atendimento depois de ${num(maxRounds)} voltas.`
                : "")
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowSources((open) => !open)}>
              <BarChart3 className="h-4 w-4" /> {showSources ? "Ocultar origens" : "Origens"}
            </Button>
            {canInsertLead && (
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

      {leadsQuery.error || baseQuery.error ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar os leads"
          description={describeError(leadsQuery.error ?? baseQuery.error, "a lista não respondeu; verifique a conexão e tente de novo")}
          action={
            <Button onClick={() => { void leadsQuery.refetch(); void baseQuery.refetch(); }}>
              Tentar de novo
            </Button>
          }
        />
      ) : leadsQuery.isPending || baseQuery.isPending ? (
        <>
          <LoadingState variant="kpi" rows={5} label="Carregando indicadores de leads…" />
          <LoadingState variant="table" rows={6} label="Carregando a lista de leads…" />
        </>
      ) : (
        <>
          <LeadsSummary metrics={metrics} canViewQueue={canViewQueue} />

          {showSources && <SourcePerformanceCard leads={base} />}

          {canViewQueue && (
            <RouletteHealthCard
              queues={queuesQuery.data ?? []}
              queuedLeads={queuedLeads}
              isPending={queuesQuery.isPending}
              error={queuesQuery.error}
              onRetry={() => void queuesQuery.refetch()}
              onOpenLead={(lead) => setDetailLeadId(lead.id)}
              onDistribute={distribute}
              distributingId={distributingId}
              paused={settingsQuery.data?.leads_paused ?? false}
              maxRounds={maxRounds}
            />
          )}

          <OverdueLeadsCard
            leads={overdueLeads}
            threshold={settingsQuery.data?.overdue_block_threshold ?? 20}
            profileId={profileId}
            onOpen={(lead) => setDetailLeadId(lead.id)}
            onReschedule={(lead) => openDialog({ nextAction: lead })}
            onCloseLead={(lead) => openDialog({ close: lead })}
          />

          <SectionCard
            title="Lista de leads"
            description="Clique no nome do cliente para abrir o histórico completo."
            icon={Users}
            flush={filtered.length > 0}
            footer={
              truncated
                ? `A tela mostra ${num(LEADS_PAGE_SIZE)} leads por vez. Há leads mais antigos fora desta lista — a busca por nome, telefone, e-mail ou campanha (3 letras ou mais) consulta o banco inteiro, não só o que está na tela.`
                : undefined
            }
          >
            <div className={filtered.length > 0 ? "border-b border-border p-4" : "pb-4"}>
              <LeadFilters
                filters={filters}
                onChange={setFilters}
                sources={sources}
                brokers={canReassign ? brokersQuery.data ?? [] : []}
                groups={canViewQueue ? groupsQuery.data ?? [] : []}
              />
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
                    : canInsertLead
                      ? <Button onClick={() => openDialog({ form: { open: true, lead: null } })}>Novo lead</Button>
                      : undefined
                }
              />
            ) : (
              <LeadsTable
                leads={filtered}
                now={now}
                profileId={profileId}
                permissions={permissions}
                actions={actions}
                maxRounds={maxRounds}
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
        actorName={profile?.name}
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
