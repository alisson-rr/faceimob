import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { BrandMotif } from "@/components/shared/BrandMotif";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Botao ou link que resolve o vazio ("Novo lead", "Limpar filtros"). */
  action?: ReactNode;
  /** Estado vazio por erro/filtro em vez de "ainda nao ha nada". */
  tone?: "neutral" | "danger";
  className?: string;
}

/**
 * Lista vazia com explicacao e saida. Sem isso, `deals = []` por erro de rede e
 * `deals = []` por filtro sem resultado davam a mesma tela muda.
 */
export function EmptyState({ icon: Icon, title, description, action, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/60 px-6 py-12 text-center",
        className,
      )}
    >
      <BrandMotif className="opacity-40" />
      <div className="relative flex flex-col items-center gap-3">
        {Icon && (
          <span
            className={cn(
              "grid h-12 w-12 place-items-center rounded-2xl",
              tone === "danger" ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
        )}
        <p className="font-display text-lg font-bold tracking-tight text-foreground">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </div>
  );
}
