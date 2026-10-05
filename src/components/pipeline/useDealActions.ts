import { useCallback } from "react";
import { toast } from "@/components/ui/sonner";
import { describeError } from "@/lib/supabaseError";
import { ehDesfechoRuim, isLossStatus, isSystemStatus, normalizeStatus } from "@/lib/dealStatus";
import { avisarQueda } from "@/components/ui/avisos";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import {
  moveDealStatus, statusKey, statusMoveBlock, type DealStatus, type DealStatusCatalog,
} from "@/integrations/supabase/dealStatuses";
import type { PipelineDeal } from "@/types/crm";
import { useInvalidateDeals } from "./data";

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
  if (outcome === "OFF") {
    return can("deals.mark_off_distrato") ? null : "Só administrador e sócio marcam OFF.";
  }
  if (outcome !== "DISTRATO") return null;
  // DISTRATO também com `deals.mark_distrato`, a da CCA (0230).
  return can("deals.mark_off_distrato") || can("deals.mark_distrato")
    ? null
    : "Só administrador, sócio e CCA marcam distrato.";
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
 * Escrita do Pipeline: mover o Status 2 (pedido de 29/09/2026, 0164).
 *
 * O kanban, o teclado, o botão do cartão e o Select da tabela chamam a MESMA
 * função — duplicar a regra em cada gatilho era o jeito garantido de o teclado
 * permitir o que o mouse recusa. A etapa e o Status 1 não são mais movidos pela
 * tela: seguem o Status 2 no banco.
 *
 * Quatro caminhos, pelo destino:
 *   · voltar à análise (esteira ágil, retorno à esteira, análise p/ virar
 *     negócio) → envio ao gerente com mensagem (`onNeedsText`, envio);
 *   · encerrar (queda, distrato, reprovado, OFF) → diálogo de perda com motivo;
 *   · status com observação obrigatória → `onNeedsText`, observação;
 *   · o resto → `move_deal_status` direto.
 * Quem pode colocar e tirar é a matriz por função do cadastro (`statusMoveBlock`),
 * a mesma que o banco cobra.
 */
export function useDealActions({ catalog, closedMonths, onNeedsLossConfirmation, onNeedsText }: {
  catalog: DealStatusCatalog;
  /** Meses em `closed_months`: o gatilho recusa edição de negócio deles. */
  closedMonths: string[];
  /** Status que significa perda não grava direto: vai para a confirmação (F14). */
  onNeedsLossConfirmation: (deal: LegacyDealRecord, status: string) => void;
  /** Destino que pede texto: envio para análise ou observação obrigatória. */
  onNeedsText: (deal: LegacyDealRecord, status: DealStatus, envioParaAnalise: boolean) => void;
}) {
  const { isAdmin, roles, can } = useAuth();
  const invalidateDeals = useInvalidateDeals();

  const moveStatus = useCallback(async (deal: LegacyDealRecord, value: string) => {
    const falhou = (description: string) => { toast.error("Não foi possível mover o negócio", { description }); };

    const indice = catalog.indexByKey.get(statusKey(value));
    const status = indice === undefined ? null : catalog.statuses[indice];
    if (!status) return falhou("Este Status 2 não está no cadastro.");
    if (statusKey(deal.status) === statusKey(status.value)) return;

    if (!can("deals.edit_status_detail")) return falhou("Seu perfil não pode alterar o Status 2.");
    if (!isAdmin && closedMonths.includes(deal.month_base)) {
      return falhou("Mês fechado: o negócio não muda mais de status.");
    }
    const offDistrato = offDistratoBlocked(can, status.value);
    if (offDistrato) return falhou(offDistrato);

    if (isSystemStatus(status.value)) {
      // Com a conferência já pendente não há envio a fazer: falta o gerente.
      if (deal.document_review_status === "pending") {
        toast.info("Aguardando o gerente", {
          description: "A documentação já aguarda conferência do gerente; o negócio volta para a análise quando ele aprovar.",
        });
        return;
      }
      onNeedsText(deal, status, true);
      return;
    }

    const bloqueio = statusMoveBlock(catalog, deal.status, status.value, { isAdmin, roles });
    if (bloqueio) return falhou(bloqueio);

    // Contra a lista de motivos do diálogo, não contra `normalizeStatus`:
    // "19. REPROVADO" também encerra e precisa do motivo.
    if (isLossStatus(status.value)) {
      onNeedsLossConfirmation(deal, status.value);
      return;
    }
    if (status.requires_note) {
      onNeedsText(deal, status, false);
      return;
    }

    try {
      await moveDealStatus(deal.id, status.value);
      await invalidateDeals();
      // Status 1 VENDA é venda do jogo (0163): com corretor, quem confirma é o
      // card de venda do `EngagementLayer`.
      const venda = catalog.groupById.get(status.group_id)?.code === "VENDA";
      if (ehDesfechoRuim(status.value, catalog.groupById.get(status.group_id)?.code)) {
        avisarQueda(`Negócio movido para ${status.label}`, deal.client);
      } else if (!venda || !vendaTemCard(deal)) {
        toast.success(`Negócio movido para ${status.label}`, { duration: 2500 });
      }
    } catch (err) {
      falhou(describeError(err, "O Status 2 não foi alterado no servidor."));
    }
  }, [can, catalog, closedMonths, invalidateDeals, isAdmin, onNeedsLossConfirmation, onNeedsText, roles]);

  return { moveStatus };
}
