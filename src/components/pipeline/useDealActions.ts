import { useCallback } from "react";
import { toast } from "@/hooks/use-toast";
import { describeError } from "@/lib/supabaseError";
import { isLossStatus, normalizeStatus } from "@/lib/dealStatus";
import { useAuth } from "@/contexts/AuthContext";
import { submitDealForManagerReview } from "@/integrations/supabase/documents";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal, useCanExitStage, useInvalidateDeals } from "./data";
import { blockedMoveReason } from "./guards";
import type { PipelineStage } from "./stages";

/**
 * Escritas do Pipeline: mover de etapa e trocar o Status 2.
 *
 * Fora da tela porque as duas coisas têm a mesma trava (`can_enter_stage()`) e
 * o mesmo caminho de erro — e porque o arrastar do kanban, o teclado e o Select
 * da tabela precisam chamar exatamente a mesma função. Duplicar a regra em cada
 * gatilho era o jeito garantido de o teclado permitir o que o mouse recusa.
 */
export function useDealActions({ stages, closedMonths, onNeedsLossConfirmation }: {
  stages: PipelineStage[];
  /** Meses em `closed_months`: o gatilho recusa edição de negócio deles. */
  closedMonths: string[];
  /** Status que significa perda não grava direto: vai para a confirmação (F14). */
  onNeedsLossConfirmation: (deal: LegacyDealRecord, status: string) => void;
}) {
  const { canEnterStage, isAdmin } = useAuth();
  const canExitStage = useCanExitStage();
  const invalidateDeals = useInvalidateDeals();

  const moveDeal = useCallback(async (deal: LegacyDealRecord, stage: PipelineStage) => {
    // As quatro recusas do banco (sair da etapa, entrar na etapa, mês fechado e
    // conferência documental) num lugar só, ANTES da escrita — e o mesmo lugar
    // para o arraste, a seta do teclado e o botão de mover do cartão.
    const blocked = blockedMoveReason(deal, stage, {
      isAdmin, canEnterStage, canExitStage, closedMonths,
    });
    if (blocked) {
      toast({ variant: "destructive", title: "Movimentação não permitida", description: blocked });
      return;
    }

    try {
      // Entrar em análise passa pela conferência do gerente: o card só anda
      // depois que os documentos forem aprovados.
      if (stage.code === "under_analysis" && deal.stage !== "under_analysis"
          && deal.document_review_status !== "approved") {
        await submitDealForManagerReview(deal.id);
        await invalidateDeals();
        toast({
          title: "Enviado para conferência do gerente",
          description: "O negócio segue para Em análise quando os documentos forem aprovados.",
        });
        return;
      }

      // Sem atualização otimista de propósito: quando a escrita falhava, o card
      // ficava na coluna nova com o banco recusando — a tela mentia sobre o
      // estado real até o próximo reload.
      await updateDeal(deal.id, { stage_id: stage.id });
      await invalidateDeals();
      toast({ title: `Negócio movido para ${stage.label}` });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível mover o negócio",
        description: describeError(err, "A etapa não foi atualizada no servidor."),
      });
    }
  }, [canEnterStage, canExitStage, closedMonths, invalidateDeals, isAdmin]);

  const changeStatus = useCallback(async (deal: LegacyDealRecord, status: string) => {
    // Contra a lista de motivos do diálogo, não contra `normalizeStatus`: este
    // `if` listava QUEDA/DISTRATO/OFF e "19. REPROVADO" — que é um dos motivos
    // oferecidos na confirmação — escapava para o `update` direto, deixando o
    // negócio ativo no funil com `lost_reason` nulo e sem ninguém confirmar.
    if (isLossStatus(status)) {
      onNeedsLossConfirmation(deal, status);
      return;
    }

    const outcome = normalizeStatus(status);
    try {
      const closedStage = outcome === "VENDA" ? stages.find((row) => row.code === "closed") : null;
      if (outcome === "VENDA" && !closedStage) throw new Error("Etapa de fechamento não encontrada.");
      // Mesmas travas do arraste: marcar "VENDA" aqui MOVE o negócio para
      // "Fechado", e a etapa exige sair da atual e ter a documentação aprovada.
      const blocked = closedStage
        && blockedMoveReason(deal, closedStage, { isAdmin, canEnterStage, canExitStage, closedMonths });
      if (blocked) {
        toast({ variant: "destructive", title: "Movimentação não permitida", description: blocked });
        return;
      }

      await updateDeal(deal.id, {
        status_detail: status,
        lost_reason: null,
        ...(closedStage ? { stage_id: closedStage.id } : {}),
      });
      await invalidateDeals();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar o status",
        description: describeError(err, "O status não foi atualizado no servidor."),
      });
    }
  }, [canEnterStage, canExitStage, closedMonths, invalidateDeals, isAdmin, onNeedsLossConfirmation, stages]);

  return { moveDeal, changeStatus };
}
