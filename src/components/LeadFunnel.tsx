import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, MessageCircle, Timer, User, BellRing, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import LeadDetailModal from "./LeadDetailModal";
import { toast } from "@/hooks/use-toast";

const STAGES: { key: string; label: string; accent: string }[] = [
  { key: "new", label: "Novo Lead", accent: "border-blue-500/50" },
  { key: "first_contact", label: "Primeiro Contato", accent: "border-cyan-500/50" },
  { key: "no_response", label: "Sem Resposta", accent: "border-amber-500/50" },
  { key: "warm", label: "Lead Morno", accent: "border-orange-500/50" },
  { key: "hot", label: "Lead Quente", accent: "border-red-500/50" },
  { key: "gathering_docs", label: "Juntando Doc", accent: "border-violet-500/50" },
  { key: "converted", label: "Convertido", accent: "border-emerald-500/50" },
];

type LeadRow = any;

export default function LeadFunnel({
  actorName, onConvert,
}: { actorName: string; onConvert: (l: LeadRow) => void }) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [selected, setSelected] = useState<LeadRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const [roletaSec, setRoletaSec] = useState(300);
  const [inactivityH, setInactivityH] = useState(24);
  const [stageMax, setStageMax] = useState<Record<string, number>>({
    new: 5, first_contact: 60, no_response: 1440, warm: 2880, hot: 1440, gathering_docs: 4320,
  });
  const [popupLead, setPopupLead] = useState<LeadRow | null>(null);
  const [popupKind, setPopupKind] = useState<"new" | "delay">("new");
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [lostToday, setLostToday] = useState<{ broker_name: string; lost_count: number }[]>([]);


  const load = async () => {
    const [{ data }, { data: s }, { data: lost }] = await Promise.all([
      supabase.from("leads").select("*")
        .neq("funnel_stage", "converted")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("lead_automation_settings").select("*").eq("id", true).maybeSingle(),
      supabase.rpc("leads_lost_today" as any),
    ]);
    setLeads((data as any) || []);
    // mostra perdidos apenas do próprio corretor logado
    const own = ((lost as any) || []).filter((r: any) =>
      (r.broker_name || "").trim().toLowerCase() === (actorName || "").trim().toLowerCase()
    );
    setLostToday(own as any);
    if (s) {
      setRoletaSec((s as any).roleta_seconds);
      setInactivityH((s as any).inactivity_alert_hours);
      if ((s as any).stage_max_minutes) setStageMax((s as any).stage_max_minutes);
    }
  };




  useEffect(() => {
    load();
    const ch = supabase.channel("leads-funnel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, (payload: any) => {
        const l = payload.new;
        setPopupKind("new");
        setPopupLead(l);
        try { new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA=").play().catch(() => {}); } catch {}
        toast({
          title: "🔔 Novo Lead recebido!",
          description: `${l.name || "Sem nome"} — ${l.source || "origem —"}`,
        });
        load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "leads" }, () => load())
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "leads" }, () => load())
      .subscribe();
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => { supabase.removeChannel(ch); clearInterval(t); };
  }, []);

  const grouped = useMemo(() => {
    const g: Record<string, LeadRow[]> = {};
    STAGES.forEach(s => (g[s.key] = []));
    for (const l of leads) {
      const k = l.funnel_stage || "new";
      (g[k] ||= []).push(l);
    }
    return g;
  }, [leads]);

  // Lista de leads atrasados (por etapa) do corretor logado
  const overdueLeads = useMemo(() => {
    const own = (actorName || "").trim().toLowerCase();
    return leads.filter(l => {
      if (l.funnel_stage === "converted") return false;
      if (own && (l.broker_name || "").trim().toLowerCase() !== own) return false;
      const max = stageMax[l.funnel_stage || "new"];
      if (!max) return false;
      const changed = new Date(l.stage_changed_at || l.created_at).getTime();
      const mins = (now - changed) / 60_000;
      return mins > max;
    }).sort((a, b) => {
      const ta = new Date(a.stage_changed_at || a.created_at).getTime();
      const tb = new Date(b.stage_changed_at || b.created_at).getTime();
      return ta - tb;
    });
  }, [leads, now, stageMax, actorName]);


  // Roleta: reatribui leads "new" expirados ao próximo corretor da fila
  useEffect(() => {
    const reassignedKey = "lead-reassigned";
    const reassigned: string[] = JSON.parse(sessionStorage.getItem(reassignedKey) || "[]");
    (async () => {
      for (const l of leads) {
        if (l.funnel_stage !== "new" || reassigned.includes(l.id)) continue;
        const ageMs = now - new Date(l.created_at).getTime();
        if (ageMs < roletaSec * 1000) continue;

        reassigned.push(l.id);
        sessionStorage.setItem(reassignedKey, JSON.stringify(reassigned));
        const { data } = await supabase.rpc("reassign_expired_lead" as any, { _lead_id: l.id });
        const res: any = data;
        if (res?.ok) {
          toast({ title: "🔁 Lead repassado", description: `${l.name || "Lead"} → ${res.new_broker_name}` });
        }
      }
      load();
    })();
  }, [leads, now, roletaSec]);

  const totalLostToday = lostToday.reduce((a, b) => a + Number(b.lost_count || 0), 0);

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
        {overdueLeads.length > 20 && (
          <span className="text-xs text-destructive font-semibold">
            ⚠ Check-in bloqueado: reduza para ≤ 20 atrasos.
          </span>
        )}
        {totalLostToday > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="font-semibold">Leads perdidos hoje (roleta expirou):</span>
            <Badge variant="destructive">{totalLostToday}</Badge>
            {lostToday.map(l => (
              <Badge key={l.broker_name} variant="outline" className="border-destructive/60 text-destructive">
                {l.broker_name}: {l.lost_count}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4">

        {STAGES.map(stage => {
          const items = grouped[stage.key] || [];
          return (
            <div key={stage.key} className="min-w-[260px] w-[260px] shrink-0">
              <div className={cn("rounded-t-lg px-3 py-2 border-t border-x bg-secondary/40 flex items-center justify-between", stage.accent)}>
                <span className="text-xs font-semibold uppercase tracking-wider">{stage.label}</span>
                <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
              </div>
              <div className={cn("border rounded-b-lg p-2 space-y-2 min-h-[400px] bg-background/30", stage.accent)}>
                {items.map(l => (
                  <LeadCardMini
                    key={l.id}
                    lead={l}
                    now={now}
                    roletaSec={roletaSec}
                    inactivityH={inactivityH}
                    stageMaxMin={stageMax[stage.key] || 0}
                    onClick={() => setSelected(l)}
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

      {/* Popup de novo lead / atraso */}
      <Dialog open={!!popupLead} onOpenChange={(v) => !v && setPopupLead(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {popupKind === "new" ? (
                <><BellRing className="h-5 w-5 text-primary animate-pulse" /> Novo Lead recebido!</>
              ) : (
                <><AlertTriangle className="h-5 w-5 text-destructive" /> Lead atrasado</>
              )}
            </DialogTitle>
            <DialogDescription>
              {popupKind === "new" ? (
                <>Um novo lead acabou de chegar. Aja rápido para não perder!</>
              ) : (
                <>Este lead está há tempo demais na etapa atual. Retome o atendimento.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {popupLead && (
            <div className="space-y-2 py-2">
              <p className="text-lg font-semibold">{popupLead.name || "Sem nome"}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge className={cn("border", sourceStyle(popupLead.source).cls)}>{sourceStyle(popupLead.source).label}</Badge>
                {popupLead.form_name && <Badge variant="outline">📋 {popupLead.form_name}</Badge>}
                <Badge variant="outline">Etapa: {STAGES.find(s => s.key === popupLead.funnel_stage)?.label || popupLead.funnel_stage}</Badge>
              </div>
              {popupKind === "delay" && popupLead.stage_changed_at && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Nesta etapa {formatDistanceToNow(new Date(popupLead.stage_changed_at), { locale: ptBR, addSuffix: true })}
                </p>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPopupLead(null)}>Depois</Button>
            <Button onClick={() => { setSelected(popupLead); setPopupLead(null); }}>
              <ExternalLink className="h-4 w-4 mr-1" /> Abrir lead
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lista de leads atrasados */}
      <Dialog open={overdueOpen} onOpenChange={setOverdueOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Leads atrasados ({overdueLeads.length})
            </DialogTitle>
            <DialogDescription>
              Trate cada lead abaixo para desbloquear novos check-ins. Limite: 20 atrasos.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto space-y-2 pr-1">
            {overdueLeads.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                🎉 Nenhum lead atrasado. Bom trabalho!
              </p>
            )}
            {overdueLeads.map(l => {
              const changed = new Date(l.stage_changed_at || l.created_at).getTime();
              const mins = Math.floor((now - changed) / 60_000);
              const stageLabel = STAGES.find(s => s.key === l.funnel_stage)?.label || l.funnel_stage;
              return (
                <button
                  key={l.id}
                  onClick={() => { setOverdueOpen(false); setSelected(l); }}
                  className="w-full text-left border border-destructive/40 bg-destructive/5 rounded-lg px-3 py-2 hover:bg-destructive/10 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{l.name || "Sem nome"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {l.source || "—"}{l.form_name ? ` · ${l.form_name}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge variant="outline" className="text-[10px]">{stageLabel}</Badge>
                      <span className="text-[10px] text-destructive font-semibold flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {mins}m na etapa
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
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

function LeadCardMini({ lead, now, roletaSec, inactivityH, stageMaxMin, onClick }: { lead: LeadRow; now: number; roletaSec: number; inactivityH: number; stageMaxMin: number; onClick: () => void }) {
  const created = new Date(lead.created_at).getTime();
  const ageMs = now - created;
  const isNew = lead.funnel_stage === "new";
  const isBrandNew = ageMs < 10 * 60_000; // < 10min
  const roletaLeftMs = roletaSec * 1000 - ageMs;
  const lastAct = new Date(lead.last_activity_at || lead.created_at).getTime();
  const inactiveH = (now - lastAct) / 3_600_000;
  const inactiveAlert = inactiveH > inactivityH;
  const stageChanged = new Date(lead.stage_changed_at || lead.created_at).getTime();
  const stageMinutes = (now - stageChanged) / 60_000;
  const stageOverdue = stageMaxMin > 0 && stageMinutes > stageMaxMin;
  const src = sourceStyle(lead.source);
  const whatsappNum = (lead.whatsapp || lead.phone || "").replace(/\D/g, "");
  const waLink = whatsappNum
    ? `https://wa.me/${whatsappNum.startsWith("55") ? whatsappNum : "55" + whatsappNum}?text=${encodeURIComponent(`Olá ${lead.name || ""}, tudo bem?`)}`
    : "";

  const timeLabel = formatDistanceToNow(new Date(lead.created_at), { locale: ptBR, addSuffix: false });

  return (
    <Card
      onClick={onClick}
      className={cn(
        "px-3 py-2 cursor-pointer hover:bg-secondary/60 transition-colors border-border/50 relative",
        isBrandNew && "ring-2 ring-primary/70",
        stageOverdue && "ring-2 ring-destructive/70"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Status dot */}
        <span className={cn(
          "mt-1.5 h-2 w-2 rounded-full shrink-0",
          isBrandNew ? "bg-red-500 animate-pulse" : stageOverdue ? "bg-destructive animate-pulse" : "bg-muted-foreground/40"
        )} />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm truncate">{lead.name || "Sem nome"}</p>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
              {timeLabel}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {(lead.form_name && !/^Formul[aá]rio\s*\d+$/i.test(lead.form_name)) ? lead.form_name : (lead.source || "—")}
          </p>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className={cn(
              "text-[10px] italic truncate",
              stageOverdue ? "text-destructive font-semibold" : "text-primary/80"
            )}>
              {lead.broker_name ? lead.broker_name : "Sem corretor"}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <Badge className={cn("text-[9px] px-1.5 py-0 border h-4", src.cls)}>{src.label}</Badge>
              {isNew && roletaLeftMs > 0 && (
                <span className="text-[10px] text-primary font-medium flex items-center gap-0.5">
                  <Timer className="h-2.5 w-2.5" />{Math.ceil(roletaLeftMs / 1000)}s
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

      {/* Badges de alerta */}
      {(isBrandNew || stageOverdue) && (
        <div className="flex gap-1 mt-1.5">
          {isBrandNew && (
            <Badge className="bg-red-600 text-white text-[9px] px-1.5 py-0 h-4">NOVO</Badge>
          )}
          {stageOverdue && (
            <Badge className="bg-destructive text-white text-[9px] px-1.5 py-0 h-4 gap-0.5">
              <AlertTriangle className="h-2.5 w-2.5" /> {Math.floor(stageMinutes)}m na etapa
            </Badge>
          )}
          {inactiveAlert && !stageOverdue && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-destructive text-destructive gap-0.5">
              <AlertTriangle className="h-2.5 w-2.5" /> Inativo
            </Badge>
          )}
        </div>
      )}
    </Card>
  );
}
