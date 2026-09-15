/**
 * Catálogo de Status 1 e Status 2 para os testes, montado pelo MESMO
 * `buildDealStatusCatalog` que a consulta usa — o teste não reimplementa a
 * ordenação nem o índice.
 *
 * Recorte do seed da 0149 com três desvios de propósito: o array vem
 * embaralhado (a ordem tem de sair de `position`), "02. ASS. BANCO" tem nome
 * exibido diferente do texto gravado (o nome tem de sair do catálogo, não de
 * `bareStatus`) e LEGADO está desativado.
 */
import {
  buildDealStatusCatalog, type DealStatus, type DealStatusGroup,
} from "@/integrations/supabase/dealStatuses";

const grupo = (code: string, position: number, active = true): DealStatusGroup =>
  ({ id: `g-${code}`, code, label: code, position, active });

export const GRUPOS = {
  VENDA: grupo("VENDA", 1),
  PROPOSTA: grupo("PROPOSTA", 2),
  LEGADO: grupo("LEGADO", 3, false),
  DISTRATO: grupo("DISTRATO", 4),
  OFF: grupo("OFF", 5),
};

const status = (
  group: DealStatusGroup,
  value: string,
  position: number,
  tone: DealStatus["tone"],
  extra: Partial<DealStatus> = {},
): DealStatus => ({
  id: `s-${value}`, value, label: value.replace(/^\d+\.\s*/, ""), group_id: group.id,
  position, tone, active: true, locked: false, ...extra,
});

const { VENDA, PROPOSTA, LEGADO, DISTRATO, OFF } = GRUPOS;

export const catalogoDeTeste = buildDealStatusCatalog(
  [OFF, PROPOSTA, VENDA, DISTRATO, LEGADO],
  [
    status(OFF, "OFF", 2, "neutral", { locked: true }),
    status(OFF, "18. QUEDA", 1, "danger", { locked: true }),
    status(LEGADO, "19. REPROVADO", 2, "danger", { locked: true }),
    status(LEGADO, "15. INTERNALIZADO", 1, "info"),
    status(PROPOSTA, "08. VIROU NEGÓCIO", 6, "highlight"),
    status(PROPOSTA, "PROPOSTA", 5, "info", { active: false, locked: true }),
    status(PROPOSTA, "15. ANÁLISE P/ VIRAR NEGÓCIO", 4, "warning", { locked: true }),
    status(PROPOSTA, "16. PENDENTE", 3, "warning"),
    status(PROPOSTA, "RET. ESTEIRA AGIL", 2, "success", { locked: true }),
    status(PROPOSTA, "13. ESTEIRA AGIL", 1, "success", { locked: true }),
    status(DISTRATO, "17. DISTRATO", 1, "danger", { locked: true }),
    status(VENDA, "02. ASS. BANCO", 1, "info", { label: "Assinado no banco" }),
  ],
);
