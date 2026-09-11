import { podiumToken, type PodiumToken } from "@/lib/tone";
import { cn } from "@/lib/utils";

/**
 * Medalha de fita — o desenho que o cliente aprovou para o pódio do Pipeline e
 * para os Destaques do Painel (prints de 10/09/2026).
 *
 * As duas telas mostravam coisas diferentes para a mesma ideia: o Painel usava
 * o ícone `Medal` do lucide e o pódio um círculo com o número dentro. Uma peça
 * só para as duas porque é o mesmo objeto na cabeça de quem olha — e porque a
 * próxima tela que precisar de medalha não vai inventar a terceira.
 *
 * É decorativa (`aria-hidden`): a colocação já é anunciada em texto por quem
 * chama (o `aria-label` da linha em Destaques, o `sr-only` do cartão do pódio).
 * Sem isso o leitor de tela ouviria "1" solto antes do nome.
 */

/** Disco da medalha — os pares `bg-<tom>` / `text-<tom>-foreground` do design
 *  system, que se invertem sozinhos entre o tema claro e o escuro. */
const DISCO: Record<PodiumToken, string> = {
  gold: "bg-gold text-gold-foreground",
  silver: "bg-silver text-silver-foreground",
  bronze: "bg-bronze text-bronze-foreground",
};

export function MedalhaComFita({ lugar, className }: { lugar: number; className?: string }) {
  const tom = podiumToken(lugar - 1);

  return (
    <span aria-hidden className={cn("relative block h-10 w-8 shrink-0", className)}>
      {/* A fita são duas faixas em V, presas pelo topo e convergindo no disco.
          O vermelho é o `destructive` — é o único vermelho do sistema, e é ele
          que vira o tom legível de cada tema. */}
      <span className="absolute left-0.5 top-0 h-6 w-2.5 origin-top rotate-[22deg] rounded-b-sm bg-destructive" />
      <span className="absolute right-0.5 top-0 h-6 w-2.5 origin-top -rotate-[22deg] rounded-b-sm bg-destructive/85" />
      <span
        className={cn(
          "absolute bottom-0 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full text-xs font-bold shadow-sm",
          // Fora do trio não há medalha de metal — disco neutro, mesmo desenho.
          tom ? DISCO[tom] : "bg-muted text-foreground",
        )}
      >
        {lugar}
      </span>
    </span>
  );
}
