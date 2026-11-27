import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, CalendarClock, Clock, HandMetal, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateTime, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import LeadDetailModal from "./LeadDetailModal";
import {
  LeadsIndicadores, leadsDoCorretor, podeVerPorCorretor,
  useAssignableBrokers, useAutomationSettings, useBuscaLeadsAbertos, useDebounced, useInvalidateLeads, useLeads,
  useLeads3c, useLeadsDoPeriodo, useLeadsRealtime, useNowTicker,
  useOpenLeads, useTimeoutReleasesToday, useWhatsappTemplates, waNumber,
} from "@/components/leads";
import { WhatsAppDialog } from "@/components/leads/OutreachDialogs";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { LeadsCheckinCard } from "@/components/checkin/LeadsCheckinCard";
import { intervaloDoPeriodo, type PeriodoLeads } from "@/components/dashboard/periodoLeads";
import { FilaEmFormacao } from "@/components/checkin/FilaEmFormacao";
import { AttendCountdown } from "@/components/leads/LeadsTable";
import { sameLeadProps } from "@/components/leads/sameLeadProps";
import { NextActionDialog } from "@/components/leads/NextActionDialog";
import {
  claimLead, FUNNEL_STAGES, funnelStageLabel, isLeadOverdue, searchPhoneDigits,
  canClaim, leadSourceTone,
  type LeadRecord, type LeadTone,
} from "@/integrations/supabase/leads";

/**
 * Lead repassado que ainda não foi pego (pedido de 18/11/2026): o repasse
 * (`reassign_lead`) deixa o lead "aguardando" sem cronômetro, mas na etapa em
 * que estava — ele se misturava às colunas de quem já está em conversa. Tem
 * coluna própria, a segunda; ao pegar, vai para "Conversa iniciada" (0344).
 */
const isLeadRepassado = (lead: Pick<LeadRecord, "status" | "attend_deadline">) =>
  lead.status === "assigned" && !lead.attend_deadline;

const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const COLUNAS_DO_FUNIL: { key: string; label: string; tone: LeadTone }[] = [
  FUNNEL_STAGES[0],
  { key: "repassado", label: "Repassados", tone: "highlight" },
  ...FUNNEL_STAGES.slice(1),
];

/** Contorno da coluna por tom da etapa. Só token — não há paleta literal aqui. */
const columnBorder: Record<LeadTone, string> = {
  info: "border-info/40",
  warning: "border-warning/40",
  danger: "border-destructive/40",
  success: "border-success/40",
  highlight: "border-highlight/50",
  neutral: "border-border",
};

/** Cor da etapa acompanha coluna e cartão: azul em início, amarelo quando pede
 * atenção e verde conforme o lead avança para conversão. */
const stageSurface: Record<LeadTone, string> = {
  info: "bg-info/10",
  warning: "bg-warning/10",
  danger: "bg-destructive/10",
  success: "bg-success/10",
  highlight: "bg-highlight/10",
  neutral: "bg-muted/50",
};

export default function LeadFunnel({
  actorName, onConvert,
}: { actorName: string; onConvert: (l: LeadRecord) => void }) {
  const { user, roles, previewRole, isAdmin, can } = useAuth();
  const profileId = user?.id || null;
  // Mesmo recorte da tela de Leads (02/10/2026): a gestão olha um corretor
  // por vez, e o funil e os indicadores falam do mesmo corretor.
  const verPorCorretor = podeVerPorCorretor(previewRole ? [previewRole] : roles, isAdmin);
  const canViewQueue = can("leads.view_queue");
  // Gerente e diretor abrem nos PRÓPRIOS leads (pedido de 19/11/2026): a
  // equipe inteira no funil confundia — a coluna Repassados dele parecia zerada
  // no meio dos leads dos outros. "Equipe" mostra todos de novo.
  const efetivos = previewRole ? [previewRole] : roles;
  const gestorDeEquipe = !isAdmin && efetivos.some((role) => role === "manager" || role === "director");
  const [broker, setBroker] = useState(() => (gestorDeEquipe && profileId ? profileId : "all"));

  const leadsQuery = useOpenLeads();
  // Panorama (hoje/semana/mês e a régua): a mesma base da tela de Leads, que
  // divide a entrada de cache com ela.
  const baseQuery = useLeads("");
  const brokersQuery = useAssignableBrokers(verPorCorretor);
  const settingsQuery = useAutomationSettings();
  const releasesQuery = useTimeoutReleasesToday();
  const invalidateLeads = useInvalidateLeads();
  useLeadsRealtime("leads-funnel");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);
  // WhatsApp com mensagem pronta (03/10/2026) em vez de abrir a conversa vazia.
  const [whatsappId, setWhatsappId] = useState<string | null>(null);
  // Reagendar direto do cartão (pedido de 18/11/2026): o mesmo diálogo da lista de atrasados.
  const [reagendarId, setReagendarId] = useState<string | null>(null);
  const templatesQuery = useWhatsappTemplates();

  // 26/11/2026: o funil carrega os 500 leads em operação mais recentes. Os da
  // IA da 3C (lead antigo com visita marcada ou interesse) e os achados pela
  // busca no banco entram junto, sem repetir.
  const ia3cQuery = useLeads3c();
  const [busca, setBusca] = useState("");
  const buscaNoBanco = useDebounced(busca.trim(), 400);
  const buscaQuery = useBuscaLeadsAbertos(buscaNoBanco);
  // Período (26/11/2026): "Em operação" é o funil de sempre; com um período, o
  // funil mostra o que CHEGOU nele, de qualquer situação (os encerrados numa
  // coluna própria) — a mesma soma do Dashboard.
  const [periodo, setPeriodo] = useState<"operacao" | PeriodoLeads>("operacao");
  const intervaloIso = useMemo(() => {
    if (periodo === "operacao") return null;
    const i = intervaloDoPeriodo(periodo);
    return i ? { de: i.de.toISOString(), ate: i.ate.toISOString() } : null;
  }, [periodo]);
  const periodoQuery = useLeadsDoPeriodo(intervaloIso);
  const emPeriodo = intervaloIso !== null;
  const ids3cAbertos = useMemo(() => new Set((ia3cQuery.data?.leads ?? []).map((lead) => lead.id)), [ia3cQuery.data]);
  // Selo "Agenda Ana" (26/11/2026): o corretor vê no cartão que a IA marcou a visita.
  const tipos3c = useMemo(() => {
    const mapa = new Map(ia3cQuery.data?.tipos ?? []);
    for (const [id, entrega] of periodoQuery.data?.tipos ?? []) {
      const atual = mapa.get(id);
      mapa.set(id, {
        tipo: atual?.tipo === "agenda" ? "agenda" : entrega.tipo,
        em: atual && atual.em > entrega.em ? atual.em : entrega.em,
      });
    }
    return mapa;
  }, [ia3cQuery.data, periodoQuery.data]);
  const ids3c = useMemo(
    () => (emPeriodo ? periodoQuery.data?.ids3c ?? new Set<string>() : ids3cAbertos),
    [emPeriodo, periodoQuery.data, ids3cAbertos],
  );
  const todos = useMemo(() => {
    const porId = new Map((leadsQuery.data ?? []).map((lead) => [lead.id, lead]));
    for (const lead of [...(ia3cQuery.data?.leads ?? []), ...(buscaNoBanco.length >= 3 ? buscaQuery.data ?? [] : [])]) {
      if (!porId.has(lead.id)) porId.set(lead.id, lead);
    }
    return [...porId.values()];
  }, [leadsQuery.data, ia3cQuery.data, buscaQuery.data, buscaNoBanco]);
  const abertos = useMemo(() => leadsDoCorretor(todos, broker), [todos, broker]);
  const leads = useMemo(
    () => (emPeriodo ? leadsDoCorretor(periodoQuery.data?.leads ?? [], broker) : abertos),
    [emPeriodo, periodoQuery.data, broker, abertos],
  );
  const colunas = useMemo(
    () => (emPeriodo ? [...COLUNAS_DO_FUNIL, { key: "encerrado", label: "Encerrados", tone: "neutral" as LeadTone }] : COLUNAS_DO_FUNIL),
    [emPeriodo],
  );
  // Filtro por origem (26/11/2026). "IA 3C" junta o que a IA entregou, de qualquer origem.
  const [origem, setOrigem] = useState("todas");
  const origens = useMemo(
    () => [...new Set(leads.map((lead) => lead.source).filter((s): s is string => Boolean(s)))]
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [leads],
  );
  const total3c = useMemo(() => leads.filter((lead) => ids3c.has(lead.id)).length, [leads, ids3c]);
  const base = useMemo(() => leadsDoCorretor(baseQuery.data ?? [], broker), [baseQuery.data, broker]);
  // Relógio lento: "atrasado", "inativo" e "novo" andam de 30 em 30 s. O
  // cronômetro da trava tem o próprio tique de 1 s (`AttendCountdown`): com o
  // relógio aqui, 1 lead em trava refazia os até 500 cartões a cada segundo.
  const now = useNowTicker(false);

  // Busca por nome no funil (pedido de 19/11/2026): filtra os cartões que já
  // estão na tela, sem ir ao banco; aceita também o telefone.
  const grouped = useMemo(() => {
    const groups: Record<string, LeadRecord[]> = {};
    colunas.forEach((stage) => { groups[stage.key] = []; });
    const termo = semAcento(busca.trim());
    const digitos = searchPhoneDigits(busca);
    for (const lead of leads) {
      if (origem === "ia-3c" ? !ids3c.has(lead.id) : origem !== "todas" && lead.source !== origem) continue;
      if (termo && !semAcento(lead.name).includes(termo)
          && !(digitos && (lead.phone ?? "").replace(/\D/g, "").includes(digitos))) continue;
      const encerrado = ["lost", "discarded", "converted"].includes(lead.status);
      const key = encerrado ? (emPeriodo ? "encerrado" : null)
        : isLeadRepassado(lead) ? "repassado" : lead.funnel_stage || "new";
      if (!key) continue;
      (groups[key] ||= []).push(lead);
    }
    return groups;
  }, [leads, busca, origem, ids3c, colunas, emPeriodo]);

  // "Atrasado" é a definição do banco (`overdue_lead_count`): próxima ação
  // vencida. É essa conta que bloqueia o check-in, então a tela usa a mesma.
  const overdueLeads = useMemo(
    () => abertos
      .filter((lead) => (profileId ? lead.assigned_to === profileId : true))
      .filter((lead) => isLeadOverdue(lead, now))
      .sort((a, b) => new Date(a.next_action_at || a.created_at).getTime()
        - new Date(b.next_action_at || b.created_at).getTime()),
    [abertos, now, profileId],
  );

  // Um destaque por tela: com vários leads aguardando atendimento, o "Atender"
  // âmbar vai só no que vence primeiro; os outros ficam no botão padrão.
  const primeiroDaFila = useMemo(() => {
    const prazo = (lead: LeadRecord) =>
      lead.attend_deadline ? new Date(lead.attend_deadline).getTime() : Number.POSITIVE_INFINITY;
    let primeiro: LeadRecord | null = null;
    for (const lead of leads) {
      if (canClaim(lead, profileId) && (!primeiro || prazo(lead) < prazo(primeiro))) primeiro = lead;
    }
    return primeiro?.id ?? null;
  }, [leads, profileId]);

  // Deriva da consulta: sem isso o modal congela uma cópia e ignora o realtime.
  const selected = useMemo(
    () => leads.find((lead) => lead.id === selectedId) ?? abertos.find((lead) => lead.id === selectedId) ?? null,
    [leads, abertos, selectedId],
  );


  const acharLead = (id: string) => leads.find((lead) => lead.id === id) ?? abertos.find((lead) => lead.id === id) ?? null;
  const reagendarLead = reagendarId ? acharLead(reagendarId) : null;
  const whatsappLead = whatsappId ? acharLead(whatsappId) : null;

  const threshold = settingsQuery.data?.overdue_block_threshold ?? 20;
  const inactivityHours = settingsQuery.data?.inactivity_alert_hours ?? 48;
  const attendTimeout = settingsQuery.data?.attend_timeout_seconds ?? 600;
  const timeoutsToday = profileId ? releasesQuery.data?.get(profileId) ?? 0 : 0;

  // Sem aviso de sucesso aqui: "Lead em atendimento" sai do realtime de
  // `lead_events` no EngagementLayer, com som.
  const attend = async (lead: LeadRecord) => {
    try {
      await claimLead(lead.id);
      // Atender significa falar agora. O detalhe abre nos atalhos de WhatsApp
      // e ligação; agendar uma ação só vem depois da tentativa de contato.
      setSelectedId(lead.id);
    } catch (err) {
      toast.error("Não foi possível atender o lead", {
        description: describeError(err, "outro corretor pode ter assumido antes"),
      });
    }
    await invalidateLeads();
  };
  // O cartão é memoizado e precisa de handler com identidade estável; `attend`
  // é recriada a cada render (usa `invalidateLeads`), então entra por ref.
  const attendRef = useRef(attend);
  useEffect(() => { attendRef.current = attend; });
  const onAttend = useCallback((lead: LeadRecord) => { void attendRef.current(lead); }, []);

  if (leadsQuery.error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não consegui carregar o funil"
        description={describeError(leadsQuery.error, "a lista de leads não respondeu; tente de novo")}
        action={<Button onClick={() => void leadsQuery.refetch()}>Tentar de novo</Button>}
      />
    );
  }

  if (leadsQuery.isPending) return <LoadingState variant="list" rows={5} label="Carregando o funil de leads…" />;

  return (
    <>
      <div className="mb-4 flex flex-col gap-4">
        <LeadsCheckinCard />
        <FilaEmFormacao />
        {baseQuery.data && (
          <LeadsIndicadores
            broker={broker}
            onBroker={setBroker}
            brokers={verPorCorretor ? brokersQuery.data ?? [] : []}
            canViewQueue={canViewQueue}
          />
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar lead por nome ou telefone" aria-label="Buscar lead no funil por nome ou telefone"
            className="h-8 w-64 max-w-full pl-8 text-xs"
          />
        </div>
        <select
          value={periodo} onChange={(e) => setPeriodo(e.target.value as "operacao" | PeriodoLeads)}
          aria-label="Período do funil"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="operacao">Em operação (todos)</option>
          <option value="hoje">Chegaram hoje</option>
          <option value="ontem">Chegaram ontem</option>
          <option value="semana">Chegaram esta semana</option>
          <option value="mes">Chegaram este mês</option>
          <option value="mes_passado">Chegaram no mês passado</option>
        </select>
        {emPeriodo && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {periodoQuery.isPending ? "carregando…" : `${num(leads.length)} lead(s) no período`}
          </span>
        )}
        <select
          value={origem} onChange={(e) => setOrigem(e.target.value)}
          aria-label="Filtrar o funil por origem"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="todas">Todas as origens</option>
          <option value="ia-3c">IA 3C ({num(total3c)})</option>
          {origens.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <Button
          type="button" size="sm" variant={origem === "ia-3c" ? "default" : "outline"} className="h-8 text-xs"
          aria-pressed={origem === "ia-3c"} onClick={() => setOrigem(origem === "ia-3c" ? "todas" : "ia-3c")}
        >
          IA 3C <Badge variant="secondary" className="ml-1 tabular-nums">{num(total3c)}</Badge>
        </Button>
        {gestorDeEquipe && profileId && (
          <div className="flex rounded-xl border border-border p-0.5" role="group" aria-label="De quem são os leads do funil">
            {([[profileId, "Meus leads"], ["all", "Equipe"]] as const).map(([valor, rotulo]) => (
              <Button
                key={rotulo} type="button" size="sm" className="h-7 text-xs"
                variant={broker === valor ? "default" : "ghost"} aria-pressed={broker === valor}
                onClick={() => setBroker(valor)}
              >
                {rotulo}
              </Button>
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant={overdueLeads.length > 0 ? "destructive" : "outline"}
          onClick={() => setOverdueOpen(true)}
        >
          <AlertTriangle className="h-4 w-4" />
          Atrasados
          <Badge variant="secondary" className="ml-1 tabular-nums">{num(overdueLeads.length)}</Badge>
        </Button>
        {overdueLeads.length >= threshold && (
          <span className="text-xs font-semibold text-destructive">
            Check-in bloqueado: reduza para menos de {num(threshold)} atrasos.
          </span>
        )}
        {timeoutsToday > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
            <span className="font-semibold">Leads que voltaram à fila hoje (prazo estourou):</span>
            <StatusBadge tone="danger">{num(timeoutsToday)}</StatusBadge>
            <StatusBadge tone="neutral">{actorName}</StatusBadge>
          </div>
        )}
      </div>

      {/* `lead-funnel`: gancho da regra de pintura em `index.css`. */}
      {/* Barra de rolagem no topo (26/11/2026): com as colunas compridas ela
          ficava no rodapé, longe da vista. O giro de 180° no eixo X leva a barra
          para cima e o conteúdo é desvirado logo abaixo. */}
      <div className="overflow-x-auto pt-2 [transform:rotateX(180deg)]">
      <div className="lead-funnel flex gap-3 pb-2 [transform:rotateX(180deg)]">
        {colunas.map((stage) => {
          const items = grouped[stage.key] || [];
          const accent = columnBorder[stage.tone];
          const surface = stageSurface[stage.tone];
          return (
            // Coluna em camada própria: o cronômetro da trava muda a cada segundo e
            // repintava os cartões das oito colunas (trace, CPU 4x: pintura de
            // ~130 para ~20 ms/s). Isolar só o cronômetro não adiantou.
            <div key={stage.key} className="w-[260px] min-w-[260px] shrink-0 will-change-transform">
              <div className={cn("flex items-center justify-between rounded-t-xl border-x border-t px-3 py-2", accent, surface)}>
                <span className="text-eyebrow">{stage.label}</span>
                <Badge variant="outline" className="tabular-nums">{num(items.length)}</Badge>
              </div>
              <div className={cn("min-h-[400px] space-y-2 rounded-b-xl border bg-card/40 p-2", accent)}>
                {items.map((lead) => (
                  <LeadCardMini
                    key={lead.id}
                    lead={lead}
                    now={now}
                    inactivityHours={inactivityHours}
                    attendTimeout={attendTimeout}
                    claimable={canClaim(lead, profileId)}
                    primeiroDaFila={lead.id === primeiroDaFila}
                    overdue={isLeadOverdue(lead, now)}
                    stageTone={stage.tone}
                    selo3c={tipos3c.get(lead.id)?.tipo ?? null}
                    entregue3cEm={tipos3c.get(lead.id)?.em ?? null}
                    onOpen={setSelectedId}
                    onAttend={onAttend}
                    onWhatsApp={setWhatsappId}
                    onReschedule={setReagendarId}
                  />
                ))}
                {items.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">Nenhum lead nesta etapa</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      {whatsappLead && (
        <WhatsAppDialog
          lead={whatsappLead}
          templates={templatesQuery.data ?? []}
          onClose={() => setWhatsappId(null)}
        />
      )}

      <LeadDetailModal
        lead={selected}
        open={!!selected}
        onOpenChange={(next) => { if (!next) setSelectedId(null); }}
        actorName={actorName}
        onConvert={(lead) => { setSelectedId(null); onConvert(lead); }}
        onStageChanged={() => void invalidateLeads()}
      />

      {reagendarLead && <NextActionDialog lead={reagendarLead} onClose={() => setReagendarId(null)} />}

      {/* Lista de leads atrasados */}
      <Dialog open={overdueOpen} onOpenChange={setOverdueOpen}>
        <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
              Leads atrasados ({num(overdueLeads.length)})
            </DialogTitle>
            <DialogDescription>
              Próxima ação vencida. Trate cada lead para desbloquear novos check-ins
              (limite: {num(threshold)}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 overflow-y-auto pr-1">
            {overdueLeads.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                🎉 Nenhum lead atrasado. Bom trabalho!
              </p>
            )}
            {overdueLeads.map((lead) => (
              // Reagendar ao lado do lead (19/11/2026): a lista só abria a ficha.
              <div key={lead.id} className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => { setOverdueOpen(false); setSelectedId(lead.id); }}
                className="min-w-0 flex-1 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-left transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{lead.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lead.source || "—"}{lead.form_name ? ` · ${lead.form_name}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge tone="neutral">{funnelStageLabel(lead.funnel_stage)}</StatusBadge>
                    <span className="flex items-center gap-1 text-xs font-semibold text-destructive">
                      <Clock className="h-3.5 w-3.5" aria-hidden />
                      venceu {dateTime(lead.next_action_at)}
                    </span>
                  </div>
                </div>
              </button>
              <Button
                variant="outline" size="sm" className="h-auto shrink-0 gap-1 px-2 text-xs"
                onClick={() => { setOverdueOpen(false); setReagendarId(lead.id); }}
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Reagendar
              </Button>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverdueOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Cartão do funil.
 *
 * O cartão inteiro é um `<button>`: antes era `<Card onClick>`, que não recebe
 * foco nem responde a Enter — o funil era intransitável no teclado (X06). Os
 * botões de WhatsApp e "Atender" ficam FORA do botão do cartão, porque botão
 * dentro de botão é HTML inválido e o navegador desmonta a árvore.
 *
 * Memoizado: um evento realtime refaz só o cartão cujo lead mudou, mesmo quando
 * um lead novo desloca a lista (`sameLeadProps`). `now` continua como prop porque
 * "novo", "inativo" e o "há X minutos" precisam andar a cada tique de 30 s.
 */
const LeadCardMini = memo(function LeadCardMini({
  lead, now, inactivityHours, attendTimeout, claimable, primeiroDaFila, overdue, stageTone, selo3c, entregue3cEm, onOpen, onAttend, onWhatsApp,
  onReschedule,
}: {
  lead: LeadRecord;
  now: number;
  inactivityHours: number;
  attendTimeout: number;
  claimable: boolean;
  /** O lead aguardando atendimento que vence primeiro: só ele leva o "Atender" âmbar. */
  primeiroDaFila: boolean;
  overdue: boolean;
  stageTone: LeadTone;
  /** Visita marcada ou interesse registrado pela IA da 3C ("Ana"). */
  selo3c: "agenda" | "interessado" | null;
  /** Quando a 3C entregou: o cartão conta o tempo e a inatividade a partir daí. */
  entregue3cEm: string | null;
  onOpen: (leadId: string) => void;
  onAttend: (lead: LeadRecord) => void;
  onWhatsApp: (leadId: string) => void;
  onReschedule: (leadId: string) => void;
}) {
  const isBrandNew = now - new Date(lead.created_at).getTime() < attendTimeout * 1000;
  // Lead antigo que a Ana reativou (27/11/2026): contar desde a criação fazia o
  // cartão dizer "2 meses · Inativo" e o corretor achar que era repique de base.
  const chegouEm = entregue3cEm ?? lead.created_at;
  const lastActivity = Math.max(
    new Date(lead.last_activity_at || lead.created_at).getTime(),
    entregue3cEm ? new Date(entregue3cEm).getTime() : 0,
  );
  const inactive = (now - lastActivity) / 3_600_000 > inactivityHours;
  const number = waNumber(lead.phone);

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 transition-colors",
        stageSurface[stageTone],
        claimable ? "border-primary/70 ring-1 ring-primary/40"
          : overdue ? "border-destructive/70 ring-1 ring-destructive/40" : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(lead.id)}
        className="w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <div className="flex items-start gap-2">
          <span
            className={cn(
              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
              claimable ? "bg-primary animate-pulse"
                : overdue ? "bg-destructive animate-pulse"
                  : isBrandNew ? "bg-info animate-pulse" : "bg-muted-foreground/40",
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold">{lead.name}</p>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(chegouEm), { locale: ptBR, addSuffix: false })}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {lead.campaign_name || lead.source || "—"}
            </p>
            <p className={cn("mt-0.5 truncate text-xs", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>
              {lead.broker_name || "Sem corretor"}
            </p>
          </div>
        </div>
      </button>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {selo3c
          ? <StatusBadge tone="highlight">Lead 3C</StatusBadge>
          : <StatusBadge tone={leadSourceTone(lead.source)}>{lead.source || "Origem —"}</StatusBadge>}
        {selo3c && (
          <StatusBadge tone="warning" icon={selo3c === "agenda" ? CalendarClock : undefined}>
            {selo3c === "agenda" ? "Agenda Ana" : "Ana · interessado"}
          </StatusBadge>
        )}
        {/* Cronômetro neutro, como o do NewLeadNotifier: o âmbar deste cartão é
            o botão "Atender". No último minuto vira alerta vermelho. */}
        <AttendCountdown lead={lead} />
        {overdue && <StatusBadge tone="danger" icon={AlertTriangle}>Atrasado</StatusBadge>}
        {inactive && !overdue && <StatusBadge tone="warning" icon={AlertTriangle}>Inativo</StatusBadge>}
        {number && (
          <Button
            variant="ghost" size="icon" className="ml-auto h-7 w-7 text-success hover:text-success"
            aria-label={`Abrir WhatsApp de ${lead.name}`}
            onClick={() => onWhatsApp(lead.id)}
          >
            <WhatsAppIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Lead em atendimento: reagendar a próxima ação sem abrir a ficha. */}
      {!claimable && ["assigned", "attending", "in_progress"].includes(lead.status) && (
        <Button
          variant={overdue ? "outline" : "ghost"} size="sm"
          className={cn("mt-1.5 h-7 w-full gap-1 text-xs", overdue && "border-destructive/50 text-destructive")}
          onClick={() => onReschedule(lead.id)}
        >
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Reagendar
        </Button>
      )}

      {claimable && (
        <Button
          size="sm"
          variant={primeiroDaFila ? "highlight" : "default"}
          className="mt-2 h-8 w-full text-xs"
          onClick={() => onAttend(lead)}
        >
          <HandMetal className="h-3.5 w-3.5" /> Atender
          <AttendCountdown lead={lead} bare />
        </Button>
      )}
      {claimable && (
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {lead.attend_deadline ? 'Só fica seu ao clicar em "Atender"' : "Repassado para você · não volta à roleta"}
        </p>
      )}
    </div>
  );
}, sameLeadProps);
