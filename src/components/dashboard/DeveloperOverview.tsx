import { Building2, Layers } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState, SectionCard } from "@/components/shared";
import {
  chartAxis,
  chartBarLabel,
  chartGrid,
  chartLegend,
  chartStill,
  chartTooltip,
  shortTick,
  tone,
} from "@/lib/tone";
import { ChartData } from "./ChartData";
import type { DeveloperStats } from "./data";

const vazio = (
  <EmptyState
    icon={Building2}
    title="Nenhum negócio no período"
    description="Nenhuma construtora tem venda ou proposta no mês selecionado. Troque o período no filtro do topo."
  />
);

/**
 * Ha o que mostrar neste periodo?
 *
 * A pergunta e pelo TOTAL, nao por `rows.length`: a lista de construtoras vem
 * de todos os meses (para a construtora que parou nao sumir da grade), entao
 * ela nunca fica vazia e o estado vazio nunca disparava — num mes sem negocio a
 * tela pintava um grafico inteiro de zeros.
 */
const temDado = (rows: DeveloperStats[]) => rows.some((row) => row.negocios > 0);

/** Vendas × propostas por construtora — a leitura de abertura do painel. */
export function DeveloperOverview({ rows }: { rows: DeveloperStats[] }) {
  const data = rows.map((row) => ({ name: row.dev, Vendas: row.vendas, Propostas: row.propostas }));

  return (
    <SectionCard
      title="Panorama por construtora"
      description="Vendas e propostas do período, lado a lado"
      icon={Layers}
    >
      {!temDado(rows) ? (
        vazio
      ) : (
        <>
          <ChartData
            caption="Vendas e propostas do período por construtora"
            columns={["Construtora", "Vendas", "Propostas"]}
            rows={data.map((row) => [row.name, row.Vendas, row.Propostas])}
          />
          <div className="h-[260px] w-full" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
                <XAxis dataKey="name" {...chartAxis} interval={0} tickFormatter={(name: string) => shortTick(name, 16)} />
                <YAxis {...chartAxis} allowDecimals={false} />
                <Tooltip {...chartTooltip} />
                {/* Legenda no topo: embaixo ela disputa espaco com o nome da construtora. */}
                <Legend wrapperStyle={chartLegend} verticalAlign="top" align="right" height={28} />
                <Bar dataKey="Vendas" fill={tone("chart-2")} radius={[6, 6, 0, 0]} {...chartStill} />
                <Bar dataKey="Propostas" fill={tone("chart-5")} radius={[6, 6, 0, 0]} {...chartStill} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </SectionCard>
  );
}

/**
 * Ranking de propostas. Aqui cada barra e uma construtora, entao a cor vem de
 * `developerColor` — a mesma construtora tem a mesma cor em toda tela.
 */
export function DeveloperRanking({ rows }: { rows: DeveloperStats[] }) {
  const data = [...rows]
    .sort((a, b) => b.propostas - a.propostas || b.vendas - a.vendas)
    .map((row) => ({ name: row.dev, Propostas: row.propostas, token: row.token }));

  return (
    <SectionCard
      title="Ranking de propostas"
      description="Da construtora com mais propostas para a com menos"
      icon={Building2}
    >
      {!temDado(rows) ? (
        vazio
      ) : (
        <>
          <ChartData
            caption="Propostas do período por construtora, da maior para a menor"
            columns={["Construtora", "Propostas"]}
            rows={data.map((row) => [row.name, row.Propostas])}
          />
          <div className="w-full" style={{ height: Math.max(200, data.length * 40 + 32) }} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={data} margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} horizontal={false} />
                <XAxis type="number" {...chartAxis} allowDecimals={false} />
                <YAxis type="category" dataKey="name" {...chartAxis} width={140} tickFormatter={(name: string) => shortTick(name, 18)} />
                <Tooltip {...chartTooltip} />
                <Bar dataKey="Propostas" radius={[0, 6, 6, 0]} label={{ position: "right", ...chartBarLabel }} {...chartStill}>
                  {data.map((row) => (
                    <Cell key={row.name} fill={tone(row.Propostas === 0 ? "muted-foreground" : row.token)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </SectionCard>
  );
}
