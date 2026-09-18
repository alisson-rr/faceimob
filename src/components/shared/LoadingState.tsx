import { Skeleton } from "@/components/ui/skeleton";
import { KpiGrid } from "./KpiGrid";
import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  /** `kpi` = grade de cartoes · `list` = linhas · `table` = cabecalho + linhas · `block` = area unica. */
  variant?: "kpi" | "list" | "table" | "block";
  /** Quantas repeticoes desenhar. Ignorado em `block`. */
  rows?: number;
  /** Lido pelo leitor de tela no lugar do esqueleto. */
  label?: string;
  className?: string;
}

/**
 * Esqueleto de carregamento. O `role="status"` + `aria-busy` sao o que faz a
 * espera existir para quem nao ve o esqueleto — animacao sozinha nao avisa
 * nada.
 */
export function LoadingState({ variant = "block", rows = 3, label = "Carregando…", className }: LoadingStateProps) {
  const count = Math.max(1, rows);

  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("w-full", className)}>
      <span className="sr-only">{label}</span>

      {/* A folga e a grade do esqueleto acompanham as do `KpiCard` real, senao
          a regua salta quando o dado chega. Colunas pela mesma regra das
          telas: ate cinco cartoes cabem numa linha; mais que isso, a regua
          de quatro (a do Dashboard). */}
      {variant === "kpi" && (
        <KpiGrid cols={(count <= 5 ? count : 4) as 1 | 2 | 3 | 4 | 5}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-4 h-8 w-28 rounded-lg" />
              <Skeleton className="mt-3 h-3 w-16" />
            </div>
          ))}
        </KpiGrid>
      )}

      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === "table" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-3.5 w-1/4" />
                <Skeleton className="h-3.5 w-1/5" />
                <Skeleton className="ml-auto h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "block" && <Skeleton className="h-40 w-full rounded-2xl" />}
    </div>
  );
}
