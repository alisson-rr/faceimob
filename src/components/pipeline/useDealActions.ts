import { useCallback } from "react";
import { toast } from "@/components/ui/sonner";
import { describeError } from "@/lib/supabaseError";
import { bareStatus, isLossStatus, normalizeStatus } from "@/lib/dealStatus";
import { useAuth } from "@/contexts/AuthContext";
import { submitDealForManagerReview } from "@/integrations/supabase/documents";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { PipelineDeal } from "@/types/crm";
import { updateDeal, useCanExitStage, useInvalidateDeals } from "./data";
import { blockedMoveReason } from "./guards";
import type { PipelineStage } from "./stages";

/**
 * Recusa de OFF e DISTRATO por permissão, ou `null` quando ela passa.
 *
 * Os dois rótulos, e só eles: o pedido de 10/09/2026 é "off e distrato é só
 * adm" e não diz nada sobre o resto do Status 2. A rodada anterior travou o
 * catálogo inteiro e tirou do corretor rótulos que sempre foram dele.
 *
 * Quem reconhece o rótulo é `normalizeStatus`, a MESMA normalização do banco
 * (`deal_status_bare`): a tabela manda "17. DISTRATO" e um `status_detail`
 * importado pode vir "DISTRATO" — comparar o texto cru só casaria um dos dois.
 *
 * Exportada porque a tabela e o editor precisam da MESMA resposta ANTES do
 * gesto (a opção nasce desabilitada, com o motivo) e o hook a aplica na
 * escrita. Enquanto a frase e o código de permissão vivessem duas vezes,
 * soltar uma delas era só questão de tempo.
 *
 * `can()` curto-circuita em admin igual ao `has_permission()` do banco, e desde
 * a 0097 `is_admin()` é admin OU sócio — os dois passam sem linha própria.
 */
export const offDistratoBlocked = (
  can: (code: string) => boolean,
  status: string | null | undefined,
): string | null => {
  const outcome = normalizeStatus(status);
  if (outcome !== "OFF" && outcome !== "DISTRATO") return null;
  return can("deals.mark_off_distrato")
    ? null
    : "Só administrador e sócio marcam OFF e distrato.";
};

/**
 * Negócio que, ao chegar em "Fechado", ganha o card de venda do `EngagementLayer`.
 *
 * O card nasce da linha `venda` em `game_events`, e o banco só a lança para
 * corretor do rateio (0142): negócio só com gerente fecha sem card, e é nele que
 * o toast de sucesso local precisa continuar. Venda que já pontuou numa temporada
 * fechada também fica sem card, e isso a tela não tem como saber.
 */
export const vendaTemCard = (deal: Pick<PipelineDeal, "broker1_id" | "broker2_id" | "broker3_id">): boolean =>
  Boolean(deal.broker1_id || deal.broker2_id || deal.broker3_id);

/**
 * Escritas do Pipeline: mover de etapa e trocar o Status 2.
 *
 * Fora da tela porque o arraste do kanban, o teclado, o Select da tabela e o
 * editor precisam chamar exatamente a mesma função — duplicar a regra em cada
 * gatilho era o jeito garantido de o teclado permitir o que o mouse recusa.
 *
 * Quem autoriza cada uma das duas é DIFERENTE, e tratá-las como a mesma coisa
 * foi o defeito da primeira versão da trava de 10/09/2026:
 *
 *   · **Etapa (Status 1)** — a matriz `stage_permissions` (`can_enter`/
 *     `can_exit`), que o admin já administra em Admin · Permissões e que
 *     `deals_guard_stage` cobra no banco. Um código de permissão próprio
 *     (`deals.edit_stage`) passava POR CIMA dela: o admin concedia a etapa na
 *     tela e a concessão não produzia efeito nenhum, enquanto três fluxos
 *     legítimos que gravam `stage_id` pelo token de quem clica — agendar
 *     visita, aprovar o caso no CCA e encerrar o negócio — caíam em 42501.
 *   · **Desfecho** — só OFF e DISTRATO, por `deals.mark_off_distrato`. O resto
 *     do Status 2 continua livre, como sempre foi.
 */
export function useDealActions({ stages, closedMonths, onNeedsLossConfirmation }: {
  stages: PipelineStage[];
  /** Meses em `closed_months`: o gatilho recusa edição de negócio deles. */
  closedMonths: string[];
  /** Status que significa perda não grava direto: vai para a confirmação (F14). */
  onNeedsLossConfirmation: (deal: LegacyDealRecord, status: string) => void;
}) {
  const { canEnterStage, isAdmin, can } = useAuth();
  const canExitStage = useCanExitStage();
  const invalidateDeals = useInvalidateDeals();

  const moveDeal = useCallback(async (deal: LegacyDealRecord, stage: PipelineStage) => {
    // As quatro recusas (sair da etapa, entrar na etapa, mês fechado e
    // conferência documental) num lugar só, ANTES da escrita — e o mesmo lugar
    // para o arraste, a seta do teclado e o botão de mover do cartão.
    const blocked = blockedMoveReason(deal, stage, {
      isAdmin, canEnterStage, canExitStage, closedMonths,
    });
    if (blocked) {
      toast.error("Não foi possível mover o negócio", { description: blocked });
      return;
    }

    // Entrar em análise passa pela conferência do gerente: o card só anda
    // depois que os documentos forem aprovados.
    const conferencia = stage.code === "under_analysis" && deal.stage !== "under_analysis"
      && deal.document_review_status !== "approved";
    try {
      if (conferencia) {
        await submitDealForManagerReview(deal.id);
        await invalidateDeals();
        toast.success("Negócio enviado para conferência", {
          description: "O negócio segue para Em análise quando os documentos forem aprovados.",
        });
        return;
      }

      // Sem atualização otimista de propósito: quando a escrita falhava, o card
      // ficava na coluna nova com o banco recusando — a tela mentia sobre o
      // estado real até o próximo reload.
      await updateDeal(deal.id, { stage_id: stage.id });
      await invalidateDeals();
      // "Fechado" vira venda, e a venda com corretor já tem o card do `EngagementLayer`.
      if (stage.code !== "closed" || !vendaTemCard(deal)) {
        toast.success(`Negócio movido para ${stage.label}`, { duration: 2500 });
      }
    } catch (err) {
      toast.error(
        conferencia ? "Não foi possível enviar o negócio para conferência" : "Não foi possível mover o negócio",
        {
          description: describeError(
            err,
            conferencia ? "O negócio continua na etapa atual." : "A etapa não foi atualizada no servidor.",
          ),
        },
      );
    }
  }, [canEnterStage, canExitStage, closedMonths, invalidateDeals, isAdmin]);

  const changeStatus = useCallback(async (deal: LegacyDealRecord, status: string) => {
    // A trava dos dois desfechos de administrador mora AQUI, e não no Select da
    // tabela nem no diálogo de perda: os dois são gatilhos do mesmo `update`, e
    // enquanto a regra estava neles o rótulo que o modal mostrava cinza
    // continuava gravável pela tabela. Antes do desvio para a confirmação de
    // perda, senão o diálogo abre para quem não pode marcar OFF nem distrato.
    const semPermissao = offDistratoBlocked(can, status);
    if (semPermissao) {
      toast.error("Não foi possível alterar o status", { description: semPermissao });
      return;
    }

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
        toast.error("Não foi possível alterar o status", { description: blocked });
        return;
      }

      await updateDeal(deal.id, {
        status_detail: status,
        lost_reason: null,
        ...(closedStage ? { stage_id: closedStage.id } : {}),
      });
      await invalidateDeals();
      // VENDA leva a "Fechado": com corretor, quem confirma é o card de venda do `EngagementLayer`.
      if (!closedStage || !vendaTemCard(deal)) {
        toast.success("Status atualizado", { description: bareStatus(status), duration: 2500 });
      }
    } catch (err) {
      toast.error("Não foi possível alterar o status", {
        description: describeError(err, "O status não foi atualizado no servidor."),
      });
    }
  }, [can, canEnterStage, canExitStage, closedMonths, invalidateDeals, isAdmin, onNeedsLossConfirmation, stages]);

  return { moveDeal, changeStatus };
}
