/**
 * Conferência documental — rótulo e cor do `deals.document_review_status`.
 *
 * Vive fora dos componentes porque a tabela, o card do kanban e o filtro
 * mostravam o mesmo estado com três textos diferentes.
 */
import type { DocumentReviewStatus } from "@/types/crm";

export const DOCUMENT_REVIEW_META: Record<DocumentReviewStatus, { label: string; className: string }> = {
  draft: { label: "Em preparação", className: "border-border text-muted-foreground" },
  pending: { label: "Aguardando gerente", className: "border-warning/50 text-warning" },
  returned: { label: "Devolvido", className: "border-destructive/50 text-destructive" },
  approved: { label: "Conferido", className: "border-success/50 text-success" },
};
