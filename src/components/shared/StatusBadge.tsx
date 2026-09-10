import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral" | "highlight";

export interface StatusBadgeProps {
  tone?: StatusTone;
  children: ReactNode;
  icon?: LucideIcon;
  className?: string;
}

/**
 * Pilula de estado. O rotulo escrito e o sinal principal; a cor so reforca —
 * por isso nao existe variante "so bolinha colorida".
 *
 * `highlight` e solido porque o amarelo da marca nao passa em contraste como
 * texto sobre fundo claro (ver o cabecalho de `index.css`).
 */
const toneClass: Record<StatusTone, string> = {
  success: "border-success/25 bg-success/15 text-success",
  warning: "border-warning/25 bg-warning/15 text-warning",
  info: "border-info/25 bg-info/15 text-info",
  danger: "border-destructive/25 bg-destructive/15 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
  highlight: "border-transparent bg-highlight text-highlight-foreground",
};

export function StatusBadge({ tone = "neutral", children, icon: Icon, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-5",
        toneClass[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}
