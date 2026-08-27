import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Flame, Inbox, TrendingUp, Users } from "lucide-react";
import { format } from "date-fns";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { EmptyState, KpiCard, LoadingState, SectionCard } from "@/components/shared";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { chartAxis, chartGrid, chartStill, chartTooltip, tone } from "@/lib/tone";
import { LEAD_STATUSES } from "@/types/crm";
import { BarList } from "./BarList";
import { useDashboardLeads } from "./data";

const statusLabel = (value: string) =>
  LEAD_STATUSES.find((status) => status.value === value)?.label ?? value;

const DIAS = 14;

/**
 * Aba de leads. Carrega a lista completa por conta propria — o payload do
 * painel devolve so a contagem por canal, e daqui saem tambem a serie por dia,
 * a situacao e o corretor.
 *
 * O `TabsContent` do Radix so monta a aba ativa, entao quem nunca abre Leads
 * nao paga a consulta.
 */
export function LeadsPanel() {
  const { data: leads, isPending, error, refetch } = useDashboardLeads();

  const view = useMemo(() => {
    const rows = leads ?? [];
    const agora = Date.now();
    const hoje = new Date().toDateString();

    const porDia = new Map<string, number>();
    for (let i = DIAS - 1; i >= 0; i -= 1) {
      const dia = new Date();
      dia.setDate(dia.getDate() - i);
      porDia.set(format(dia, "dd/MM"), 0);
    }

    const porOrigem = new Map<string, number>();
    const porSituacao = new Map<string, number>();
    const porCorretor = new Map<string, number>();
    let hojeCount = 0;
    let ultimos7 = 0;
    let convertidos = 0;

    for (const lead of rows) {
      const criado = new Date(lead.created_at);
      if (criado.toDateString() === hoje) hojeCount += 1;
      if ((agora - criado.getTime()) / 86_400_000 <= 7) ultimos7 += 1;
      if (lead.status === "converted") convertidos += 1;

      const dia = format(criado, "dd/MM");
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
      total: rows.length,
      hoje: hojeCount,
      ultimos7,
      convertidos,
      conversao: rows.length ? Math.round((convertidos / rows.length) * 100) : 0,
      porDia: Array.from(porDia, ([name, value]) => ({ name, value })),
      porOrigem: ordenar(porOrigem),
      porSituacao: ordenar(porSituacao).map((row) => ({ ...row, label: statusLabel(row.label) })),
      porCorretor: ordenar(porCorretor).slice(0, 10),
    };
  }, [leads]);

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

  if (view.total === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nenhum lead na base"
        description="Assim que o Meta Ads ou um cadastro manual criar o primeiro lead, ele aparece aqui e entra na roleta."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total de leads" value={num(view.total)} icon={Users} />
        <KpiCard label="Hoje" value={num(view.hoje)} icon={Flame} />
        <KpiCard label="Últimos 7 dias" value={num(view.ultimos7)} icon={TrendingUp} />
        <KpiCard
          label="Convertidos"
          value={num(view.convertidos)}
          icon={CheckCircle2}
          hint={`${view.conversao}% da base`}
        />
      </div>

      <SectionCard title="Leads por dia" description={`Entrada diária nos últimos ${DIAS} dias`} icon={TrendingUp}>
        <div className="h-[240px] w-full">
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
        <SectionCard title="Por origem" description="Canal de aquisição" icon={Flame}>
          <BarList rows={view.porOrigem} share />
        </SectionCard>
        <SectionCard title="Por situação" description="Estágio atual do lead" icon={Inbox}>
          <BarList rows={view.porSituacao} token="chart-2" share />
        </SectionCard>
      </div>

      <SectionCard title="Top corretores por leads" description="Os dez com mais leads recebidos" icon={Users}>
        <BarList rows={view.porCorretor} token="chart-5" />
      </SectionCard>
    </div>
  );
}
