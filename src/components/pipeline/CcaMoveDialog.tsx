import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { dbError, describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import { updateDeal, useCanExitStage, useDeals } from "./data";
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
 * **O caso vai primeiro; o negócio é consequência.** São duas escritas em
 * transações separadas, e a do negócio é a que pode ser recusada — a matriz de
 * etapas (`deals_guard_stage`) e o mês fechado (`deals_guard_closed_month`)
 * cobram a analista, que não é dona do funil comercial. Enquanto o `updateDeal`
 * vinha primeiro, um 42501 abortava o `confirm` inteiro: o caso NÃO era decidido
 * e a analista ficava sem caminho nenhum — nem esteira, nem funil. Decidir o
 * caso é o trabalho dela; a etapa que não andou vira aviso no mesmo toast, e o
 * negócio segue movível pelo Pipeline por quem tem a etapa.
 */
export function CcaMoveDialog({ deal, stage, approvedStageId, onClose, onMoved }: Props) {
  const { canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  const [notes, setNotes] = useState(deal.notes || "");
  const [saving, setSaving] = useState(false);

  // `CcaDeal` carrega o estágio da ESTEIRA, não a etapa do negócio no funil
  // comercial — e sem ela não dá para espelhar a metade "sair" da matriz. A
  // lista de negócios é cache compartilhado (`["deals"]`), não uma consulta
  // nova por caso.
  const negocio = useDeals().data?.find((row) => row.id === deal.dealId);

  /**
   * Por que o negócio NÃO vai andar no funil — `""` quando ele anda.
   *
   * As DUAS metades da matriz, como em `ScheduleVisitDialog`: o
   * `deals_guard_stage` cobra `can_exit_stage(etapa atual)` ANTES de olhar o
   * destino, e checar só o "entrar" fazia este diálogo prometer a
   * movimentação para o banco recusá-la depois.
   *
   * Etapa atual ainda desconhecida (lista não carregou, ou o negócio não está
   * na visibilidade de quem analisa) não vira promessa nem recusa: o
   * `updateDeal` tenta e o toast conta o que voltou — é o degradê que este
   * diálogo já tinha. Negócio JÁ em "Aprovado" também não precisa sair de
   * lugar nenhum: a 0101 só cobra a matriz quando o `stage_id` muda.
   */
  const motivoParado = !approvedStageId
    ? 'a etapa "Aprovado" do funil ainda não carregou.'
    : !canEnterStage(approvedStageId)
      ? 'seu perfil não pode mover negócios para "Aprovado" no funil.'
      : negocio && negocio.stage_id !== approvedStageId && !canExitStage(negocio.stage_id)
        ? `seu perfil não pode tirar um negócio de "${negocio.stage_label}".`
        : "";

  const confirm = async () => {
    setSaving(true);
    try {
      const decision = isDecision(stage.status);

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

      // O caso JÁ está decidido. Uma recusa aqui (matriz de etapas, mês fechado)
      // não desfaz a decisão: avisa e deixa o negócio para quem move o funil.
      let avisoNegocio = "";
      if (stage.status === "approved") {
        if (motivoParado) {
          avisoNegocio = motivoParado;
        } else if (approvedStageId) {
          try {
            await updateDeal(deal.dealId, { stage_id: approvedStageId });
          } catch (err) {
            avisoNegocio = describeError(err, "o negócio não foi movido no funil.");
          }
        }
      }

      toast({
        title: "Caso movido",
        description: avisoNegocio
          ? `${deal.client} → ${stage.name}. O negócio ficou parado no Pipeline: ${avisoNegocio}`
          : `${deal.client} → ${stage.name}.`,
      });
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

        {/* Mesma frase do toast, do mesmo `motivoParado`: enquanto o painel e o
            toast montavam o motivo cada um por sua conta, um podia prometer o
            que o outro desmentia. */}
        {stage.status === "approved" && motivoParado && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            O caso será aprovado, mas o negócio continua na etapa atual do funil: {motivoParado}
          </p>
        )}

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
