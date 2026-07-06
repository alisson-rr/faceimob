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

  const load = async () => {
    const [{ data }, { data: s }] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }),
      supabase.from("lead_automation_settings").select("*").eq("id", true).maybeSingle(),
    ]);
    setLeads((data as any) || []);
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

  // Detecta atrasos por etapa e dispara popup (uma vez por lead na sessão)
  useEffect(() => {
    const alertedKey = "lead-delay-alerted";
    const alerted: string[] = JSON.parse(sessionStorage.getItem(alertedKey) || "[]");
    for (const l of leads) {
      if (l.funnel_stage === "converted" || alerted.includes(l.id)) continue;
      const max = stageMax[l.funnel_stage || "new"];
      if (!max) continue;
      const changed = new Date(l.stage_changed_at || l.created_at).getTime();
      const mins = (now - changed) / 60_000;
      if (mins > max) {
        alerted.push(l.id);
        sessionStorage.setItem(alertedKey, JSON.stringify(alerted));
        if (!popupLead) { setPopupKind("delay"); setPopupLead(l); }
        break;
      }
    }
  }, [leads, now, stageMax, popupLead]);



  return (
    <>
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

  return (
    <Card
      onClick={onClick}
      className={cn(
        "p-2.5 cursor-pointer hover:bg-secondary/60 transition-colors border-border/50 space-y-1.5 relative",
        isBrandNew && "ring-2 ring-primary/70 animate-pulse-slow",
        stageOverdue && "ring-2 ring-destructive/70"
      )}
    >
      {isBrandNew && (
        <Badge className="absolute -top-2 -right-2 bg-red-600 text-white text-[9px] px-1.5 py-0 shadow-lg animate-pulse">
          NOVO
        </Badge>
      )}
      {stageOverdue && !isBrandNew && (
        <Badge className="absolute -top-2 -right-2 bg-destructive text-white text-[9px] px-1.5 py-0 shadow-lg animate-pulse gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" /> ATRASO
        </Badge>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm truncate flex-1">{lead.name || "Sem nome"}</p>
        {inactiveAlert && <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        <Badge className={cn("text-[9px] px-1.5 py-0 border", src.cls)}>{src.label}</Badge>
        {lead.form_name && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 truncate max-w-[140px]" title={lead.form_name}>
            📋 {lead.form_name}
          </Badge>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
        <User className="h-2.5 w-2.5" /> {lead.broker_name || "Sem corretor"}
      </p>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{formatDistanceToNow(new Date(lead.created_at), { locale: ptBR, addSuffix: true })}</span>
        {isNew && roletaLeftMs > 0 && (
          <span className="flex items-center gap-0.5 text-primary font-medium">
            <Timer className="h-2.5 w-2.5" /> {Math.ceil(roletaLeftMs / 1000)}s
          </span>
        )}
        {isNew && roletaLeftMs <= 0 && (
          <span className="text-amber-500 font-medium">roleta expirada</span>
        )}
      </div>
      {waLink && (
        <Button
          size="sm"
          className="w-full h-7 bg-green-600 hover:bg-green-700 text-white text-[11px]"
          onClick={(e) => { e.stopPropagation(); window.open(waLink, "_blank"); }}
        >
          <MessageCircle className="h-3 w-3 mr-1" /> WhatsApp
        </Button>
      )}
    </Card>
  );
}
