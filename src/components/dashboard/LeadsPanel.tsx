import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Flame, Inbox, Percent, TrendingUp, Users } from "lucide-react";
import { format, parseISO } from "date-fns";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { EmptyState, KpiCard, LoadingState, SectionCard } from "@/components/shared";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { chartAxis, chartGrid, chartStill, chartTooltip, tone } from "@/lib/tone";
import { LEAD_STATUSES } from "@/types/crm";
import { BarList } from "./BarList";
import { ChartData } from "./ChartData";
import { ALL_MONTHS, leadsInMonth, useDashboardLeads } from "./data";

const statusLabel = (value: string) =>
  LEAD_STATUSES.find((status) => status.value === value)?.label ?? value;

const DIAS = 14;

/**
 * Os dias que a série cobre, em `yyyy-MM-dd`: o mês inteiro (até hoje), ou os
 * últimos 14 dias quando o filtro está em "todos os meses" (aí não há mês a
 * percorrer).
 *
 * A chave é a data COMPLETA, não `dd/MM`: em "todos os meses" a série somava no
 * mesmo rótulo o lead de 15/08/2025 e o de 15/08/2026 — dois anos empilhados
 * num ponto só. O rótulo continua `dd/MM`, que é o que cabe no eixo.
 *
 * Dia futuro fica de fora: o mês corrente desenhava a reta até o dia 30 com
 * zero, e a queda no fim do gráfico era o calendário, não a operação.
 */
const diasDaSerie = (month: string, hoje = new Date()): string[] => {
  const hojeIso = format(hoje, "yyyy-MM-dd");
  const match = /^(\d{2})\/(\d{4})$/.exec(month);
  if (!match) {
    return Array.from({ length: DIAS }, (_, index) => {
      const dia = new Date(hoje);
      dia.setDate(dia.getDate() - (DIAS - 1 - index));
      return format(dia, "yyyy-MM-dd");
    });
  }
  const mes = Number(match[1]);
  const ano = Number(match[2]);
  const ultimo = new Date(ano, mes, 0).getDate();
  const todos = Array.from({ length: ultimo }, (_, index) =>
    format(new Date(ano, mes - 1, index + 1), "yyyy-MM-dd"),
  );
  const ateHoje = todos.filter((iso) => iso <= hojeIso);
  // Mês inteiro no futuro (meta cadastrada com antecedência): sem este desvio a
  // série ficaria vazia e o gráfico, um retângulo em branco sem explicação.
  return ateHoje.length ? ateHoje : todos;
};

export interface LeadsPanelProps {
  /** O mesmo período do filtro do topo — a aba inteira o respeita. */
  month: string;
  /**
   * `leads_select` recorta por `auth_visible_profiles()`: o número desta aba é o
   * recorte de quem está olhando, e o texto tem de dizer qual — a mesma decisão
   * que o `CcaStatusCard` já tomou com a prop `toda`.
   */
  scopeLabel?: string;
  /** A base mostrada é a da operação inteira (admin/sócio) ou o recorte do usuário. */
  toda?: boolean;
}

/**
 * Aba de leads. Carrega a lista completa por conta propria — o payload do
 * painel devolve so a contagem por canal, e daqui saem tambem a serie por dia,
 * a situacao e o corretor.
 *
 * Tudo aqui segue o filtro de periodo do topo. Antes a aba era sempre "hoje /
 * ultimos 7 / ultimos 14 dias": trocar o mes no cabecalho nao mudava um numero
 * sequer, e o cabecalho prometia um periodo que a aba nao entregava. O total da
 * base — que nao tem recorte de PERIODO e tem recorte de PERFIL — e dito uma vez
 * so, na regua do topo do Dashboard, que fica visivel em todas as abas.
 *
 * A consulta e a MESMA do KPI de leads do topo (`useDashboardLeads`, chave
 * `["dashboard","leads",<perfil>]`): o React Query serve as duas do mesmo
 * cache. Ela nao e mais paga so por quem abre esta aba — o cabecalho precisa da
 * data de cada lead para respeitar o filtro de periodo, entao o Dashboard ja a
 * dispara na abertura.
 */
export function LeadsPanel({ month, scopeLabel = "toda a base", toda = true }: LeadsPanelProps) {
  const { data: leads, isPending, error, refetch } = useDashboardLeads();

  const view = useMemo(() => {
    const base = leads ?? [];
    const rows = leadsInMonth(base, month);

    const porDia = new Map<string, number>(diasDaSerie(month).map((dia) => [dia, 0]));
    const porOrigem = new Map<string, number>();
    const porSituacao = new Map<string, number>();
    const porCorretor = new Map<string, number>();
    let convertidos = 0;

    for (const lead of rows) {
      if (lead.status === "converted") convertidos += 1;

      const dia = format(new Date(lead.created_at), "yyyy-MM-dd");
      if (porDia.has(dia)) porDia.set(dia, (porDia.get(dia) ?? 0) + 1);

      const origem = lead.source || "Sem origem";
      porOrigem.set(origem, (porOrigem.get(origem) ?? 0) + 1);
      porSituacao.set(lead.status, (porSituacao.get(lead.status) ?? 0) + 1);

      const corretor = lead.broker_name || "Não atribuído";
      porCorretor.set(corretor, (porCorretor.get(corretor) ?? 0) + 1);
    }

    const ordenar = (map: Map<string, number>) =>
      Array.from(map, ([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

    return {
      base: base.length,
      total: rows.length,
      convertidos,
      conversao: rows.length ? Math.round((convertidos / rows.length) * 100) : 0,
      // O eixo mostra `dd/MM`; a chave é a data completa, para o ano não somar
      // junto. `parseISO` evita o fuso do `new Date("yyyy-MM-dd")`, que lê UTC
      // e recuaria o rótulo um dia em Brasília.
      porDia: Array.from(porDia, ([iso, value]) => ({ name: format(parseISO(iso), "dd/MM"), value })),
      porOrigem: ordenar(porOrigem),
      porSituacao: ordenar(porSituacao).map((row) => ({ ...row, label: statusLabel(row.label) })),
      porCorretor: ordenar(porCorretor).slice(0, 10),
    };
  }, [leads, month]);

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não consegui carregar os leads"
        description={describeError(error, "A consulta de leads falhou. Verifique a conexão e tente de novo.")}
        action={
          <Button variant="outline" onClick={() => void refetch()}>
            Tentar de novo
          </Button>
        }
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-5">
        <LoadingState variant="kpi" rows={4} label="Carregando os leads…" />
        <LoadingState variant="block" />
      </div>
    );
  }

  // Zero aqui só prova que a BASE está vazia para quem enxerga todo mundo:
  // `leads_select` recorta por `auth_visible_profiles()`, então para o corretor
  // o vazio é o dele. Afirmar "nenhum lead na base" com 74 leads na operação
  // mandava procurar defeito onde há recorte de perfil.
  if (view.base === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={toda ? "Nenhum lead na base" : "Nenhum lead no seu recorte"}
        description={
          toda
            ? "Assim que o Meta Ads ou um cadastro manual criar o primeiro lead, ele aparece aqui e entra na roleta."
            : `Esta aba mostra ${scopeLabel} — a base da operação pode ter leads que o seu perfil não enxerga. Assim que a roleta distribuir o primeiro, ele aparece aqui.`
        }
      />
    );
  }

  const periodo = month === ALL_MONTHS ? "todos os meses" : month;

  // Base cheia e periodo vazio nao e a mesma coisa que base vazia: dizer "nenhum
  // lead na base" com 42 leads em outro mes mandava procurar defeito onde ha so
  // filtro.
  if (view.total === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={`Nenhum lead em ${periodo}`}
        description={`${toda ? "A base tem" : "Você enxerga"} ${num(view.base)} ${view.base === 1 ? "lead" : "leads"}, mas nenhum foi criado neste período. Troque o mês no filtro do topo.`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Sem "Base de leads" aqui: a régua do topo do Dashboard fica visível em
          TODAS as abas e já traz esse cartão com o mesmo número e o mesmo texto
          de apoio ("sem recorte de período · <recorte>"). Repetido, o mesmo
          cartão aparecia duas vezes na mesma tela — quem lia procurava a
          diferença entre dois números que sempre foram um só. O total da base
          continua dito aqui quando ele é a informação que falta: nos vazios
          ("A base tem N leads, mas nenhum foi criado neste período"). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label="Leads no período" value={num(view.total)} icon={Users} hint={periodo} />
        <KpiCard
          label="Convertidos"
          value={num(view.convertidos)}
          icon={CheckCircle2}
          hint={`no período · ${num(view.conversao)}% dos leads`}
        />
        <KpiCard label="Taxa de conversão" value={`${num(view.conversao)}%`} icon={Percent} hint="convertidos ÷ leads do período" />
      </div>

      <SectionCard
        title="Leads por dia"
        description={month === ALL_MONTHS ? `Entrada diária nos últimos ${DIAS} dias` : `Entrada diária em ${month}`}
        icon={TrendingUp}
      >
        <ChartData
          caption={month === ALL_MONTHS ? `Leads por dia nos últimos ${DIAS} dias` : `Leads por dia em ${month}`}
          columns={["Dia", "Leads"]}
          rows={view.porDia.map((row) => [row.name, row.value])}
        />
        <div className="h-[240px] w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={view.porDia} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGrid} vertical={false} />
              <XAxis dataKey="name" {...chartAxis} minTickGap={16} />
              <YAxis {...chartAxis} allowDecimals={false} />
              <Tooltip {...chartTooltip} formatter={(value: number) => [num(value), "Leads"]} />
              <Line
                type="monotone"
                dataKey="value"
                stroke={tone("chart-1")}
                strokeWidth={2.5}
                dot={{ r: 3 }}
                {...chartStill}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <SectionCard title="Por origem" description={`Canal de aquisição · ${periodo}`} icon={Flame}>
          <BarList rows={view.porOrigem} share />
        </SectionCard>
        <SectionCard title="Por situação" description={`Estágio atual do lead · ${periodo}`} icon={Inbox}>
          <BarList rows={view.porSituacao} token="chart-2" share />
        </SectionCard>
      </div>

      <SectionCard title="Top corretores por leads" description={`Os dez com mais leads recebidos · ${periodo}`} icon={Users}>
        <BarList rows={view.porCorretor} token="chart-5" />
      </SectionCard>
    </div>
  );
}
