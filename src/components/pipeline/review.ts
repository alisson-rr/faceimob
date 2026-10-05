/**
 * Conferência documental — rótulo e cor do `deals.document_review_status`.
 *
 * Vive fora dos componentes porque a tabela, o card do kanban e o filtro
 * mostravam o mesmo estado com três textos diferentes.
 */
import type { DocumentReviewStatus } from "@/types/crm";
import { bareStatus, isResultado } from "@/lib/dealStatus";

export const DOCUMENT_REVIEW_META: Record<DocumentReviewStatus, { label: string; className: string }> = {
  draft: { label: "Em preparação", className: "border-border text-muted-foreground" },
  pending: { label: "Análise enviada para conferência", className: "border-warning/50 text-warning" },
  returned: { label: "Devolvido", className: "border-destructive/50 text-destructive" },
  approved: { label: "Conferido", className: "border-success/50 text-success" },
};

/**
 * Rótulo da conferência no cartão e na tabela (pedido de 05/10/2026): o
 * "Conferido" só vale quando a CCA termina — Status 2 "VIROU NEGÓCIO…" ou
 * venda. Antes disso, o aprovado pelo gerente aparece como "Na esteira CCA",
 * e o corretor entende que o negócio ainda pode voltar em pendência.
 */
export function conferenciaDoNegocio(
  status: DocumentReviewStatus | null | undefined,
  statusDetail: string | null | undefined,
): { label: string; className: string } {
  const atual = status ?? "draft";
  const terminou = /VIROU NEG/.test(bareStatus(statusDetail)) || isResultado(statusDetail);
  if (atual === "approved" && !terminou) {
    return { label: "Na esteira CCA", className: "border-info/50 text-info" };
  }
  return DOCUMENT_REVIEW_META[atual];
}
