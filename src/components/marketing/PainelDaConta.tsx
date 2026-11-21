import { ArrowDown, ArrowUp } from "lucide-react";
import { CartesianGrid, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard, KpiGrid, type KpiDelta } from "@/components/shared";
import type { MetaDiaRow } from "@/integrations/supabase/analytics";
import { brl, num } from "@/lib/format";
import { chartAxis, chartGrid, chartStill, chartTooltip, tone } from "@/lib/tone";
import { cn } from "@/lib/utils";
import { resumoDoGrafico, serieDeCpl, totaisDaConta, variacao } from "./contasDaConta";

const reais = (v: number | null) => (v === null ? "—" : brl(v, { cents: true }));
const pct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const decimal = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Sobe = bom (leads, cliques), sobe = ruim (custos) ou neutro (investimento). */
type Leitura = "sobe_bom" | "sobe_ruim" | "neutro";

function seta(v: number | null, leitura: Leitura): KpiDelta | undefined {
  if (v === null) return undefined;
  const pontos = Math.round(Math.abs(v) * 100);
  const direction = pontos === 0 ? "flat" : v > 0 ? "up" : "down";
  const bom = (v > 0) === (leitura === "sobe_bom");
  return {
    label: `${pontos}%`,
    direction,
    tone: leitura === "neutro" || direction === "flat" ? "neutral" : bom ? "success" : "danger",
  };
}

function Metrica({ rotulo, valor, delta }: { rotulo: string; valor: string; delta?: KpiDelta }) {
  const Icone = delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : null;
  return (
    <div className="px-3 py-2 text-center">
      <p className="text-eyebrow">{rotulo}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{valor}</p>
      {delta && (
        <p className={cn("flex items-center justify-center gap-0.5 text-xs font-semibold tabular-nums",
          delta.tone === "success" ? "text-success" : delta.tone === "danger" ? "text-destructive" : "text-muted-foreground")}>
          {Icone && <Icone className="h-3 w-3" aria-hidden />}{delta.label}
        </p>
      )}
    </div>
  );
}

/**
 * Painel da conta Meta (pedido de 21/11/2026, no modelo enviado pelo cliente):
 * verba do dia, investido, leads, custo por resultado e o saldo da conta para
 * monitorar; a régua de CTR, CPM, CPC, impressões e cliques; e o custo por lead
 * de cada dia contra a média do período. As setas comparam com o período
 * anterior (`periodoAnteriorMeta`). Alcance não entra: é pessoa única por
 * período e a soma dos dias inventaria o número.
 */
export function PainelDaConta({
  dias, diasAnteriores, verbaDiaria, saldo, cadastros, conversas, cplLimite, periodoRotulo, ultimoDiaCorrendo,
}: {
  dias: MetaDiaRow[];
  diasAnteriores: MetaDiaRow[];
  verbaDiaria: number;
  saldo: number | null;
  cadastros: number;
  conversas: number;
  cplLimite: number;
  periodoRotulo: string;
  ultimoDiaCorrendo: boolean;
}) {
  const atual = totaisDaConta(dias);
  const antes = totaisDaConta(diasAnteriores);
  const temAnterior = diasAnteriores.length > 0;
  const v = (a: number | null, b: number | null) => (temAnterior ? variacao(a, b) : null);
  const serie = serieDeCpl(dias);
  const { media, primeiraParaUltima } = resumoDoGrafico(dias);
  const diasDeSaldo = saldo !== null && verbaDiaria > 0 ? Math.floor(saldo / verbaDiaria) : null;
  const cplAcima = atual.custoPorResultado !== null && atual.custoPorResultado > cplLimite;
  const ultimo = serie.at(-1)?.dia;

  return (
    <div className="space-y-3">
      <KpiGrid cols={5}>
        <KpiCard label="Verba/dia das ativas" value={reais(verbaDiaria)} hint="soma de hoje" />
        <KpiCard label="Investido" value={reais(atual.investido)} delta={seta(v(atual.investido, antes.investido), "neutro")} />
        <KpiCard
          label="Leads" value={num(atual.resultados)} delta={seta(v(atual.resultados, antes.resultados), "sobe_bom")}
          hint={`${num(cadastros)} cadastros · ${num(conversas)} conversas`}
        />
        <KpiCard
          label="Custo por resultado" variant="highlight" value={reais(atual.custoPorResultado)}
          delta={seta(v(atual.custoPorResultado, antes.custoPorResultado), "sobe_ruim")}
          hint={<span className={cn(cplAcima && "text-warning")}>limite {reais(cplLimite)}</span>}
        />
        <KpiCard
          label="Saldo da conta Meta Ads" value={reais(saldo)}
          hint={saldo === null ? "conta sem saldo pré-pago" : diasDeSaldo !== null ? `~${num(diasDeSaldo)} dia(s) com a verba de hoje` : undefined}
        />
      </KpiGrid>

      <div className="grid grid-cols-2 divide-border rounded-2xl border border-border bg-card sm:grid-cols-5 sm:divide-x">
        <Metrica rotulo="CTR" valor={pct(atual.ctr)} delta={seta(v(atual.ctr, antes.ctr), "sobe_bom")} />
        <Metrica rotulo="CPM" valor={reais(atual.cpm)} delta={seta(v(atual.cpm, antes.cpm), "sobe_ruim")} />
        <Metrica rotulo="CPC" valor={reais(atual.cpc)} delta={seta(v(atual.cpc, antes.cpc), "sobe_ruim")} />
        <Metrica rotulo="Impressões" valor={num(atual.impressoes)} delta={seta(v(atual.impressoes, antes.impressoes), "sobe_bom")} />
        <Metrica rotulo="Cliques" valor={num(atual.cliques)} delta={seta(v(atual.cliques, antes.cliques), "sobe_bom")} />
      </div>

      <section aria-labelledby="cpl-por-dia" className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="cpl-por-dia" className="font-bold">Custo por lead por dia · {periodoRotulo}</h3>
            <p className="text-xs text-muted-foreground">Quanto menor, melhor. Só as campanhas de lead. Passe o dedo nos dias para ver o detalhe.</p>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <p className="text-eyebrow">Média do período</p>
              <p className="text-xl font-bold tabular-nums">{reais(media)}</p>
            </div>
            {primeiraParaUltima !== null && (
              <div>
                <p className="text-eyebrow">1ª semana → última</p>
                <p className={cn("flex items-center justify-end gap-1 text-xl font-bold tabular-nums",
                  primeiraParaUltima <= 0 ? "text-success" : "text-destructive")}>
                  {primeiraParaUltima <= 0 ? <ArrowDown className="h-4 w-4" aria-hidden /> : <ArrowUp className="h-4 w-4" aria-hidden />}
                  {Math.round(Math.abs(primeiraParaUltima) * 100)}% {primeiraParaUltima <= 0 ? "melhor" : "pior"}
                </p>
              </div>
            )}
          </div>
        </div>

        {serie.some((d) => d.cpl !== null) ? (
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} vertical={false} strokeOpacity={0.4} />
                <XAxis dataKey="rotulo" {...chartAxis} />
                <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
                <Tooltip
                  {...chartTooltip}
                  labelFormatter={(_, p) => (p?.[0]?.payload?.dia ? new Date(`${p[0].payload.dia}T12:00:00`).toLocaleDateString("pt-BR") : "")}
                  formatter={(valor: number) => [reais(valor), "Custo por lead"]}
                />
                {media !== null && <ReferenceLine y={media} stroke={tone("muted-foreground")} strokeDasharray="5 5" />}
                <Line
                  {...chartStill} type="monotone" dataKey="cpl" connectNulls stroke={tone("highlight")} strokeWidth={2.5}
                  dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { cpl: number | null; dia: string } }) => {
                    if (cx === undefined || cy === undefined || payload?.cpl == null) return <g key={`v-${payload?.dia}`} />;
                    const acima = media !== null && payload.cpl > media;
                    const correndo = ultimoDiaCorrendo && payload.dia === ultimo;
                    return (
                      <circle
                        key={payload.dia} cx={cx} cy={cy} r={correndo ? 6 : 4.5}
                        fill={tone(acima ? "destructive" : "success")}
                        stroke={correndo ? tone("highlight") : tone("card")} strokeWidth={2}
                      />
                    );
                  }}
                >
                  <LabelList dataKey="cpl" position="top" offset={10} fontSize={11} fill={tone("foreground")}
                    formatter={(valor: number | null) => (valor == null ? "" : decimal(valor))} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lead de campanha no período.</p>
        )}

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden />abaixo da média</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive" aria-hidden />acima da média</span>
          <span>- - - média do período</span>
          {ultimoDiaCorrendo && <span>o último dia é hoje e ainda está correndo</span>}
        </div>
      </section>
    </div>
  );
}
