import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { dbError, describeError } from "@/lib/supabaseError";
import { updateDeal } from "./data";
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
 *
 * **O negócio vai primeiro.** São duas escritas em transações separadas, e a do
 * negócio é a que pode ser recusada — `deals_guard_closed_month` só perdoa
 * admin. Na ordem antiga o caso já estava Aprovado quando o guard barrava o
 * negócio: sobravam um toast de sucesso e um de erro juntos, o caso decidido e o
 * negócio parado no Pipeline, sem caminho de conserto para a analista. Movendo
 * o negócio antes, mês fechado recusa tudo e nada fica gravado pela metade.
 *
 * ponytail: sobra o risco inverso — `cca_cases` falhar com o negócio já movido.
 * É bem menos provável (quem abriu a tela é justamente quem `cca_cases_write`
 * aceita, e ali não há guard de mês). Evoluir para uma RPC `security definer`
 * com as duas escritas se aparecer um caso real de caso e negócio divergentes.
 */
export function CcaMoveDialog({ deal, stage, approvedStageId, onClose, onMoved }: Props) {
  const [notes, setNotes] = useState(deal.notes || "");
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      const decision = isDecision(stage.status);

      // Aprovar na esteira também aprova o negócio no funil comercial.
      //
      // O `&& approvedStageId` que estava aqui era a mesma porta pelo outro
      // lado: com o catálogo de etapas ainda carregando a prop chega
      // `undefined`, o `if` inteiro era pulado em silêncio e o caso virava
      // Aprovado com o negócio parado no Pipeline. A falta da etapa é erro, não
      // motivo para seguir — o `catch` abaixo já diz que nada foi alterado.
      if (stage.status === "approved") {
        if (!approvedStageId) {
          throw new Error('A etapa "Aprovado" do funil ainda não carregou. Tente de novo.');
        }
        await updateDeal(deal.dealId, { stage_id: approvedStageId });
      }

      // `.select("id")`: `cca_cases_write` exige `has_permission('cca.review')`
      // e a esteira habilita o botão pelo papel. Sem conferir a linha, a recusa
      // da RLS voltava 204 sem erro e a tela dizia "Caso movido" sem gravar.
      const { data: gravado, error } = await supabase
        .from("cca_cases")
        .update({
          stage_id: stage.id,
          status: stage.status,
          decision_notes: notes || null,
          decided_at: decision ? new Date().toISOString() : null,
        })
        .eq("id", deal.caseId)
        .select("id");
      if (error) throw dbError("cca_cases", error);
      if (!gravado?.length) {
        throw dbError("cca_cases", {
          code: "P0001",
          message: "Seu perfil não pode mover este caso na esteira.",
        });
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
