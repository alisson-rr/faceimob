import { ChevronDown, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
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
  /**
   * Vira uma linha que abre e fecha pelo título (pedido de 29/09/2026: as
   * metas no topo de Equipes ocupavam a tela de quem só ia ver a equipe). O
   * padrão é fechado; `abertoInicial` abre quando a pessoa chegou para
   * preencher (link com o mês escolhido).
   */
  recolhivel?: boolean;
  abertoInicial?: boolean;
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
  recolhivel = false,
  abertoInicial = false,
}: SectionCardProps) {
  const corpoId = useId();
  const [aberto, setAberto] = useState(!recolhivel || abertoInicial);
  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-panel", className)}>
      {/* Passo responsivo do shell (`px-4 sm:px-6` do AppLayout): a 375 px os
          20 px de folga de cada lado comiam 40 dos 343 uteis. Do `sm` para
          cima o cartao continua como estava. */}
      <div className={cn("flex flex-col gap-3 border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4", aberto && "border-b")}>
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Ícone sem o quadrado colorido atrás (05/09/2026): numa tela com
              seis seções eram seis manchas azuis disputando atenção com os
              números. O ícone continua identificando a seção; a cor saiu. */}
          {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          <div className="min-w-0">
            {/* Recolhível: botão DENTRO do <h2> (padrão acordeão da WAI) — o
                cabeçalho continua na navegação por títulos e o botão diz se
                está aberto. Botão em volta do <h2> apagaria o cabeçalho. */}
            <h2 className="font-display text-base font-bold leading-tight tracking-tight">
              {recolhivel ? (
                <button
                  type="button" aria-expanded={aberto} aria-controls={corpoId} onClick={() => setAberto((v) => !v)}
                  className="flex items-center gap-1.5 rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {title}
                  <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", aberto && "rotate-180")} aria-hidden />
                </button>
              ) : title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {/* `hidden`, não desmontar: fechar e abrir de novo não perde o que foi digitado. */}
      <div id={corpoId} hidden={!aberto} className={cn(flush ? "" : "p-4 sm:p-5", contentClassName)}>{children}</div>

      {footer && aberto && <div className="border-t border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:px-5">{footer}</div>}
    </section>
  );
}
