import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Titulo da tela. E o unico <h1> da pagina — o rotulo da barra do topo e <p>. */
  title: string;
  description?: ReactNode;
  /** Rotulo curto acima do titulo (ex.: "Comercial", "Administracao"). */
  eyebrow?: string;
  icon?: LucideIcon;
  /** Botoes e filtros. Vao para a direita no desktop e para baixo no celular. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Cabecalho de tela. Todo <h1> do app sai daqui: quando cada tela escrevia o
 * seu, o tamanho ia de `text-sm` a `text-4xl` e duas telas nao tinham nenhum.
 */
export function PageHeader({ title, description, eyebrow, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-eyebrow mb-1.5">{eyebrow}</p>}
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-[18px] w-[18px]" />
            </span>
          )}
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        </div>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
