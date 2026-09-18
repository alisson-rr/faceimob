import { brl, num } from "@/lib/format";
import { textOn } from "@/lib/tone";

/** Seta: entalhe de 10 px à esquerda e ponta de 10 px à direita, sem raio. */
const SETA = "[clip-path:polygon(0_0,calc(100%_-_10px)_0,100%_50%,calc(100%_-_10px)_100%,0_100%,10px_50%)]";

/**
 * Cabeçalho de coluna do kanban (CCA e Pipeline): fundo sólido na cor da
 * coluna, em seta, com o nome e o total da coluna — o desenho do CV CRM que o
 * cliente mandou em 18/09/2026.
 *
 * O texto é preto ou branco pelo contraste com a cor (`textOn`), nunca fixado:
 * a cor é livre no cadastro. A quantidade leva o substantivo só para o leitor
 * de tela — na tela, "R$ 438.000 · 2" basta ao lado dos cartões.
 *
 * `relative` segura esse `sr-only` (que é `absolute`) dentro do cabeçalho: sem
 * posição, ele se prendia à janela, escapava do `overflow-x-auto` do quadro e
 * fazia a PÁGINA do Pipeline rolar na horizontal (2121 px numa janela de 1366).
 */
export function KanbanColumnHeader({ as: Heading = "h3", name, color, total, count, noun }: {
  as?: "h2" | "h3";
  name: string;
  /** `#RRGGBB` — `ccaStageColor` ou `pipelineStageColor`. */
  color: string;
  total: number;
  count: number;
  /** Singular; o plural é com "s" ("caso", "negócio"). */
  noun: string;
}) {
  return (
    <div className={`${SETA} relative py-2 pl-4 pr-5`} style={{ backgroundColor: color, color: textOn(color) }}>
      <Heading className="truncate text-xs font-bold" title={name}>{name}</Heading>
      <p className="truncate text-xs tabular-nums">
        {brl(total)} · {num(count)}
        <span className="sr-only"> {count === 1 ? noun : `${noun}s`}</span>
      </p>
    </div>
  );
}
