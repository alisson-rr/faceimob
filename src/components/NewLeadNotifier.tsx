import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BellRing, ExternalLink, HandMetal, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { claimLead, formatCountdown } from "@/integrations/supabase/leads";
import { playLeadAlert } from "@/lib/sound";

/** Só o que o payload do realtime entrega — não é o `LeadRecord` decorado. */
type IncomingLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  attend_deadline: string | null;
  campaign_name: string | null;
  utm_source: string | null;
  form_id: string | null;
  created_at: string | null;
};

const GESTOR_ROLES = ["admin", "director", "manager", "marketing"];

/** Janela em que a mudança ainda é "acabou de acontecer". */
const FRESH_MS = 20_000;

const isFresh = (iso?: string | null) =>
  Boolean(iso) && Date.now() - new Date(iso as string).getTime() < FRESH_MS;

/**
 * Aviso global de lead (ata 23/07: "notificação independente de onde o corretor
 * esteja no sistema"). Duas situações:
 *
 *   · corretor — a roleta atribuiu um lead a ele: popup, som e o cronômetro da
 *     trava, com o botão "Atender" ali mesmo;
 *   · gestor — chegou lead novo na fila.
 */
export default function NewLeadNotifier() {
  const { user, role } = useAuth();
  const profileId = user?.id || null;
  const isGestor = GESTOR_ROLES.includes(role);

  const [lead, setLead] = useState<IncomingLead | null>(null);
  const [kind, setKind] = useState<"assigned" | "queued">("assigned");
  const [now, setNow] = useState(() => Date.now());
  const [claiming, setClaiming] = useState(false);
  const navigate = useNavigate();
  // Evita repetir o mesmo aviso quando o lead sofre outros UPDATEs na sequência.
  const notified = useRef<Set<string>>(new Set());

  const announce = useCallback((row: IncomingLead, nextKind: "assigned" | "queued") => {
    const key = `${nextKind}:${row.id}:${row.assigned_at || row.created_at || ""}`;
    if (notified.current.has(key)) return;
    notified.current.add(key);

    setLead(row);
    setKind(nextKind);
    playLeadAlert();
    toast({
      title: nextKind === "assigned" ? "🔔 Lead atribuído a você!" : "🔔 Novo lead na fila",
      description: `${row.full_name || "Sem nome"} — ${row.campaign_name || row.utm_source || "origem —"}`,
    });
  }, []);

  useEffect(() => {
    if (!profileId) return;

    const channel = supabase.channel(`lead-alerts-${profileId}`);

    // Atribuição pela roleta. `payload.old` só traz a PK (replica identity
    // default), então não há como comparar o status anterior: o corte é
    // "atribuído a mim, aguardando atendimento e recém-atribuído".
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "leads", filter: `assigned_to=eq.${profileId}` },
      (payload: any) => {
        const row = payload.new as IncomingLead;
        if (row?.status !== "assigned") return;
        if (!isFresh(row.assigned_at)) return;
        announce(row, "assigned");
      },
    );

    // Um lead pode ser criado já com corretor (realocação/importação dirigida):
    // o INSERT também precisa avisar o dono.
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "leads", filter: `assigned_to=eq.${profileId}` },
      (payload: any) => {
        const row = payload.new as IncomingLead;
        if (row?.status !== "assigned") return;
        announce(row, "assigned");
      },
    );

    if (isGestor) {
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads" },
        (payload: any) => {
          const row = payload.new as IncomingLead;
          if (row?.assigned_to) return; // já tem dono: o aviso é dele
          if (!isFresh(row.created_at)) return;
          announce(row, "queued");
        },
      );
    }

    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profileId, isGestor, announce]);

  useEffect(() => {
    if (!lead) return;
    const ticker = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [lead]);

  const secondsLeft = lead?.attend_deadline
    ? Math.max(0, Math.ceil((new Date(lead.attend_deadline).getTime() - now) / 1000))
    : null;

  const attend = async () => {
    if (!lead) return;
    setClaiming(true);
    try {
      await claimLead(lead.id);
      toast({ title: "Lead em atendimento", description: `${lead.full_name || "Lead"} está travado com você.` });
      setLead(null);
      navigate("/pipeline");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: err instanceof Error ? err.message : "o lead pode ter voltado à fila",
      });
      setLead(null);
    } finally {
      setClaiming(false);
    }
  };

  const assigned = kind === "assigned";

  return (
    <Dialog open={!!lead} onOpenChange={(v) => !v && setLead(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary animate-pulse" />
            {assigned ? "Lead atribuído a você!" : "Novo lead na fila"}
          </DialogTitle>
          <DialogDescription>
            {assigned
              ? "Clique em Atender para travar o lead com você e parar o cronômetro."
              : "Um lead novo entrou na fila de distribuição."}
          </DialogDescription>
        </DialogHeader>
        {lead && (
          <div className="space-y-2 py-2">
            <p className="text-lg font-semibold">{lead.full_name || "Sem nome"}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {(lead.campaign_name || lead.utm_source) && (
                <Badge variant="outline">{lead.campaign_name || lead.utm_source}</Badge>
              )}
              {lead.form_id && <Badge variant="outline">📋 {lead.form_id}</Badge>}
              {lead.phone && <Badge variant="outline">{lead.phone}</Badge>}
            </div>
            {assigned && secondsLeft !== null && (
              <p className={cn(
                "text-sm font-semibold flex items-center gap-1",
                secondsLeft <= 60 ? "text-destructive" : "text-warning",
              )}>
                <Timer className="h-4 w-4" />
                {secondsLeft > 0
                  ? `${formatCountdown(secondsLeft)} para atender antes de voltar à fila`
                  : "Prazo estourado — o lead está voltando para a fila"}
              </p>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setLead(null)}>Depois</Button>
          {assigned ? (
            <Button onClick={attend} disabled={claiming || secondsLeft === 0}>
              <HandMetal className="h-4 w-4 mr-1" /> {claiming ? "Atendendo..." : "Atender agora"}
            </Button>
          ) : (
            <Button onClick={() => { setLead(null); navigate("/pipeline"); }}>
              <ExternalLink className="h-4 w-4 mr-1" /> Abrir funil
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
