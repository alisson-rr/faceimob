import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { LOSS_REASONS, isLossStatus } from "@/lib/dealStatus";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal, useCanExitStage } from "./data";
import { LOST_STAGE_CODE, type PipelineStage } from "./stages";

interface Props {
  deal: LegacyDealRecord;
  /** Status já escolhido no Select da tabela, quando a perda veio de lá. */
  presetStatus?: string;
  stages: PipelineStage[];
  onClose: () => void;
  onConfirmed: () => void | Promise<void>;
}

/**
 * Confirmação de perda do negócio (achado F14).
 *
 * O caminho antigo era um `Switch` em `scale-75` na última coluna: um clique
 * gravava `stage=lost` com o motivo fixo "Arquivado manualmente" — e a própria
 * tela avisava que negócio encerrado não reabre por ali. Agora a perda é ação
 * nomeada, com motivo obrigatório, e passa pela mesma trava de etapa que o
 * arrastar do kanban.
 *
 * **Obrigatório de verdade, não pré-selecionado.** O motivo nascia em
 * `LOSS_REASONS[0]` = "17. DISTRATO" — o rótulo mais forte da lista — e quem
 * apertasse "Encerrar negócio" sem olhar gravava um distrato. Sem `presetStatus`
 * o campo agora nasce vazio e o botão fica desabilitado até haver escolha. Com
 * `presetStatus` (a perda veio do Select da tabela) o pré-preenchimento fica:
 * ali a escolha já foi feita, pedir de novo é atrito à toa.
 */
export function LoseDealDialog({ deal, presetStatus, stages, onClose, onConfirmed }: Props) {
  const { canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  const id = useId();
  const lostStage = stages.find((stage) => stage.code === LOST_STAGE_CODE);
  const [status, setStatus] = useState(
    presetStatus && isLossStatus(presetStatus) ? presetStatus : "",
  );
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // As DUAS metades da matriz: `deals_guard_stage` cobra `can_exit_stage` da
  // etapa atual antes de olhar a de destino, e só o "entrar" era espelhado aqui
  // — hoje corretor e gerente não saem de "Aprovado", e o diálogo abria o
  // confirmar assim mesmo, para levar 42501.
  const canLeave = canExitStage(deal.stage_id);
  const allowed = Boolean(lostStage) && canEnterStage(lostStage?.id ?? "") && canLeave;
  // Um preset sem prefixo ("QUEDA", vindo de importação) é motivo válido e não
  // está na lista literal: sem ele nas opções o Select abriria em branco.
  const choices = !status || LOSS_REASONS.includes(status) ? LOSS_REASONS : [status, ...LOSS_REASONS];

  const confirm = async () => {
    if (!lostStage || !status) return;
    setSaving(true);
    try {
      const reason = notes.trim() ? `${status} — ${notes.trim()}` : status;
      // `updateDeal` e não o `update` cru: sem `.select()`, uma linha filtrada
      // pela RLS devolve 204 sem erro e a tela dizia "Negócio encerrado" com o
      // negócio intacto no banco.
      await updateDeal(deal.id, {
        stage_id: lostStage.id, status_detail: status, lost_reason: reason,
      });
      toast({ title: "Negócio encerrado", description: `${deal.client} — ${status}.` });
      await onConfirmed();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível encerrar o negócio",
        description: describeError(err, "O status não foi alterado no servidor."),
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
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
            Encerrar o negócio de {deal.client}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            O negócio sai do funil, deixa de contar no VGV e no ranking do game.
            Só o administrador reabre, pelo botão de reabrir na linha do negócio.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor={`${id}-reason`}>Motivo</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id={`${id}-reason`} className="mt-1">
                <SelectValue placeholder="Escolha o motivo" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-notes`}>Observação (opcional)</Label>
            <Textarea
              id={`${id}-notes`} rows={2} className="mt-1"
              value={notes} onChange={(event) => setNotes(event.target.value)}
              placeholder="O que aconteceu com este negócio?"
            />
          </div>
          {!allowed && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {canLeave
                ? "Seu perfil não pode mover negócios para a etapa de perda. Peça a um gestor."
                : `Seu perfil não pode tirar um negócio de "${deal.stage_label}". Peça a um gestor.`}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving || !allowed || !status}
            onClick={(event) => { event.preventDefault(); void confirm(); }}
          >
            {saving ? "Encerrando…" : "Encerrar negócio"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
