import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral" | "highlight";

export interface StatusBadgeProps {
  /**
   * `live` fica FORA de `StatusTone` de proposito: `StatusTone` e a paleta que
   * telas oferecem para escolher (cor de etapa da esteira CCA), e "ao vivo" nao
   * e cor de etapa — e estado que acontece agora.
   */
  tone?: StatusTone | "live";
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
 *
 * `live` e SO para estado ao vivo (temporada do game aberta, turno em
 * andamento): borda e ponto em `gold` — traco e objeto grafico, 3:1 nos dois
 * temas — e o texto em `foreground`, legivel em qualquer fundo. O ponto e
 * parado: pulso infinito aqui seria animacao nova sem fim. O cronometro do lead
 * aguardando atendimento NAO usa `live`: ali o ambar ja e o botao "Atender", e
 * a mesma cor no relogio significaria duas coisas no mesmo cartao.
 */
const toneClass: Record<StatusTone | "live", string> = {
  success: "border-success/25 bg-success/15 text-success",
  warning: "border-warning/25 bg-warning/15 text-warning",
  info: "border-info/25 bg-info/15 text-info",
  danger: "border-destructive/25 bg-destructive/15 text-destructive",
  neutral: "border-border bg-muted text-muted-foreground",
  highlight: "border-transparent bg-highlight text-highlight-foreground",
  live: "border-gold bg-transparent uppercase tracking-wider text-foreground",
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
      {tone === "live" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold ring-2 ring-gold/30" aria-hidden />}
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}
