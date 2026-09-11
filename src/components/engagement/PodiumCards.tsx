import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { num } from "@/lib/format";
import { podiumToken, type PodiumToken } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { MedalhaComFita } from "./MedalhaComFita";
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
 * Cor: os pares `bg-<tom>` / `text-<tom>-foreground` do design system. Eles se
 * invertem sozinhos entre os temas — no claro o ouro é o âmbar profundo com
 * tinta branca, no escuro o ouro claro com tinta navy —, que é o único jeito
 * de um cartão de cor cheia continuar legível nos dois.
 */

/**
 * O degradê dos três cartões do print, sem um segundo tom cravado.
 *
 * `bg-<tom>` continua pintando o fundo; o `bg-gradient-to-br` é uma lâmina por
 * cima que vai do MESMO `--foreground` com alpha 0 até 20% — mesma cor nas duas
 * pontas, para o degradê não passar por tom nenhum que não seja do sistema.
 * Duas consequências, e as duas são o motivo de ser `--foreground` e não um
 * alpha do próprio tom da medalha:
 *
 * · a lâmina SEMPRE escurece no tema claro e SEMPRE clareia no escuro, porque
 *   `--foreground` é a tinta da página (navy no claro, quase branca no escuro).
 *   Como o `-foreground` da medalha é o inverso disso, o degradê afasta o fundo
 *   da tinta do cartão nos dois temas: o contraste do nome e dos pontos só sobe.
 * · `bg-gold/80` faria o oposto e não dá para usar: alpha compõe contra o card
 *   atrás, que é BRANCO no tema claro — e o ouro claro só tem 4,85:1 com tinta
 *   branca, sem folga nenhuma para clarear.
 *
 * `plain` fica liso: não é medalha, e o print só tem os três cartões.
 */
const DEGRADE = "bg-gradient-to-br from-foreground/0 to-foreground/20";

const TONE: Record<PodiumToken | "plain", { card: string; ring: string }> = {
  gold: { card: `bg-gold ${DEGRADE} text-gold-foreground`, ring: "ring-gold-foreground/25" },
  silver: { card: `bg-silver ${DEGRADE} text-silver-foreground`, ring: "ring-silver-foreground/25" },
  bronze: { card: `bg-bronze ${DEGRADE} text-bronze-foreground`, ring: "ring-bronze-foreground/25" },
  /** Fora do trio não há medalha — cartão neutro, liso, mesmo desenho. */
  plain: { card: "bg-muted text-foreground", ring: "ring-border" },
};

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
        const tom = TONE[podiumToken(lugar - 1) ?? "plain"];
        const primeiro = lugar === 1;

        return (
          <li key={entry.id} className={cn("min-w-0", ORDEM[index])}>
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 shadow-sm",
                tom.card,
                primeiro && "sm:gap-3 sm:px-3.5 sm:py-3.5 sm:shadow-md",
              )}
            >
              <MedalhaComFita lugar={lugar} />

              <Avatar
                className={cn(
                  "h-9 w-9 shrink-0 ring-2",
                  tom.ring,
                  primeiro && "sm:h-12 sm:w-12",
                )}
              >
                <AvatarImage src={entry.avatarUrl || undefined} alt="" />
                <AvatarFallback className="bg-card text-xs font-bold text-card-foreground">
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
                {entry.detail && <p className="truncate text-xs opacity-80">{entry.detail}</p>}
                {/* No print os pontos têm quase o corpo do nome. A HIERARQUIA é
                    o que separa os dois: o desenho pinta o nome de âmbar sobre
                    o cartão de ouro, e âmbar sobre ouro não passa em contraste
                    em nenhum dos dois temas — então quem separa é o corpo, não
                    a cor, e os dois usam a tinta pareada do cartão. */}
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
