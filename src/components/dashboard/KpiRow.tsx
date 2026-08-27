import { CheckCircle2, DollarSign, FileText, TrendingUp, Users, XCircle } from "lucide-react";
import { KpiCard } from "@/components/shared";
import { brl, num } from "@/lib/format";
import type { MonthStats } from "./data";

export interface KpiRowProps {
  stats: MonthStats;
  leads: number;
  /** Mesmo calculo no mes anterior. Sem ele o cartao nao mostra delta. */
  previous: MonthStats | null;
  previousLabel: string | null;
}

/** Delta absoluto ja formatado; `undefined` quando nao ha mes anterior com que comparar. */
function delta(
  current: number,
  before: number | undefined,
  label: string | null,
  options: { invert?: boolean; format?: (value: number) => string } = {},
) {
  if (before === undefined || label === null) return undefined;
  const { invert = false, format = num } = options;
  const diff = current - before;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  // Subir nem sempre e bom: em perdas a seta para cima e vermelha.
  const tone = diff === 0 ? "neutral" : diff > 0 !== invert ? "success" : "danger";
  return {
    label: `${diff > 0 ? "+" : ""}${format(diff)} vs. ${label}`,
    direction,
    tone,
  } as const;
}

/**
 * A regua de indicadores do mes. Seis cartoes do kit — a meta saiu daqui e
 * virou card proprio (`GoalCard`), porque "Meta —" sem meta cadastrada nao diz
 * nada a quem esta olhando.
 */
export function KpiRow({ stats, leads, previous, previousLabel }: KpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard label="Leads" value={num(leads)} icon={Users} hint="total na base" />
      <KpiCard
        label="Produção"
        value={num(stats.propostas)}
        icon={FileText}
        delta={delta(stats.propostas, previous?.propostas, previousLabel)}
        hint="propostas em aberto"
      />
      <KpiCard
        label="Resultado"
        value={num(stats.vendas)}
        icon={TrendingUp}
        delta={delta(stats.vendas, previous?.vendas, previousLabel)}
        hint="vendas fechadas"
      />
      <KpiCard
        label="Perdas"
        value={num(stats.perdas)}
        icon={XCircle}
        delta={delta(stats.perdas, previous?.perdas, previousLabel, { invert: true })}
        hint="quedas e distratos"
      />
      <KpiCard
        label="Negócios"
        value={num(stats.negocios)}
        icon={CheckCircle2}
        variant="highlight"
        delta={delta(stats.negocios, previous?.negocios, previousLabel)}
        hint="vendas + propostas"
      />
      <KpiCard
        label="VGV"
        value={brl(stats.vgv)}
        icon={DollarSign}
        delta={delta(stats.vgv, previous?.vgv, previousLabel, { format: (value) => brl(value) })}
        hint="valor das vendas"
      />
    </div>
  );
}
