import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DeltaTone = "success" | "danger" | "neutral";

export interface KpiDelta {
  /** Texto ja formatado: "+12%", "-3 negocios", "estavel". */
  label: string;
  direction: "up" | "down" | "flat";
  /**
   * Subir nem sempre e bom (perdas, distratos). Sem `tone`, "up" e verde e
   * "down" e vermelho; passe `tone` quando a leitura for ao contrario.
   */
  tone?: DeltaTone;
}

export interface KpiCardProps {
  label: string;
  /** Numero ja formatado (use `brl`/`num` de `@/lib/format`). */
  value: ReactNode;
  delta?: KpiDelta;
  icon?: LucideIcon;
  /** `highlight` marca o indicador que a tela quer que seja lido primeiro. */
  variant?: "default" | "highlight";
  /** Linha de apoio abaixo do valor ("meta: 40", "ultimos 7 dias"). */
  hint?: ReactNode;
  className?: string;
}

const deltaTone: Record<DeltaTone, string> = {
  success: "text-success",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

const deltaIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

/**
 * Cartao de indicador. O numero vai em fonte display com `tabular-nums`: sem
 * isso o valor "pula" de largura a cada atualizacao do realtime.
 *
 * A direcao do delta e dita pela SETA, nao so pela cor — daltonismo e tela em
 * escala de cinza precisam ler a mesma coisa.
 */
export function KpiCard({ label, value, delta, icon: Icon, variant = "default", hint, className }: KpiCardProps) {
  const isHighlight = variant === "highlight";
  const DeltaIcon = delta ? deltaIcon[delta.direction] : null;
  const tone = delta ? (delta.tone ?? (delta.direction === "up" ? "success" : delta.direction === "down" ? "danger" : "neutral")) : "neutral";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-5 transition-[transform,box-shadow,border-color] duration-200 ease-premium hover:-translate-y-0.5",
        isHighlight
          ? "border-highlight/40 shadow-[0_6px_24px_-12px_hsl(var(--highlight)/0.5)] hover:shadow-[0_14px_36px_-14px_hsl(var(--highlight)/0.6)]"
          : "border-border hover:border-primary/40 hover:shadow-[0_14px_36px_-16px_hsl(var(--primary)/0.5)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-eyebrow">{label}</p>
        {Icon && (
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
              isHighlight ? "bg-highlight/20 text-warning" : "bg-primary/10 text-primary",
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>

      <p className="mt-3 font-display text-3xl font-bold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>

      {(delta || hint) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {delta && DeltaIcon && (
            <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", deltaTone[tone])}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta.label}
            </span>
          )}
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}
