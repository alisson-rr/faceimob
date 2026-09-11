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
 * Grava as duas coisas: a linha em `visits` E, quando cabe, a etapa do negócio.
 * Antes a visita só mudava a etapa e guardava a data em `useState` — sumia no
 * reload.
 *
 * **A visita vem primeiro, e a etapa é consequência.** Agendar é o trabalho do
 * corretor; mover o funil é efeito colateral, e é a única das duas escritas que
 * a matriz de etapas (`stage_permissions`, cobrada pelo `deals_guard_stage`)
 * pode recusar. Na ordem antiga o `updateDeal` vinha primeiro e um 42501 abortava
 * o `confirm` inteiro: quem não pode mover o funil também perdia a visita, que
 * ninguém restringiu. Agora a recusa da etapa vira aviso no mesmo toast.
 *
 * A etapa só anda para FRENTE e só em negócio aberto. Gravá-la sem condição
 * ressuscitava negócio perdido: `deals_guard_stage` põe `outcome = 'open'` e
 * `closed_at = null` ao entrar numa etapa aberta, então um clique no calendário
 * devolvia ao funil (e ao VGV, e ao ranking) um negócio encerrado, com o motivo
 * da perda ainda gravado.
 */
export function ScheduleVisitDialog({ deal, stages, onClose, onScheduled }: Props) {
  const { user, canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  const [date, setDate] = useState<Date | undefined>();
  const [saving, setSaving] = useState(false);

  const stage = stages.find((row) => row.code === "visit_scheduled");
  /** O negócio está ATRÁS de "Visita agendada"? Só nesse caso há etapa a mover. */
  const behind = deal.active && Boolean(stage) && deal.stage_position < (stage?.position ?? 0);
  /** Mover exige a matriz inteira — sair da etapa atual e entrar na de destino —,
   *  que é o que o `deals_guard_stage` cobra. Registrar a visita não exige nada:
   *  é linha em `visits`, não mudança de funil. */
  const canMove = Boolean(stage) && canEnterStage(stage?.id ?? "") && canExitStage(deal.stage_id);
  const moveTo = behind && canMove && stage ? stage.id : null;

  const confirm = async () => {
    if (!date) return;
    if (!user?.id) return toast({ variant: "destructive", title: "Sessão expirada" });
    setSaving(true);
    try {
      await scheduleVisit({ dealId: deal.id, brokerId: user.id, scheduledAt: date.toISOString() });
      // A visita JÁ está gravada. Se o banco recusar a etapa (a matriz da tela
      // pode estar desatualizada em relação à do servidor), o agendamento não é
      // desfeito: o aviso entra no toast de sucesso em vez de virar erro.
      let avisoEtapa = "";
      if (moveTo) {
        try {
          await updateDeal(deal.id, { stage_id: moveTo });
        } catch (err) {
          avisoEtapa = describeError(err, "A etapa não foi movida.");
        }
      }
      const quando = format(date, "dd/MM/yyyy");
      toast({
        title: "Visita agendada",
        description: avisoEtapa
          ? `${deal.client} em ${quando}. O negócio continua em "${deal.stage_label}": ${avisoEtapa}`
          : `${deal.client} em ${quando}.`,
      });
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

        {behind && !canMove && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            A visita será registrada, mas o negócio continua em "{deal.stage_label}":{" "}
            {canExitStage(deal.stage_id)
              ? 'seu perfil não pode mover negócios para "Visita agendada".'
              : `seu perfil não pode tirar um negócio de "${deal.stage_label}".`}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
          <Button size="sm" disabled={!date || saving} onClick={() => void confirm()}>
            {saving ? "Agendando…" : "Agendar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
