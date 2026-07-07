import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BellRing, ExternalLink } from "lucide-react";

type LeadRow = any;

/**
 * Global listener: shows a popup whenever a new lead is inserted,
 * regardless of the current route.
 */
export default function NewLeadNotifier() {
  const [popupLead, setPopupLead] = useState<LeadRow | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const ch = supabase
      .channel("global-new-leads")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "leads" },
        (payload: any) => {
          const l = payload.new;
          // Ignora repasse/redistribuição: só notifica leads realmente novos
          // (recém-criados, ainda sem corretor e status "new").
          const createdAt = l?.created_at ? new Date(l.created_at).getTime() : 0;
          const isFresh = createdAt && Date.now() - createdAt < 15_000;
          const isNewIncoming = !l?.broker_id && (l?.status ?? "new") === "new";
          if (!isFresh || !isNewIncoming) return;

          setPopupLead(l);
          try {
            new Audio(
              "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQAAAAA="
            ).play().catch(() => {});
          } catch {}
          toast({
            title: "🔔 Novo Lead recebido!",
            description: `${l.name || "Sem nome"} — ${l.source || "origem —"}`,
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <Dialog open={!!popupLead} onOpenChange={(v) => !v && setPopupLead(null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5 text-primary animate-pulse" /> Novo Lead recebido!
          </DialogTitle>
          <DialogDescription>
            Um novo lead acabou de chegar. Aja rápido para não perder!
          </DialogDescription>
        </DialogHeader>
        {popupLead && (
          <div className="space-y-2 py-2">
            <p className="text-lg font-semibold">{popupLead.name || "Sem nome"}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              {popupLead.source && <Badge variant="outline">{popupLead.source}</Badge>}
              {popupLead.form_name && <Badge variant="outline">📋 {popupLead.form_name}</Badge>}
              {popupLead.broker_name && <Badge variant="outline">👤 {popupLead.broker_name}</Badge>}
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setPopupLead(null)}>Depois</Button>
          <Button
            onClick={() => {
              setPopupLead(null);
              navigate("/pipeline");
            }}
          >
            <ExternalLink className="h-4 w-4 mr-1" /> Abrir Pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
