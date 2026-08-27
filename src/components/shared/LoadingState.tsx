import { Skeleton } from "@/components/ui/skeleton";
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

      {variant === "kpi" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-5">
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="mt-4 h-8 w-28 rounded-lg" />
              <Skeleton className="mt-3 h-3 w-16 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {variant === "list" && (
        <div className="space-y-2">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3 rounded-full" />
                <Skeleton className="h-3 w-1/2 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === "table" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <Skeleton className="h-3 w-40 rounded-full" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-3.5 w-1/4 rounded-full" />
                <Skeleton className="h-3.5 w-1/5 rounded-full" />
                <Skeleton className="ml-auto h-3.5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {variant === "block" && <Skeleton className="h-40 w-full rounded-2xl" />}
    </div>
  );
}
