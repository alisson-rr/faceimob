import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RecolhivelProps {
  /** A linha que fica sempre à vista; só texto e selos (nada clicável dentro). */
  titulo: ReactNode;
  children: ReactNode;
  className?: string;
  /** Aberta ao montar. O padrão do app para listas é recolhida, para ganhar tela. */
  aberta?: boolean;
}

/**
 * Linha que abre ao clicar (pedido de 12/10/2026: listas recolhidas por padrão,
 * em todo o app, para ganhar tela). É o `<details>` nativo — teclado, foco e
 * leitor de tela de graça —, o mesmo que a fila em formação já usa.
 */
export function Recolhivel({ titulo, children, className, aberta = false }: RecolhivelProps) {
  return (
    <details className={cn("group", className)} open={aberta || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{titulo}</div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
