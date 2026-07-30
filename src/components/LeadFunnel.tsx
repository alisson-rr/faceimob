import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, MessageCircle, Timer, Clock, HandMetal } from "lucide-react";
import { cn } from "@/lib/utils";
import LeadDetailModal from "./LeadDetailModal";
import {
  listLeads, getAutomationSettings, listTimeoutReleasesToday, claimLead,
  FUNNEL_STAGES, OPEN_LEAD_STATUSES, funnelStageLabel,
  attendSecondsLeft, formatCountdown, canClaim, isLeadOverdue,
  type LeadRecord, type AutomationSettings,
} from "@/integrations/supabase/leads";

export default function LeadFunnel({
  actorName, onConvert,
}: { actorName: string; onConvert: (l: LeadRecord) => void }) {
  const { user } = useAuth();
  const profileId = user?.id || null;

  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [selected, setSelected] = useState<LeadRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [timeoutsToday, setTimeoutsToday] = useState(0);
  const [overdueOpen, setOverdueOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      // Só o que ainda está em operação: convertido/perdido/descartado sai do funil.
      const [rows, config, releases] = await Promise.all([
        listLeads({ statuses: OPEN_LEAD_STATUSES, limit: 500 }),
        getAutomationSettings(),
        listTimeoutReleasesToday().catch(() => new Map<string, number>()),
      ]);
      setLeads(rows);
      setSettings(config);
      setTimeoutsToday(profileId ? releases.get(profileId) || 0 : 0);
      // Mantém o lead aberto sincronizado com o que voltou do banco.
      setSelected((current) => (current ? rows.find((row) => row.id === current.id) || null : null));
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao carregar o funil",
        description: err instanceof Error ? err.message : "tente recarregar a página",
      });
    }
  }, [profileId]);

  useEffect(() => {
    void load();
    // O popup/som de lead novo é global (NewLeadNotifier em AppLayout);
    // aqui só recarregamos o funil quando o banco muda.
    const channel = supabase.channel("leads-funnel")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  // Tique de 1s só enquanto existe trava correndo — o funil fica aberto o dia
  // inteiro e são até 500 cartões na tela.
  const hasRunningDeadline = leads.some(
    (lead) => lead.status === "assigned" && lead.attend_deadline,
  );

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), hasRunningDeadline ? 1_000 : 30_000);
    return () => clearInterval(ticker);
  }, [hasRunningDeadline]);

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

  const threshold = settings?.overdue_block_threshold ?? 20;
  const inactivityHours = settings?.inactivity_alert_hours ?? 48;
  const attendTimeout = settings?.attend_timeout_seconds ?? 300;

  const attend = async (lead: LeadRecord) => {
    try {
      await claimLead(lead.id);
      toast({ title: "Lead em atendimento", description: `${lead.name} está travado com você.` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: err instanceof Error ? err.message : "tente novamente",
      });
    }
    await load();
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={overdueLeads.length > 0 ? "destructive" : "outline"}
          onClick={() => setOverdueOpen(true)}
          className="gap-1.5"
        >
          <AlertTriangle className="h-4 w-4" />
          Atrasados
          <Badge variant="secondary" className="ml-1">{overdueLeads.length}</Badge>
        </Button>
        {overdueLeads.length >= threshold && (
          <span className="text-xs text-destructive font-semibold">
            ⚠ Check-in bloqueado: reduza para menos de {threshold} atrasos.
          </span>
        )}
        {timeoutsToday > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="font-semibold">Leads que voltaram à fila hoje (prazo estourou):</span>
            <Badge variant="destructive">{timeoutsToday}</Badge>
            <Badge variant="outline" className="border-destructive/60 text-destructive">{actorName}</Badge>
          </div>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {FUNNEL_STAGES.map((stage) => {
          const items = grouped[stage.key] || [];
          return (
            <div key={stage.key} className="min-w-[260px] w-[260px] shrink-0">
              <div className={cn("rounded-t-lg px-3 py-2 border-t border-x bg-secondary/40 flex items-center justify-between", stage.accent)}>
                <span className="text-xs font-semibold uppercase tracking-wider">{stage.label}</span>
                <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
              </div>
              <div className={cn("border rounded-b-lg p-2 space-y-2 min-h-[400px] bg-background/30", stage.accent)}>
                {items.map((lead) => (
                  <LeadCardMini
                    key={lead.id}
                    lead={lead}
                    now={now}
                    inactivityHours={inactivityHours}
                    attendTimeout={attendTimeout}
                    claimable={canClaim(lead, profileId)}
                    overdue={isLeadOverdue(lead, now)}
                    onClick={() => setSelected(lead)}
                    onAttend={() => attend(lead)}
                  />
                ))}
                {items.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-6">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <LeadDetailModal
        lead={selected}
        open={!!selected}
        onOpenChange={(v) => !v && setSelected(null)}
        actorName={actorName}
        onConvert={(l) => { setSelected(null); onConvert(l); }}
        onStageChanged={load}
      />

      {/* Lista de leads atrasados */}
      <Dialog open={overdueOpen} onOpenChange={setOverdueOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Leads atrasados ({overdueLeads.length})
            </DialogTitle>
            <DialogDescription>
              Próxima ação vencida. Trate cada lead para desbloquear novos check-ins
              (limite: {threshold}).
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto space-y-2 pr-1">
            {overdueLeads.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                🎉 Nenhum lead atrasado. Bom trabalho!
              </p>
            )}
            {overdueLeads.map((lead) => (
              <button
                key={lead.id}
                onClick={() => { setOverdueOpen(false); setSelected(lead); }}
                className="w-full text-left border border-destructive/40 bg-destructive/5 rounded-lg px-3 py-2 hover:bg-destructive/10 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm truncate">{lead.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {lead.source || "—"}{lead.form_name ? ` · ${lead.form_name}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="outline" className="text-[10px]">{funnelStageLabel(lead.funnel_stage)}</Badge>
                    <span className="text-[10px] text-destructive font-semibold flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      venceu {lead.next_action_at ? format(new Date(lead.next_action_at), "dd/MM HH:mm") : "—"}
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

function sourceStyle(source?: string): { cls: string; label: string } {
  const s = (source || "").toLowerCase();
  if (s.includes("meta") || s.includes("facebook") || s.includes("instagram"))
    return { cls: "bg-blue-600 text-white border-blue-500", label: source || "Meta" };
  if (s.includes("whats"))
    return { cls: "bg-green-600 text-white border-green-500", label: source || "WhatsApp" };
  if (s.includes("google"))
    return { cls: "bg-yellow-500 text-black border-yellow-400", label: source || "Google" };
  if (s.includes("indica"))
    return { cls: "bg-purple-600 text-white border-purple-500", label: source || "Indicação" };
  return { cls: "bg-secondary text-foreground border-border", label: source || "Origem —" };
}

function LeadCardMini({
  lead, now, inactivityHours, attendTimeout, claimable, overdue, onClick, onAttend,
}: {
  lead: LeadRecord;
  now: number;
  inactivityHours: number;
  attendTimeout: number;
  claimable: boolean;
  overdue: boolean;
  onClick: () => void;
  onAttend: () => void;
}) {
  const ageMs = now - new Date(lead.created_at).getTime();
  const isBrandNew = ageMs < attendTimeout * 1000;
  // Cronômetro da trava vem de `attend_deadline`: o banco zera esse campo no
  // claim, então contar a partir de created_at mostrava prazo em lead já travado.
  const secondsLeft = attendSecondsLeft(lead, now);
  const lastActivity = new Date(lead.last_activity_at || lead.created_at).getTime();
  const inactive = (now - lastActivity) / 3_600_000 > inactivityHours;
  const src = sourceStyle(lead.source);
  const digits = (lead.phone || "").replace(/\D/g, "");
  const waLink = digits
    ? `https://wa.me/${digits.startsWith("55") ? digits : `55${digits}`}?text=${encodeURIComponent(`Olá ${lead.name}, tudo bem?`)}`
    : "";

  return (
    <Card
      onClick={onClick}
      className={cn(
        "px-3 py-2 cursor-pointer hover:bg-secondary/60 transition-colors border-border/50 relative",
        claimable && "ring-2 ring-primary/70",
        overdue && "ring-2 ring-destructive/70",
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn(
          "mt-1.5 h-2 w-2 rounded-full shrink-0",
          claimable ? "bg-primary animate-pulse"
            : overdue ? "bg-destructive animate-pulse"
              : isBrandNew ? "bg-red-500 animate-pulse" : "bg-muted-foreground/40",
        )} />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm truncate">{lead.name}</p>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
              {formatDistanceToNow(new Date(lead.created_at), { locale: ptBR, addSuffix: false })}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {lead.campaign_name || lead.source || "—"}
          </p>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className={cn(
              "text-[10px] italic truncate",
              overdue ? "text-destructive font-semibold" : "text-primary/80",
            )}>
              {lead.broker_name || "Sem corretor"}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <Badge className={cn("text-[9px] px-1.5 py-0 border h-4", src.cls)}>{src.label}</Badge>
              {secondsLeft !== null && (
                <span className={cn(
                  "text-[10px] font-medium flex items-center gap-0.5",
                  secondsLeft <= 60 ? "text-destructive" : "text-primary",
                )}>
                  <Timer className="h-2.5 w-2.5" />{formatCountdown(secondsLeft)}
                </span>
              )}
              {waLink && (
                <button
                  onClick={(e) => { e.stopPropagation(); window.open(waLink, "_blank"); }}
                  className="h-5 w-5 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center"
                  title="WhatsApp"
                >
                  <MessageCircle className="h-3 w-3 text-white" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {claimable && (
        <Button
          size="sm"
          className="w-full mt-2 h-7 text-[11px] gap-1"
          onClick={(e) => { e.stopPropagation(); onAttend(); }}
        >
          <HandMetal className="h-3 w-3" /> Atender
          {secondsLeft !== null && <span className="font-mono">{formatCountdown(secondsLeft)}</span>}
        </Button>
      )}

      {(overdue || inactive) && (
        <div className="flex gap-1 mt-1.5">
          {overdue && (
            <Badge className="bg-destructive text-white text-[9px] px-1.5 py-0 h-4 gap-0.5">
              <AlertTriangle className="h-2.5 w-2.5" /> Atrasado
            </Badge>
          )}
          {inactive && !overdue && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-destructive text-destructive gap-0.5">
              <AlertTriangle className="h-2.5 w-2.5" /> Inativo
            </Badge>
          )}
        </div>
      )}
    </Card>
  );
}
