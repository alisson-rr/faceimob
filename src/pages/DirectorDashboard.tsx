import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  DollarSign,
  FileText,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, KpiCard, LoadingState, PageHeader } from "@/components/shared";
import ComparativeFunnel from "@/components/ComparativeFunnel";
import {
  ALL_TEAMS,
  EMPTY_DAILY,
  monthBaseNow,
  useDirectorDaily,
  useDirectorPipeline,
  useDirectorScope,
  type DirectorDaily,
} from "@/components/dashboard/directorData";
import { num } from "@/lib/format";
import { DAILY_METRICS, type DailyMetricKey } from "@/lib/metrics";
import { describeError } from "@/lib/supabaseError";

/** Os cinco indicadores do diario que o diretor acompanha, na ordem do catalogo. */
const KPIS: { key: keyof DirectorDaily & DailyMetricKey; icon: LucideIcon }[] = [
  { key: "leads", icon: Users },
  { key: "coleta_docs", icon: FileText },
  { key: "analises", icon: ClipboardCheck },
  { key: "aprovados", icon: CheckCircle2 },
  { key: "vendas", icon: DollarSign },
];

const metricLabel = (key: DailyMetricKey) =>
  DAILY_METRICS.find((metric) => metric.key === key)?.label ?? key;

const plural = (count: number, one: string, many: string) => `${num(count)} ${count === 1 ? one : many}`;

/**
 * Painel da diretoria: o diario declarado pelas equipes ao lado do que o
 * pipeline mediu, no mes corrente. As consultas moram em
 * `@/components/dashboard/directorData`.
 */
export default function DirectorDashboard() {
  const { user, profile } = useAuth();
  const [teamFilter, setTeamFilter] = useState<string>(ALL_TEAMS);

  const scopeQuery = useDirectorScope(user?.id ?? null);
  const scope = scopeQuery.data;

  const teamIds = useMemo(() => {
    if (!scope) return [];
    return teamFilter === ALL_TEAMS ? scope.teams.map((team) => team.id) : [teamFilter];
  }, [scope, teamFilter]);

  const brokerIds = useMemo(() => {
    if (!scope) return [];
    const wanted = new Set(teamIds);
    return scope.brokers
      .filter((broker) => broker.team_id && wanted.has(broker.team_id))
      .map((broker) => broker.id);
  }, [scope, teamIds]);

  const dailyQuery = useDirectorDaily(teamIds);
  const pipelineQuery = useDirectorPipeline(brokerIds, !!scope);

  const failed = scopeQuery.error ?? dailyQuery.error ?? pipelineQuery.error;
  const loading = scopeQuery.isPending || dailyQuery.isLoading || pipelineQuery.isLoading;
  const daily = dailyQuery.data ?? EMPTY_DAILY;

  const header = (
    <PageHeader
      title="Painel do diretor"
      eyebrow="Diretoria"
      icon={UsersRound}
      description={
        scope
          ? `${profile?.name || "Diretoria"} · ${monthBaseNow()} · ${plural(scope.teams.length, "equipe", "equipes")} · ${plural(scope.managers.length, "gerente", "gerentes")}`
          : `${profile?.name || "Diretoria"} · ${monthBaseNow()}`
      }
      actions={
        <Select value={teamFilter} onValueChange={setTeamFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Filtrar por equipe">
            <SelectValue placeholder="Equipe" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TEAMS}>Todas as equipes</SelectItem>
            {(scope?.teams ?? []).map((team) => (
              <SelectItem key={team.id} value={team.id}>
                {team.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );

  if (failed) {
    const retry = () => {
      if (scopeQuery.error) void scopeQuery.refetch();
      if (dailyQuery.error) void dailyQuery.refetch();
      if (pipelineQuery.error) void pipelineQuery.refetch();
    };
    return (
      <>
        {header}
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar o painel da diretoria"
          description={describeError(failed, "A consulta falhou. Verifique a conexão e tente de novo.")}
          action={
            <Button variant="outline" onClick={retry}>
              Tentar de novo
            </Button>
          }
        />
      </>
    );
  }

  if (loading) {
    return (
      <>
        {header}
        <div className="flex flex-col gap-5">
          <LoadingState variant="kpi" rows={5} label="Carregando os indicadores da diretoria…" />
          <LoadingState variant="block" />
        </div>
      </>
    );
  }

  if (scope && scope.teams.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={UsersRound}
          title="Nenhuma equipe sob esta diretoria"
          description="Este painel soma o diário das equipes ligadas à sua diretoria. Peça a um administrador para vincular as equipes em Equipes."
        />
      </>
    );
  }

  return (
    <>
      {header}

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {KPIS.map(({ key, icon }) => (
            <KpiCard key={key} label={metricLabel(key)} value={num(daily[key])} icon={icon} />
          ))}
        </div>

        <ComparativeFunnel
          daily={{
            leads: daily.leads,
            analises: daily.analises,
            aprovados: daily.aprovados,
            vendas: daily.vendas,
          }}
          pipeline={pipelineQuery.data ?? { leads: 0, analises: 0, aprovados: 0, vendas: 0 }}
        />
      </div>
    </>
  );
}
