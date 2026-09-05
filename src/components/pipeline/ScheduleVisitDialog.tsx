import { useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { scheduleVisit } from "@/integrations/supabase/activities";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal, useCanExitStage } from "./data";
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
 *
 * A etapa só anda para FRENTE e só em negócio aberto. Gravá-la sem condição
 * ressuscitava negócio perdido: `deals_guard_stage` põe `outcome = 'open'` e
 * `closed_at = null` ao entrar numa etapa aberta, então um clique no calendário
 * devolvia ao funil (e ao VGV, e ao ranking) um negócio encerrado, com o motivo
 * da perda ainda gravado. A visita, essa, é registrada sempre.
 */
export function ScheduleVisitDialog({ deal, stages, onClose, onScheduled }: Props) {
  const { user, canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  const [date, setDate] = useState<Date | undefined>();
  const [saving, setSaving] = useState(false);

  const stage = stages.find((row) => row.code === "visit_scheduled");
  /** A visita só ANDA com a etapa quando o negócio está atrás dela; nesse caso
   *  vale a matriz inteira (sair da atual e entrar em "Visita agendada"), que é
   *  o que o `deals_guard_stage` cobra. Registrar a visita sem mover a etapa
   *  continua permitido — é linha em `visits`, não mudança de funil. */
  const willMove = deal.active && Boolean(stage) && deal.stage_position < (stage?.position ?? 0);
  const allowed = Boolean(stage)
    && (!willMove || (canEnterStage(stage?.id ?? "") && canExitStage(deal.stage_id)));

  const confirm = async () => {
    if (!date || !stage) return;
    if (!user?.id) return toast({ variant: "destructive", title: "Sessão expirada" });
    setSaving(true);
    try {
      if (willMove) {
        await updateDeal(deal.id, { stage_id: stage.id });
      }
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
            {canExitStage(deal.stage_id)
              ? 'Seu perfil não pode mover negócios para "Visita agendada".'
              : `Seu perfil não pode tirar um negócio de "${deal.stage_label}".`}
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
