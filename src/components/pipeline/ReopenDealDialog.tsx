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
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal, useCanExitStage } from "./data";
import { isOffOrDistrato } from "./LoseDealDialog";
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
 * **A mesma autorização das outras telas, e não um `isAdmin` só no botão.**
 * Reabrir é uma mudança de etapa: quem decide é a matriz `stage_permissions`
 * (sair de "Perdido", entrar em "Proposta"), a mesma do arraste do kanban, com
 * admin e sócio passando por cima. E quando o negócio foi encerrado como OFF ou
 * distrato, apagar esse rótulo exige `deals.mark_off_distrato` — apagar um
 * distrato é a mesma decisão que marcá-lo.
 *
 * O motivo vira comentário no histórico (`add_deal_comment`): `deal_history` é
 * log imutável e a mudança de etapa já entra sozinha por trigger, mas o PORQUÊ
 * da reabertura só existe se alguém escrever.
 */
export function ReopenDealDialog({ deal, stages, onClose, onReopened }: Props) {
  const { can, canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  const id = useId();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const target = stages.find((stage) => stage.code === "proposal") ?? stages[0];

  const canLeave = canExitStage(deal.stage_id);
  const canEnter = Boolean(target) && canEnterStage(target?.id ?? "");
  // O rótulo gravado pode estar em qualquer uma das duas colunas: o diálogo de
  // perda escreve as duas, mas negócio importado só tem `lost_reason`.
  const eraOffOuDistrato = isOffOrDistrato(deal.status_detail) || isOffOrDistrato(deal.lost_reason);
  const podeApagarRotulo = !eraOffOuDistrato || can("deals.mark_off_distrato");
  const allowed = Boolean(target) && canLeave && canEnter && podeApagarRotulo;

  const recusa = !target
    ? "O catálogo de etapas ainda não carregou."
    : !podeApagarRotulo
      ? "Reabrir um negócio marcado como OFF ou distrato é do administrador e do sócio."
      : !canLeave
        ? `Seu perfil não pode tirar um negócio de "${deal.stage_label}". Peça a um gestor.`
        : !canEnter
          ? `Seu perfil não pode mover negócios para "${target.label}". Peça a um gestor.`
          : "";

  const confirm = async () => {
    if (!target || !allowed) return;
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
            {/* Regra da 0142: reabrir não mexe em ponto nenhum; é GANHAR de novo
                que retira o distrato da temporada aberta. Venda que já pontuou
                numa temporada encerrada não pontua outra vez (item j). O texto
                antigo dizia que reabrir já devolvia VGV e ranking — negócio
                aberto não conta em nenhum dos dois. */}
            Ele volta para <strong className="text-foreground">{target?.label ?? "a primeira etapa"}</strong> e
            o motivo da perda{deal.lost_reason ? ` ("${deal.lost_reason}")` : ""} é apagado. Reabrir não
            mexe nos pontos do game. Se ele for ganho de novo, volta a contar no VGV e a penalidade de
            distrato desta temporada sai; uma venda que já pontuou numa temporada encerrada não pontua
            outra vez.
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

        {recusa && (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            {recusa}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving || !allowed}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
          >
            {saving ? "Reabrindo…" : "Reabrir negócio"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
