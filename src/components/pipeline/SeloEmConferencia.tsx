import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * "Em conferência" piscando ao lado do Status 2 (27/11/2026): quem mandava um
 * INCOMPLETO para a conferência do gerente via o negócio continuar
 * "INCOMPLETO" e achava que o envio não tinha saído. O Status 2 não muda — o
 * selo só aparece enquanto `document_review_status` estiver `pending`.
 */
export function SeloEmConferencia({ pendente, className }: { pendente: boolean; className?: string }) {
  if (!pendente) return null;
  return (
    <Badge
      variant="outline"
      className={cn("whitespace-nowrap border-warning/70 bg-warning/15 text-xs font-semibold text-warning motion-safe:animate-pulse", className)}
      title="Enviado ao gerente: aguardando a conferência dos documentos"
    >
      Em conferência
    </Badge>
  );
}
