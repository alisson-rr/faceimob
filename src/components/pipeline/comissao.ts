import { statusKey } from "@/integrations/supabase/dealStatuses";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";

/**
 * Previsão de comissão no cartão do negócio (pedido do diretor em 29/09/2026:
 * "para motivar o corretor").
 *
 * Regra do cliente: 2% do VGV LÍQUIDO, a partir da aprovação — Status 2
 * "Aprovado total" ou "Aprovado condicionado" —, dividida entre os corretores.
 * Os Status 2 que vêm DEPOIS da aprovação na esteira da CCA (virou negócio,
 * CEOPF, agenda, assinatura no banco) continuam mostrando: sumir a previsão no
 * passo seguinte desmotivaria justamente quem avançou. Venda também mostra.
 *
 * É previsão, não cálculo de pagamento: o valor pago sai do fechamento.
 */
export const TAXA_DE_COMISSAO = 0.02;

const STATUS_COM_COMISSAO = new Set([
  // Aprovação (os dois que o cliente nomeou, com e sem restrição)
  "09. APROV. TOTAL", "APROVADO TOTAL", "APROV. TOT. RESTRIÇÃO", "APROVADO TOTAL COM RESTRIÇÃO",
  "10. APROV. COND.", "APROVADO CONDICIONADO", "APROV. COND. RESTRIÇÃO", "APROVADO CONDICIONADO COM RESTRIÇÃO",
  // Depois da aprovação, na ordem das colunas da CCA (0150)
  "08. VIROU NEGÓCIO", "VIROU NEGÓCIO COM PENDÊNCIAS", "ANÁLISE CEOPF", "INCONFORME CEOPF",
  "APROVADO/AGUARDANDO AGENDA", "ENTREVISTA AGENDADA", "02. ASS. BANCO",
].map(statusKey));

export type ComissaoPrevista = {
  total: number;
  /** Uma entrada por corretor, com a fatia dele no rateio. */
  porCorretor: { nome: string; valor: number }[];
};

type DealDaComissao = Pick<
  LegacyDealRecord,
  "status" | "outcome" | "deal_value"
  | "broker1" | "broker1_share" | "broker2" | "broker2_share" | "broker3" | "broker3_share"
>;

export function comissaoPrevista(deal: DealDaComissao): ComissaoPrevista | null {
  if (deal.outcome === "lost" || deal.outcome === "cancelled") return null;
  if (deal.outcome !== "won" && !STATUS_COM_COMISSAO.has(statusKey(deal.status))) return null;
  const liquido = Number(deal.deal_value) || 0;
  if (liquido <= 0) return null;

  const total = Math.round(liquido * TAXA_DE_COMISSAO * 100) / 100;
  const corretores = [
    { nome: deal.broker1, share: deal.broker1_share },
    { nome: deal.broker2 ?? "", share: deal.broker2_share },
    { nome: deal.broker3 ?? "", share: deal.broker3_share },
  ].filter((c) => Boolean(c.nome));
  // O rateio do banco (`recalc_deal_shares`) manda; sem ele, partes iguais.
  const somaDasFatias = corretores.reduce((soma, c) => soma + (c.share ?? 0), 0);
  const porCorretor = corretores.map((c) => ({
    nome: c.nome,
    valor: Math.round(total * (somaDasFatias > 0 ? (c.share ?? 0) / somaDasFatias : 1 / corretores.length) * 100) / 100,
  }));
  return { total, porCorretor };
}
