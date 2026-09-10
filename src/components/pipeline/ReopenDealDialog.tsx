import { useId, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/supabaseError";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal } from "./data";
import type { PipelineStage } from "./stages";

interface Props {
  deal: LegacyDealRecord;
  stages: PipelineStage[];
  onClose: () => void;
  onReopened: () => void | Promise<void>;
}

/**
 * Reabrir negócio encerrado — o desfazer que não existia.
 *
 * O `LoseDealDialog` avisa que "reabrir depois exige um gestor", mas não havia
 * tela, botão nem RPC para o gestor usar: o único caminho era UPDATE direto no
 * banco, o que na prática significa que ninguém desfazia. Encerrar por engano
 * tira o negócio do funil, do VGV e do ranking do game.
 *
 * Volta para "Proposta" (a primeira etapa em que um negócio vivo faz sentido —
 * "Incompleto" é onde ele nasce) e limpa `lost_reason`. O `deals_guard_stage`
 * põe `outcome = 'open'` e `closed_at = null` ao entrar numa etapa aberta, então
 * a reabertura é ato do banco, não uma coluna que a tela escreve à mão.
 *
 * O motivo vira comentário no histórico (`add_deal_comment`): `deal_history` é
 * log imutável e a mudança de etapa já entra sozinha por trigger, mas o PORQUÊ
 * da reabertura só existe se alguém escrever.
 */
export function ReopenDealDialog({ deal, stages, onClose, onReopened }: Props) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const target = stages.find((stage) => stage.code === "proposal") ?? stages[0];

  const confirm = async () => {
    if (!target) return;
    setSaving(true);
    try {
      // `updateDeal` (com `.select`) e não o update cru: linha filtrada pela
      // RLS volta 204 sem erro, e a tela diria "reaberto" com o negócio
      // encerrado do mesmo jeito.
      // `status_detail` junto do `lost_reason`: limpar só o motivo devolvia o
      // negócio a "Proposta" ainda exibindo "18. QUEDA" no Status 2 — e o
      // salvamento seguinte lia esse rótulo em `dealStageCodeFor`, mandava o
      // negócio de volta para `lost` e desfazia a reabertura sem avisar.
      // Nulo = o Status 2 volta a ser DERIVADO do desfecho, como em qualquer
      // negócio aberto que ninguém rotulou à mão.
      await updateDeal(deal.id, { stage_id: target.id, lost_reason: null, status_detail: null });
      const nota = reason.trim();
      if (nota) {
        const { error } = await supabase.rpc("add_deal_comment", {
          p_deal_id: deal.id,
          p_body: `Negócio reaberto: ${nota}`,
        });
        // O negócio JÁ voltou; falhar o comentário não desfaz nada. Avisa em
        // separado em vez de dizer que a reabertura não aconteceu.
        if (error) {
          toast({
            variant: "destructive",
            title: "Negócio reaberto, mas sem registro no histórico",
            description: describeError(error, "O comentário não foi gravado."),
          });
        }
      }
      toast({
        title: "Negócio reaberto",
        description: `${deal.client} voltou para ${target.label}.`,
      });
      await onReopened();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível reabrir o negócio",
        description: describeError(err, "O negócio continua encerrado no servidor."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" aria-hidden />
            Reabrir o negócio de {deal.client}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Ele volta para <strong className="text-foreground">{target?.label ?? "a primeira etapa"}</strong>,
            volta a contar no VGV e no ranking do game, e o motivo da perda
            {deal.lost_reason ? ` ("${deal.lost_reason}")` : ""} é apagado.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div>
          <Label htmlFor={`${id}-reason`}>Por que está reabrindo? (opcional)</Label>
          <Textarea
            id={`${id}-reason`} rows={2} className="mt-1"
            value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="Fica registrado no histórico do negócio."
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving || !target}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
          >
            {saving ? "Reabrindo…" : "Reabrir negócio"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
