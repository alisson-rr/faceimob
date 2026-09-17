import { Trophy } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { num } from "@/lib/format";
import { podiumRingClass, podiumTextClass } from "@/lib/tone";
import { cn } from "@/lib/utils";
import type { PodiumEntry } from "./Podium";

/**
 * Pódio em três cartões deitados — o desenho que o cliente mandou para o topo
 * do Pipeline (10/09/2026): prata à esquerda, ouro maior no meio, bronze à
 * direita.
 *
 * Existe ao lado do `Podium` de pedestais porque são dois desenhos, e não dois
 * ajustes do mesmo: aqui não há degrau, coroa nem contagem animada, e a faixa
 * precisa caber acima do quadro de negócios sem empurrá-lo para baixo da dobra
 * ("o ranking está um pouco grande"). Gamificação continua com os pedestais,
 * que lá são o assunto da tela.
 *
 * Troféu igual ao do ranking do cabeçalho (pedido de 17/09/2026): a colocação
 * em `primary` e o `Trophy` na cor do pódio (`podiumTextClass`). O cartão é
 * neutro (`card`) porque a medalha pintada de ouro sobre cartão de ouro sumia —
 * sobrava só a fita. Ouro, prata e bronze sobre `card` passam 4,5:1 nos dois
 * temas (par travado no theme-contrast).
 */

/**
 * Ordem VISUAL 2-1-3 a partir do tablet; o DOM continua 1-2-3.
 *
 * É o que faz o pódio ter sentido no leitor de tela e no celular: quem lê em
 * ordem ouve primeiro/segundo/terceiro, e a coluna empilhada segue a mesma
 * ordem. Só a grade de três colunas reordena.
 */
const ORDEM = ["sm:order-2", "sm:order-1", "sm:order-3"];

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export interface PodiumCardsProps {
  /** Já ordenado do 1º ao 3º. Aceita menos de três. */
  entries: PodiumEntry[];
  className?: string;
}

export function PodiumCards({ entries, className }: PodiumCardsProps) {
  if (!entries.length) return null;

  return (
    <ol className={cn("flex flex-col gap-2 sm:grid sm:grid-cols-3 sm:items-center sm:gap-3", className)}>
      {entries.slice(0, 3).map((entry, index) => {
        // A colocação congelada manda, quando existe: numa temporada fechada o
        // primeiro cartão do recorte pode ser o 5º da casa, e coroá-lo de ouro
        // brigaria com a tabela ao lado.
        const lugar = entry.place ?? index + 1;
        const primeiro = lugar === 1;

        return (
          <li key={entry.id} className={cn("min-w-0", ORDEM[index])}>
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-card-foreground shadow-sm",
                primeiro && "sm:gap-3 sm:px-3.5 sm:py-3.5 sm:shadow-md",
              )}
            >
              {/* Decorativo: quem anuncia a colocação é o `sr-only` do nome. */}
              <span aria-hidden className="flex shrink-0 items-center gap-1">
                <span className="text-xs font-bold tabular-nums text-primary">{lugar}º</span>
                <Trophy className={cn("h-5 w-5", podiumTextClass(lugar - 1), primeiro && "sm:h-6 sm:w-6")} />
              </span>

              <Avatar
                className={cn(
                  "h-9 w-9 shrink-0 ring-2",
                  podiumRingClass(lugar - 1),
                  primeiro && "sm:h-12 sm:w-12",
                )}
              >
                <AvatarImage src={entry.avatarUrl || undefined} alt="" />
                <AvatarFallback className="bg-muted text-xs font-bold text-foreground">
                  {initials(entry.name)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                {/* `line-clamp-2`: "Kayteane Botelho Araujo" ocupa duas linhas no
                    desenho do cliente. Sem o teto, um nome de quatro palavras
                    esticaria só o cartão do meio e desalinharia o pódio. */}
                <p className={cn("line-clamp-2 break-words text-sm font-bold leading-tight", primeiro && "sm:text-base")}>
                  <span className="sr-only">{lugar}º lugar: </span>
                  {entry.name}
                </p>
                {entry.detail && <p className="truncate text-xs text-muted-foreground">{entry.detail}</p>}
                {/* No print os pontos têm quase o corpo do nome; quem separa os
                    dois é o corpo da letra, não a cor. */}
                <p className={cn("text-sm font-bold tabular-nums", primeiro && "sm:text-base")}>
                  {num(entry.points)} pontos
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
