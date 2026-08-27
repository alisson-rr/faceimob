import { TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, SectionCard } from "@/components/shared";
import { chartAxis, chartGrid, chartLegend, chartStill, chartTooltip, seriesToken, tone } from "@/lib/tone";
import type { MonthlySeries } from "./data";

/** "03" → "mar". O eixo com numero de mes obriga o leitor a traduzir de cabeca. */
const monthLabel = (mm: string) => format(new Date(2000, Number(mm) - 1, 1), "MMM", { locale: ptBR });

/**
 * Vendas por mes do calendario, uma linha por ano. Independe do filtro de
 * periodo de proposito: e a comparacao entre anos que da a leitura de sazonalidade.
 */
export function MonthlyTrend({ series }: { series: MonthlySeries }) {
  return (
    <SectionCard
      title="Comparativo mensal por ano"
      description="Vendas fechadas em cada mês, ano a ano"
      icon={TrendingUp}
    >
      {series.years.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Ainda não há histórico"
          description="A comparação entre anos aparece assim que houver vendas registradas em mais de um mês."
        />
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series.rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
              <XAxis dataKey="mes" {...chartAxis} tickFormatter={monthLabel} />
              <YAxis {...chartAxis} allowDecimals={false} />
              <Tooltip {...chartTooltip} labelFormatter={(mes: string) => monthLabel(mes)} />
              <Legend wrapperStyle={chartLegend} />
              {series.years.map((year, index) => (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={year}
                  stroke={tone(seriesToken(index))}
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                  {...chartStill}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionCard>
  );
}
