import { num } from "@/lib/format";
import { tone } from "@/lib/tone";

export type BarListRow = { label: string; value: number };

export interface BarListProps {
  rows: BarListRow[];
  /** Token da barra. Uma cor so: quem separa as linhas e o rotulo escrito. */
  token?: string;
  /** Mostra a fatia de cada linha no total, a partir de `sm`. */
  share?: boolean;
  /** Texto quando nao ha linha nenhuma. */
  emptyLabel?: string;
}

/**
 * Lista de contagem com barra proporcional.
 *
 * E HTML, nao Recharts, de proposito: com barra horizontal o Recharts corta o
 * rotulo do eixo de categoria ("Meta Ads (Instagram)" virava "Meta Ad…") e nao
 * ha largura de eixo que resolva isso a 375 px. Aqui o rotulo e texto normal,
 * quebra e trunca com CSS, e a barra ocupa o que sobra.
 */
export function BarList({ rows, token = "chart-1", share = false, emptyLabel }: BarListProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel ?? "Nada para mostrar neste recorte."}</p>;
  }

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const maior = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ol className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs font-semibold text-foreground sm:w-40 sm:text-sm">
            {row.label}
          </span>
          <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="ease-premium block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${(row.value / maior) * 100}%`, background: tone(token) }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
            {num(row.value)}
          </span>
          {share && (
            <span className="hidden w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:inline">
              {total > 0 ? Math.round((row.value / total) * 100) : 0}%
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
