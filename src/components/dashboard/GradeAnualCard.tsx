import { useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionCard } from "@/components/shared";
import { brl, num } from "@/lib/format";
import { chartAxis, chartGrid, chartStill, chartTooltip, seriesToken, tone } from "@/lib/tone";
import { MESES, gradeAnual, type GradeMetric } from "./gradeAnual";
import { dealCategory, type DealRow } from "./data";

const METRICAS: [GradeMetric, string][] = [
  ["vendas", "Vendas"],
  ["vgv", "VGV"],
];

/**
 * Eixo em notacao curta: "R$ 14.166.616" num tick de eixo nao cabe em 375 px e
 * o Recharts nao quebra rotulo de eixo. O valor cheio continua no quadrado e no
 * tooltip.
 */
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Faturamento (ou vendas) mes a mes, com o total de cada ano — o "grafico
 * quadrado" pedido pelo cliente em 10/09/2026.
 *
 * A grade e uma TABELA de verdade, nao uma parede de divs: cada coluna tem
 * `th scope="col"` e cada ano tem `th scope="row"`. Por isso o grafico de barras
 * em cima vai `aria-hidden` — os dois mostram os mesmos numeros, e a tabela
 * abaixo ja e a versao legivel deles (o mesmo acordo que `ChartData` faz nos
 * outros blocos, so que aqui a tabela e visivel e nao precisa de copia).
 *
 * Independe do filtro de periodo do topo, igual ao `MonthlyTrend`: e a
 * comparacao entre anos que o cliente pediu, e recorta-la por mes esvaziaria a
 * grade inteira.
 */
export function GradeAnual({ deals }: { deals: DealRow[] }) {
  const [metric, setMetric] = useState<GradeMetric>("vendas");
  const grades = useMemo(() => ({ vendas: gradeAnual(deals, "vendas"), vgv: gradeAnual(deals, "vgv") }), [deals]);
  const rows = grades[metric];
  const secondary = grades[metric === "vendas" ? "vgv" : "vendas"];
  const otherFmt = (value: number | null) => value === null ? "—" : metric === "vendas" ? brl(value) : `${num(value)} ${value === 1 ? "venda" : "vendas"}`;

  const dinheiro = metric === "vgv";
  const fmt = (value: number | null) => (dinheiro ? brl(value) : num(value));
  const rotulo = dinheiro ? "Faturamento" : "Vendas";

  // As barras saem da MESMA grade: os ultimos 12 meses ja iniciados, na ordem.
  const barras = rows
    .flatMap((row, i) => row.cells.map((cell, j) => ({ ...cell,
      vendas: grades.vendas[i].cells[j].value, vgv: grades.vgv[i].cells[j].value,
    })))
    .filter((cell) => cell.value !== null)
    .slice(-12)
    // `mes` so para a cor: o numero do mes e fixo no calendario, entao Janeiro
    // sai da mesma cor em todo ano e a janela de 12 barras nunca repete cor em
    // barras vizinhas — o que o hash do rotulo nao garantiria.
    .map((cell) => ({
      label: cell.label,
      value: cell.value as number,
      vendas: cell.vendas,
      vgv: cell.vgv,
      mes: Number(cell.month.slice(0, 2)),
    }));

  // Pergunta se ha VENDA, nao se a soma zerou: em "Faturamento", uma venda
  // registrada sem valor faria o total dar 0 e o bloco dizer que nao ha venda
  // nenhuma — com o quadrado dela na grade logo abaixo.
  const vazio = !deals.some((deal) => dealCategory(deal) === "venda");

  return (
    <SectionCard
      title="Faturamento por mês e por ano"
      description="Quantidade de vendas e VGV em cada mês e no total do ano. Escolha a medida em destaque."
      icon={CalendarRange}
      actions={
        <div role="group" aria-label="Métrica da grade" className="flex items-center gap-1">
          {METRICAS.map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={metric === value ? "secondary" : "ghost"}
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      }
    >
      {vazio ? (
        <EmptyState
          icon={CalendarRange}
          title="Ainda não há venda fechada"
          description="A grade por mês e por ano aparece assim que o primeiro negócio for ganho no pipeline."
        />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="h-[220px] w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barras} margin={{ top: 24, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                <XAxis dataKey="label" {...chartAxis} />
                <YAxis
                  {...chartAxis}
                  allowDecimals={false}
                  width={dinheiro ? 56 : 40}
                  tickFormatter={(value: number) => (dinheiro ? compacto.format(value) : num(value))}
                />
                <Tooltip {...chartTooltip} formatter={(_value: number, _name, item) => [
                  `${num(item.payload.vendas)} vendas · ${brl(item.payload.vgv)}`, "Resultado",
                ]} />
                {/* Barra vazada, como na referencia: o preenchimento translucido
                    guarda a leitura de area e o contorno mantem o contraste do
                    objeto grafico (3:1) nos dois temas. Uma cor por mes — o mes
                    continua escrito no eixo e na grade logo abaixo. */}
                <Bar dataKey="value" strokeWidth={1.5} radius={[6, 6, 0, 0]} {...chartStill}>
                  <LabelList dataKey="value" position="top" fill={tone("foreground")} stroke="none" fontSize={11}
                    formatter={(value: number) => dinheiro ? compacto.format(value) : num(value)} />
                  {barras.map((bar) => (
                    <Cell
                      key={bar.label}
                      fill={tone(seriesToken(bar.mes - 1), 0.18)}
                      stroke={tone(seriesToken(bar.mes - 1))}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 13 colunas nao cabem em celular: a rolagem fica AQUI dentro, com a
              margem negativa levando a area ate a borda do cartao. A margem tem
              de casar com o padding do corpo do `SectionCard` (`p-4 sm:p-5`) —
              se os dois divergirem, a sangria passa da borda. `tabIndex` porque
              nada dentro da tabela e focavel — sem ele o teclado nao alcanca as
              colunas escondidas. */}
          <div
            className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-5 sm:px-5"
            role="region"
            aria-label={`Grade de ${rotulo.toLowerCase()} por mês e por ano`}
            tabIndex={0}
          >
            <table className="w-max border-separate border-spacing-1.5 text-left">
              <caption className="sr-only">
                Quantidade de vendas e VGV de cada mês, uma linha por ano, com os totais na última coluna.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="px-1 pb-1 text-eyebrow">
                    Ano
                  </th>
                  {MESES.map((mes) => (
                    <th
                      key={mes}
                      scope="col"
                      className="px-1 pb-1 text-center text-eyebrow"
                    >
                      {mes}
                    </th>
                  ))}
                  <th scope="col" className="px-1 pb-1 text-center text-eyebrow">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.year}>
                    <th scope="row" className="pr-2 text-sm font-bold tabular-nums text-foreground">
                      {row.year}
                    </th>
                    {row.cells.map((cell, cellIndex) => (
                      <td key={cell.month} className="p-0">
                        <div
                          className={`flex h-20 min-w-[124px] flex-col items-center justify-center gap-0.5 rounded-xl border px-2 ${
                            cell.value === null
                              ? "border-dashed border-border text-muted-foreground"
                              : "border-border bg-muted/60 text-foreground"
                          }`}
                        >
                          <span className="text-xs font-medium text-muted-foreground">{cell.label}</span>
                          <span className={`font-bold tabular-nums ${dinheiro ? "text-sm" : "text-lg"}`}>
                            {fmt(cell.value)}{!dinheiro && cell.value !== null && <span className="text-xs font-normal"> {cell.value === 1 ? "venda" : "vendas"}</span>}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">{otherFmt(secondary[rowIndex].cells[cellIndex].value)}</span>
                        </div>
                      </td>
                    ))}
                    <td className="p-0">
                      <div
                        className="flex h-20 min-w-[132px] flex-col items-center justify-center gap-0.5 rounded-xl border border-success/40 bg-success/10 px-2 text-success"
                      >
                        <span className="text-xs font-medium">{row.year}</span>
                        <span className={`font-bold tabular-nums ${dinheiro ? "text-sm" : "text-lg"}`}>
                          {fmt(row.total)}{!dinheiro && <span className="text-xs font-normal"> {row.total === 1 ? "venda" : "vendas"}</span>}
                        </span>
                        <span className="text-xs tabular-nums">{otherFmt(secondary[rowIndex].total)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
