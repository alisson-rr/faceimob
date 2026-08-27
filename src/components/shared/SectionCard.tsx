import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Botoes, filtros ou seletor da secao. */
  actions?: ReactNode;
  children: ReactNode;
  /** Rodape opcional (paginacao, total, aviso). */
  footer?: ReactNode;
  /** Tira o padding do corpo — use quando o filho for uma <Table> de borda a borda. */
  flush?: boolean;
  className?: string;
  contentClassName?: string;
}

/**
 * Bloco padrao de conteudo: cabecalho com titulo/acoes e um corpo.
 *
 * O titulo e <h2> — a hierarquia de cabecalho da tela e <h1> do PageHeader,
 * depois <h2> de cada secao. Sem isso a navegacao por cabecalho do leitor de
 * tela pula direto do titulo da pagina para o nada.
 */
export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  children,
  footer,
  flush = false,
  className,
  contentClassName,
}: SectionCardProps) {
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card text-card-foreground", className)}>
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold leading-tight tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      <div className={cn(flush ? "" : "p-5", contentClassName)}>{children}</div>

      {footer && <div className="border-t border-border bg-muted/40 px-5 py-3 text-xs text-muted-foreground">{footer}</div>}
    </section>
  );
}
