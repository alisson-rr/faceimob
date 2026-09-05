import { CheckCircle2, Database, DollarSign, FileText, TrendingUp, Users, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/shared";
import { brl, num } from "@/lib/format";
import { ALL_MONTHS, type MonthStats } from "./data";

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
 * A regua de indicadores do mes. Sete cartoes do kit — a meta de VENDAS saiu
 * daqui e virou card proprio (`GoalCard`), porque "Meta —" sem meta cadastrada
 * nao diz nada a quem esta olhando; a meta de VGV fica aqui, como alvo do
 * proprio cartao de VGV.
 *
 * "Leads" segue o filtro de periodo como todo o resto: enquanto ele mostrava o
 * total da base sob um cabecalho que dizia "— 08/2026", dois numeros do mesmo
 * cartao falavam de periodos diferentes. O total da base continua visivel, em
 * cartao proprio, com o rotulo dizendo que ele nao tem recorte de PERIODO e de
 * quem e o recorte de PERFIL.
 */
export function KpiRow({
  stats,
  leadsNoPeriodo,
  leadsError = false,
  onLeadsRetry,
  leadsNaBase,
  dealsLabel = "toda a operação",
  leadsLabel = "toda a base",
  month,
  vgvGoal,
  previous,
  previousLabel,
}: KpiRowProps) {
  const periodo = month === ALL_MONTHS ? "todos os meses" : month;
  const vgvPct = vgvGoal && vgvGoal > 0 ? Math.round((stats.vgv / vgvGoal) * 100) : null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <KpiCard
        label="Leads"
        // O traco marca "ainda carregando", nao "zero": afirmar zero antes da
        // lista chegar e o mesmo erro de inventar numero. Quando a consulta
        // FALHA o traco continua, mas o texto de apoio para de prometer um
        // numero que nunca vem.
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
            `recebidos em ${periodo} · ${leadsLabel}`
          )
        }
      />
      <KpiCard
        label="Base de leads"
        value={num(leadsNaBase)}
        icon={Database}
        hint={`sem recorte de período · ${leadsLabel}`}
      />
      <KpiCard
        label="Produção"
        value={num(stats.propostas)}
        icon={FileText}
        delta={delta(stats.propostas, previous?.propostas, previousLabel)}
        hint="negócios em aberto"
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
        hint={`vendas + em aberto · ${dealsLabel}`}
      />
      <KpiCard
        label="VGV"
        value={brl(stats.vgv)}
        icon={DollarSign}
        delta={delta(stats.vgv, previous?.vgv, previousLabel, { format: (value) => brl(value) })}
        hint={vgvPct === null ? "valor das vendas" : `${num(vgvPct)}% da meta de ${brl(vgvGoal ?? 0)}`}
      />
    </div>
  );
}
