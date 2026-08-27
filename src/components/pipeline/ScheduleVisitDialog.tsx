import { useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { scheduleVisit } from "@/integrations/supabase/activities";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { PipelineStage } from "./stages";

interface Props {
  deal: LegacyDealRecord;
  stages: PipelineStage[];
  onClose: () => void;
  onScheduled: () => void | Promise<void>;
}

/**
 * Agendamento de visita.
 *
 * Grava as duas coisas: a etapa do negócio E a linha em `visits`. Antes a visita
 * só mudava a etapa e guardava a data em `useState` — sumia no reload.
 */
export function ScheduleVisitDialog({ deal, stages, onClose, onScheduled }: Props) {
  const { user, canEnterStage } = useAuth();
  const [date, setDate] = useState<Date | undefined>();
  const [saving, setSaving] = useState(false);

  const stage = stages.find((row) => row.code === "visit_scheduled");
  const allowed = Boolean(stage) && canEnterStage(stage?.id ?? "");

  const confirm = async () => {
    if (!date || !stage) return;
    if (!user?.id) return toast({ variant: "destructive", title: "Sessão expirada" });
    setSaving(true);
    try {
      const { error } = await supabase.from("deals").update({ stage_id: stage.id }).eq("id", deal.id);
      if (error) throw error;
      await scheduleVisit({ dealId: deal.id, brokerId: user.id, scheduledAt: date.toISOString() });
      toast({ title: "Visita agendada", description: `${deal.client} em ${format(date, "dd/MM/yyyy")}.` });
      await onScheduled();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível agendar",
        description: describeError(err, "A visita não foi registrada."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-strong max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-warning" aria-hidden /> Agendar visita
          </DialogTitle>
          <DialogDescription>
            {deal.client} · {deal.project || "sem empreendimento"} {deal.unit && `· ${deal.unit}`}
          </DialogDescription>
        </DialogHeader>

        <Calendar
          mode="single" selected={date} onSelect={setDate}
          className="pointer-events-auto rounded-xl border border-border p-3"
        />

        {!allowed && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            Seu perfil não pode mover negócios para "Visita agendada".
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" disabled={!date || saving || !allowed} onClick={() => void confirm()}>
            {saving ? "Agendando…" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
