import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { num } from "@/lib/format";
import { podiumRingClass } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { MedalhaComFita } from "./MedalhaComFita";
import { DEGRADE_DO_PODIO, MEDALHA_DO_PODIO, NOME_NO_PODIO, SOMBRA_DO_TEXTO } from "./podioVisual";

/**
 * Pódio em três cartões deitados — o desenho que o cliente mandou para o topo
 * do Pipeline (10/09/2026): prata à esquerda, ouro maior no meio, bronze à
 * direita.
 *
 * É o pódio único do Game: o topo do Pipeline e os "Campeões" da Gamificação
 * (pedido de 26/09/2026, que aposentou os pedestais animados de lá). Sem
 * degrau, coroa nem contagem animada: a faixa precisa caber acima do quadro de
 * negócios sem empurrá-lo para baixo da dobra ("o ranking está um pouco grande").
 *
 * Medalha em imagem e degradê do preto para o metal (prints de 26/09/2026): o
 * troféu de 17/09 saiu. As imagens são só deste pódio; o Painel segue com a
 * `MedalhaComFita`.
 *
 * Degradê, medalha e cor do texto vêm de `podioVisual`, o mesmo da tira do
 * cabeçalho — lá está o porquê de serem cores fixas.
 */

/**
 * Ordem VISUAL 2-1-3 a partir do tablet; o DOM continua 1-2-3.
 *
 * É o que faz o pódio ter sentido no leitor de tela e no celular: quem lê em
 * ordem ouve primeiro/segundo/terceiro, e a coluna empilhada segue a mesma
 * ordem. Só a grade de três colunas reordena.
 */
const ORDEM = ["sm:order-2", "sm:order-1", "sm:order-3"];
const DESTAQUE = DEGRADE_DO_PODIO;
const MEDALHA = MEDALHA_DO_PODIO;

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export type PodiumEntry = {
  id: string;
  name: string;
  points: number;
  avatarUrl?: string | null;
  /** Linha de apoio: gerente, equipe, métricas curtas. */
  detail?: ReactNode;
  /** O número em destaque. Ausente = "N pontos" (o Game); o ranking de vendas
   *  da Dashboard escreve "N vendas". */
  value?: ReactNode;
  /**
   * Colocação real, quando ela não é a posição na lista.
   *
   * O ranking congelado de uma temporada fechada chega filtrado pelo escopo de
   * quem olha: o primeiro cartão pode ser o 5º da casa. Sem isto o cartão
   * coroava como 1º quem a tabela ao lado numerava "#5". Ausente = a posição
   * na lista, que é o caso do ranking vivo.
   */
  place?: number;
};

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
                "flex min-h-24 items-center gap-3 rounded-xl border-2 px-4 py-4",
                // Fora do pódio (colocação congelada) o cartão volta ao neutro do tema.
                DESTAQUE[lugar - 1]
                  ? cn("bg-gradient-to-b text-white", DESTAQUE[lugar - 1])
                  : "border-border bg-card text-card-foreground",
                primeiro && "sm:min-h-28 sm:gap-4 sm:px-5 sm:py-5",
              )}
            >
              {/* Decorativa: quem anuncia a colocação é o `sr-only` do nome. */}
              {MEDALHA[lugar - 1] ? (
                <img
                  src={MEDALHA[lugar - 1]}
                  alt=""
                  aria-hidden
                  className={cn("-my-2 h-[4.5rem] w-[4.5rem] shrink-0 object-contain", primeiro && "sm:h-20 sm:w-20")}
                />
              ) : (
                <MedalhaComFita lugar={lugar} />
              )}

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

              <div className={cn("min-w-0 flex-1", DESTAQUE[lugar - 1] && SOMBRA_DO_TEXTO)}>
                {/* `line-clamp-2`: "Kayteane Botelho Araujo" ocupa duas linhas no
                    desenho do cliente. Sem o teto, um nome de quatro palavras
                    esticaria só o cartão do meio e desalinharia o pódio. */}
                <p
                  className={cn(
                    "line-clamp-2 break-words text-sm font-bold leading-tight",
                    DESTAQUE[lugar - 1] && NOME_NO_PODIO,
                    primeiro && "sm:text-base",
                  )}
                >
                  <span className="sr-only">{lugar}º lugar: </span>
                  {entry.name}
                </p>
                {/* Branco suave e não `muted-foreground`: o cinza do tema some no
                    degradê, que é escuro nos dois temas. */}
                {entry.detail && (
                  <p className={cn("truncate text-xs", DESTAQUE[lugar - 1] ? "text-white/80" : "text-muted-foreground")}>
                    {entry.detail}
                  </p>
                )}
                {/* No print os pontos têm quase o corpo do nome; quem separa os
                    dois é o corpo da letra, não a cor. */}
                <p className={cn("mt-1 text-base font-bold tabular-nums", primeiro && "sm:text-lg")}>
                  {entry.value ?? `${num(entry.points)} pontos`}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
