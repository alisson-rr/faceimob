import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, StatusBadge } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Clock, HandMetal, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateTime, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import LeadDetailModal from "./LeadDetailModal";
import {
  useAutomationSettings, useInvalidateLeads, useLeadsRealtime, useNowTicker,
  useOpenLeads, useTimeoutReleasesToday, waNumber,
} from "@/components/leads";
import { AttendCountdown } from "@/components/leads/LeadsTable";
import { sameLeadProps } from "@/components/leads/sameLeadProps";
import {
  claimLead, FUNNEL_STAGES, funnelStageLabel, isLeadOverdue,
  canClaim, leadSourceTone,
  type LeadRecord, type LeadTone,
} from "@/integrations/supabase/leads";

/** Contorno da coluna por tom da etapa. Só token — não há paleta literal aqui. */
const columnBorder: Record<LeadTone, string> = {
  info: "border-info/40",
  warning: "border-warning/40",
  danger: "border-destructive/40",
  success: "border-success/40",
  highlight: "border-highlight/50",
  neutral: "border-border",
};

export default function LeadFunnel({
  actorName, onConvert,
}: { actorName: string; onConvert: (l: LeadRecord) => void }) {
  const { user } = useAuth();
  const profileId = user?.id || null;

  const leadsQuery = useOpenLeads();
  const settingsQuery = useAutomationSettings();
  const releasesQuery = useTimeoutReleasesToday();
  const invalidateLeads = useInvalidateLeads();
  useLeadsRealtime("leads-funnel");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overdueOpen, setOverdueOpen] = useState(false);

  const leads = useMemo(() => leadsQuery.data ?? [], [leadsQuery.data]);
  // Relógio lento: "atrasado", "inativo" e "novo" andam de 30 em 30 s. O
  // cronômetro da trava tem o próprio tique de 1 s (`AttendCountdown`): com o
  // relógio aqui, 1 lead em trava refazia os até 500 cartões a cada segundo.
  const now = useNowTicker(false);

  const grouped = useMemo(() => {
    const groups: Record<string, LeadRecord[]> = {};
    FUNNEL_STAGES.forEach((stage) => { groups[stage.key] = []; });
    for (const lead of leads) {
      const key = lead.funnel_stage || "new";
      (groups[key] ||= []).push(lead);
    }
    return groups;
  }, [leads]);

  // "Atrasado" é a definição do banco (`overdue_lead_count`): próxima ação
  // vencida. É essa conta que bloqueia o check-in, então a tela usa a mesma.
  const overdueLeads = useMemo(
    () => leads
      .filter((lead) => (profileId ? lead.assigned_to === profileId : true))
      .filter((lead) => isLeadOverdue(lead, now))
      .sort((a, b) => new Date(a.next_action_at || a.created_at).getTime()
        - new Date(b.next_action_at || b.created_at).getTime()),
    [leads, now, profileId],
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
    () => leads.find((lead) => lead.id === selectedId) ?? null,
    [leads, selectedId],
  );

  const threshold = settingsQuery.data?.overdue_block_threshold ?? 20;
  const inactivityHours = settingsQuery.data?.inactivity_alert_hours ?? 48;
  const attendTimeout = settingsQuery.data?.attend_timeout_seconds ?? 300;
  const timeoutsToday = profileId ? releasesQuery.data?.get(profileId) ?? 0 : 0;

  // Sem aviso de sucesso aqui: "Lead em atendimento" sai do realtime de
  // `lead_events` no EngagementLayer, com som.
  const attend = async (lead: LeadRecord) => {
    try {
      await claimLead(lead.id);
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
      <div className="lead-funnel flex gap-3 overflow-x-auto pb-4">
        {FUNNEL_STAGES.map((stage) => {
          const items = grouped[stage.key] || [];
          const accent = columnBorder[stage.tone];
          return (
            // Coluna em camada própria: o cronômetro da trava muda a cada segundo e
            // repintava os cartões das oito colunas (trace, CPU 4x: pintura de
            // ~130 para ~20 ms/s). Isolar só o cronômetro não adiantou.
            <div key={stage.key} className="w-[260px] min-w-[260px] shrink-0 will-change-transform">
              <div className={cn("flex items-center justify-between rounded-t-xl border-x border-t bg-muted/50 px-3 py-2", accent)}>
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
                    onOpen={setSelectedId}
                    onAttend={onAttend}
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

      <LeadDetailModal
        lead={selected}
        open={!!selected}
        onOpenChange={(next) => { if (!next) setSelectedId(null); }}
        actorName={actorName}
        onConvert={(lead) => { setSelectedId(null); onConvert(lead); }}
        onStageChanged={() => void invalidateLeads()}
      />

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
              <button
                key={lead.id}
                type="button"
                onClick={() => { setOverdueOpen(false); setSelectedId(lead.id); }}
                className="w-full rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-left transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
  lead, now, inactivityHours, attendTimeout, claimable, primeiroDaFila, overdue, onOpen, onAttend,
}: {
  lead: LeadRecord;
  now: number;
  inactivityHours: number;
  attendTimeout: number;
  claimable: boolean;
  /** O lead aguardando atendimento que vence primeiro: só ele leva o "Atender" âmbar. */
  primeiroDaFila: boolean;
  overdue: boolean;
  onOpen: (leadId: string) => void;
  onAttend: (lead: LeadRecord) => void;
}) {
  const isBrandNew = now - new Date(lead.created_at).getTime() < attendTimeout * 1000;
  const lastActivity = new Date(lead.last_activity_at || lead.created_at).getTime();
  const inactive = (now - lastActivity) / 3_600_000 > inactivityHours;
  const number = waNumber(lead.phone);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-3 py-2 transition-colors",
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
                {formatDistanceToNow(new Date(lead.created_at), { locale: ptBR, addSuffix: false })}
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
        <StatusBadge tone={leadSourceTone(lead.source)}>{lead.source || "Origem —"}</StatusBadge>
        {/* Cronômetro neutro, como o do NewLeadNotifier: o âmbar deste cartão é
            o botão "Atender". No último minuto vira alerta vermelho. */}
        <AttendCountdown lead={lead} />
        {overdue && <StatusBadge tone="danger" icon={AlertTriangle}>Atrasado</StatusBadge>}
        {inactive && !overdue && <StatusBadge tone="warning" icon={AlertTriangle}>Inativo</StatusBadge>}
        {number && (
          <Button
            variant="ghost" size="icon" className="ml-auto h-7 w-7 text-success hover:text-success"
            aria-label={`Abrir WhatsApp de ${lead.name}`}
            onClick={() => {
              window.open(`https://wa.me/${number}`, "_blank", "noopener");
              toast("WhatsApp aberto", { description: `Conversa com ${lead.name}.`, duration: 2500 });
            }}
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
        )}
      </div>

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
    </div>
  );
}, sameLeadProps);
