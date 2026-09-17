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
  /**
   * Seletor de periodo (mes) da tela. Fica CENTRALIZADO no topo, na mesma
   * posicao em toda tela que filtra por mes (pedido do dono, 17/09/2026): no
   * desktop entre o titulo e as acoes; abaixo de `lg`, numa linha propria logo
   * depois do titulo.
   *
   * Quem passa um rotulo ou um selo junto do seletor manda os dois: eles vao
   * EMPILHADOS (rotulo em cima, controle embaixo) para o seletor ficar mesmo no
   * centro da tela, e nao meio selo para a direita.
   */
  period?: ReactNode;
  className?: string;
}

/**
 * Cabecalho de tela. Todo <h1> do app sai daqui: quando cada tela escrevia o
 * seu, o tamanho ia de `text-sm` a `text-4xl` e duas telas nao tinham nenhum.
 */
export function PageHeader({ title, description, eyebrow, icon: Icon, actions, period, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-5 sm:mb-6",
        // Colunas laterais iguais (1fr/auto/1fr): o periodo fica no centro da
        // tela, nao no meio do espaco que sobra entre titulo e acoes.
        period
          ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center"
          : "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
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
      {period && (
        // Em COLUNA, e nao lado a lado: o que centraliza e a caixa, entao um
        // selo ou rotulo ao lado do seletor empurrava o proprio seletor para
        // fora do centro (48 px no Dashboard, 15 px na Gestao de dados). Com os
        // filhos empilhados e centrados, a caixa tem a largura do seletor e o
        // seletor cai no centro da tela — em toda tela que filtra por mes.
        <div className="col-span-2 row-start-2 flex flex-col items-center gap-1.5 lg:col-span-1 lg:col-start-2 lg:row-start-1">
          {period}
        </div>
      )}
      {actions && (
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center gap-2",
            period && "col-start-2 row-start-1 justify-end lg:col-start-3",
          )}
        >
          {actions}
        </div>
      )}
    </header>
  );
}
