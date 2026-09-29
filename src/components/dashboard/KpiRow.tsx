import { CheckCircle2, Database, DollarSign, FileText, TrendingUp, Undo2, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard, KpiGrid } from "@/components/shared";
import { brl, num } from "@/lib/format";
import type { ContagemDoMes } from "./cartoesDoMes";
import { ALL_MONTHS, previousMonth, type MonthStats } from "./data";

export interface KpiRowProps {
  stats: MonthStats;
  /** Leads criados NO PERÍODO. `null` enquanto a lista ainda não chegou. */
  leadsNoPeriodo: number | null;
  /**
   * A consulta de leads falhou. Sem isto o cartão ficava no travessão para
   * sempre sob o texto "recebidos em MM/AAAA", e o traço — que o card usa para
   * dizer "ainda carregando" — passava a dizer "falhou" sem nada avisar.
   */
  leadsError?: boolean;
  /** Refaz a consulta de leads. Sem isto o cartão errado ficava sem saída — o
   *  "Tentar de novo" só existia dentro da aba Leads, que ninguém abre para
   *  consertar um cartão do topo. */
  onLeadsRetry?: () => void;
  /** Total de leads na base, sem recorte de período. */
  leadsNaBase: number;
  /**
   * O que a lista de leads cobre quando veio cortada ("últimos 1.000 leads").
   * O cartão "Leads" sai dessa lista e precisa dizer isso; "Base de leads" é
   * contagem exata e não.
   */
  leadsAmostra?: string | null;
  /**
   * De quem são os NEGÓCIOS e de quem são os LEADS desta régua.
   *
   * Os dois recortes são diferentes e ficam lado a lado: `deals_select` chega em
   * `can_read_all()` e `leads_select` recorta por `auth_visible_profiles()` —
   * para o diretor a mesma linha somava 35 negócios da empresa inteira ao lado
   * de 58 leads da própria subárvore, sem nada dizendo que são conjuntos
   * distintos.
   */
  dealsLabel?: string;
  leadsLabel?: string;
  /** O período escolhido no filtro do topo, ou `ALL_MONTHS`. */
  month: string;
  /** Meta de VGV do mês (`goals`, metric 'vgv'), quando houver linha cadastrada. */
  vgvGoal?: number | null;
  /** Mesmo calculo no mes anterior. Sem ele o cartao nao mostra delta. */
  previous: MonthStats | null;
  previousLabel: string | null;
  /**
   * Produção, negócios, perdas e distratos pelo Status 1/2 (`cartoesDoPeriodo`).
   * `null` enquanto o catálogo de status não chegou — os cartões mostram "—".
   */
  cartoes?: {
    atual: ContagemDoMes;
    anterior: ContagemDoMes | null;
    distratosAnterior: number | null;
    distratosAntesDoAnterior: number | null;
  } | null;
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
 * A régua de indicadores do mês — oito cartões, na ordem e nas cores pedidas
 * pelo cliente em 28/09/2026: leads do mês e base (azul), produção (cinza,
 * legado + propostas), negócios (preto, só o Status 2 "Virou Negócio"), perdas
 * (vermelho, Status 1 OFF — queda inclusa), distratos do mês ANTERIOR (o
 * distrato chega depois do mês fechado), vendas e VGV gerado (verde). A meta de
 * VENDAS é card próprio (`GoalCard`); a de VGV fica como alvo do cartão de VGV.
 *
 * Leads segue o filtro de período; a base inteira fica em cartão próprio, com
 * o rótulo dizendo que não tem recorte de PERÍODO e de quem é o de PERFIL.
 */
export function KpiRow({
  stats,
  leadsNoPeriodo,
  leadsError = false,
  onLeadsRetry,
  leadsNaBase,
  leadsAmostra = null,
  dealsLabel = "toda a operação",
  leadsLabel = "toda a base",
  month,
  vgvGoal,
  previous,
  previousLabel,
  cartoes,
}: KpiRowProps) {
  const periodo = month === ALL_MONTHS ? "todos os meses" : month;
  const vgvPct = vgvGoal && vgvGoal > 0 ? Math.round((stats.vgv / vgvGoal) * 100) : null;
  const atual = cartoes?.atual;
  const anterior = cartoes?.anterior ?? undefined;
  const mesAnterior = month === ALL_MONTHS ? null : previousMonth(month);
  const antesDoAnterior = mesAnterior ? previousMonth(mesAnterior) : null;

  return (
    <KpiGrid cols={4}>
      <KpiCard
        label="Leads do mês"
        cor="azul"
        // O traço marca "ainda carregando", não "zero": afirmar zero antes da
        // lista chegar é o mesmo erro de inventar número. Quando a consulta
        // FALHA o traço continua, mas o texto de apoio para de prometer um
        // número que nunca vem.
        value={leadsNoPeriodo === null ? "—" : num(leadsNoPeriodo)}
        icon={Users}
        hint={
          leadsError ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-destructive">não consegui carregar os leads</span>
              {onLeadsRetry && (
                <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onLeadsRetry}>
                  Tentar de novo
                </Button>
              )}
            </span>
          ) : (
            `recebidos em ${periodo} · ${leadsLabel}${leadsAmostra ? ` · entre os ${leadsAmostra}` : ""}`
          )
        }
      />
      <KpiCard
        label="Base de leads"
        cor="azul"
        value={num(leadsNaBase)}
        icon={Database}
        hint={`sem recorte de período · ${leadsLabel}`}
      />
      <KpiCard
        label="Produção"
        cor="cinza"
        value={atual ? num(atual.producao) : "—"}
        icon={FileText}
        delta={atual ? delta(atual.producao, anterior?.producao, previousLabel) : undefined}
        hint={atual ? `Legado ${num(atual.legado)} + Propostas ${num(atual.propostas)}` : "carregando o catálogo de status"}
      />
      <KpiCard
        label="Negócios"
        cor="preto"
        value={atual ? num(atual.negocios) : "—"}
        icon={CheckCircle2}
        delta={atual ? delta(atual.negocios, anterior?.negocios, previousLabel) : undefined}
        hint={`Status 2 "Virou Negócio" · ${dealsLabel}`}
      />
      <KpiCard
        label="Perdas"
        cor="vermelho"
        value={atual ? num(atual.perdas) : "—"}
        icon={XCircle}
        delta={atual ? delta(atual.perdas, anterior?.perdas, previousLabel, { invert: true }) : undefined}
        hint="OFF e quedas do mês"
      />
      <KpiCard
        label="Distratos"
        cor="vermelho"
        value={cartoes?.distratosAnterior == null ? "—" : num(cartoes.distratosAnterior)}
        icon={Undo2}
        delta={cartoes?.distratosAnterior == null ? undefined : delta(
          cartoes.distratosAnterior,
          cartoes.distratosAntesDoAnterior ?? undefined,
          antesDoAnterior,
          { invert: true },
        )}
        hint={mesAnterior ? `do mês anterior (${mesAnterior}) — chegam depois do fechamento` : "escolha um mês para ver o anterior"}
      />
      <KpiCard
        label="Vendas"
        cor="verde"
        value={num(stats.vendas)}
        icon={TrendingUp}
        delta={delta(stats.vendas, previous?.vendas, previousLabel)}
        hint="vendas fechadas"
      />
      <KpiCard
        label="VGV gerado"
        cor="verde"
        value={brl(stats.vgv)}
        icon={DollarSign}
        delta={delta(stats.vgv, previous?.vgv, previousLabel, { format: (value) => brl(value) })}
        hint={vgvPct === null ? "valor geral de vendas no período" : `${num(vgvPct)}% da meta de ${brl(vgvGoal ?? 0)}`}
      />
    </KpiGrid>
  );
}
