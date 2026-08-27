import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { ccaStatusLabel, isDecision } from "./ccaStage";
import type { CcaDeal, CcaStage } from "./ccaData";

interface Props {
  deal: CcaDeal;
  stage: CcaStage;
  /** `id` da etapa "Aprovado" do funil comercial, para levar o negócio junto. */
  approvedStageId?: string;
  onClose: () => void;
  onMoved: () => void | Promise<void>;
}

/**
 * Confirmação da movimentação na esteira.
 *
 * O desfecho vem do estágio (`cca_stages.status`), que o operador escolhe ao
 * criar o estágio: um "Aprovado" criado pela tela nascia `under_review` e não
 * decidia nem movia nada (achado P10).
 */
export function CcaMoveDialog({ deal, stage, approvedStageId, onClose, onMoved }: Props) {
  const [notes, setNotes] = useState(deal.notes || "");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      const decision = isDecision(stage.status);
      const { error } = await supabase
        .from("cca_cases")
        .update({
          stage_id: stage.id,
          status: stage.status,
          decision_notes: notes || null,
          decided_at: decision ? new Date().toISOString() : null,
        })
        .eq("id", deal.caseId);
      if (error) throw error;

      // Aprovar na esteira também aprova o negócio no funil comercial.
      if (stage.status === "approved" && approvedStageId) {
        const { error: dealError } = await supabase
          .from("deals").update({ stage_id: approvedStageId }).eq("id", deal.dealId);
        if (dealError) {
          toast({
            variant: "destructive",
            title: "Caso atualizado, mas o negócio ficou para trás",
            description: describeError(dealError, "Mova o negócio no Pipeline."),
          });
        }
      }

      toast({ title: "Caso movido", description: `${deal.client} → ${stage.name}.` });
      await onMoved();
      onClose();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao mover o caso",
        description: describeError(err, "Nada foi alterado no servidor."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover para {stage.name}</DialogTitle>
          <DialogDescription>
            {deal.client} · desfecho <strong className="text-foreground">{ccaStatusLabel(stage.status)}</strong>
            {isDecision(stage.status) && " — esta movimentação decide o caso."}
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="cca-move-notes">Observações</Label>
          <Textarea
            id="cca-move-notes" rows={3} className="mt-1 text-xs"
            value={notes} onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={saving} onClick={() => void confirm()}>
            {saving ? "Movendo…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
