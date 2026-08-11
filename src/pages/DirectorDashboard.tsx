import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ComparativeFunnel, { type FunnelStep } from "@/components/ComparativeFunnel";
import { Users, FileText, ClipboardCheck, CheckCircle2, DollarSign, type LucideIcon } from "lucide-react";
import { listLegacyDeals, listLegacyLeads, listPeople } from "@/integrations/supabase/newSchema";

const monthBaseNow = () => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function DirectorDashboard() {
  const { user, profile } = useAuth();
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const directorInfo = user?.id
    ? { id: user.id, name: profile?.name || "Diretor" }
    : null;

  // Managers under this director + their brokers
  const scopeQuery = useQuery({
    enabled: !!directorInfo?.id,
    queryKey: ["director-scope", directorInfo?.id],
    queryFn: async () => {
      const [people, teamsRes] = await Promise.all([
        listPeople(),
        supabase.from("teams").select("id,name,manager_id,director_id").eq("director_id", directorInfo!.id).eq("active", true),
      ]);
      // Erro engolido aqui virava painel com KPIs = 0; lançar deixa o
      // useQuery expor isError em vez de fingir dado vazio.
      if (teamsRes.error) throw teamsRes.error;
      const teams = teamsRes.data ?? [];
      const teamIds = new Set(teams.map(team => team.id));
      return {
        managers: people.filter(person => person.roles.includes("manager") && person.director_id === directorInfo!.id),
        brokers: people.filter(person => person.roles.includes("broker") && !!person.team_id && teamIds.has(person.team_id)),
        teams,
      };
    },
  });
  const scope = scopeQuery.data;

  const brokerIds = useMemo(() => {
    if (!scope) return [];
    if (teamFilter === "all") return scope.brokers.map((b) => b.id);
    const team = scope.teams.find((t) => t.id === teamFilter);
    if (!team) return [];
    return scope.brokers.filter((b) => b.manager_id === team.manager_id).map((b) => b.id);
  }, [scope, teamFilter]);

  // Daily entries (mês corrente)
  const dailyQuery = useQuery({
    enabled: brokerIds.length > 0,
    queryKey: ["director-daily", brokerIds, teamFilter],
    queryFn: async () => {
      const from = startOfMonth();
      const { data: reports, error: repError } = await supabase
        .from("daily_reports")
        .select("id, team_id, report_date")
        .gte("report_date", from);
      if (repError) throw repError;
      const teamIds = teamFilter === "all" ? scope!.teams.map((t) => t.id) : [teamFilter];
      const reportIds = (reports ?? []).filter((r) => teamIds.includes(r.team_id!)).map((r) => r.id);
      if (!reportIds.length) return { leads: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 };
      const { data: entries, error: entError } = await supabase
        .from("daily_entries")
        .select("leads,doc_collections,analyses_sent,analyses_approved,sales")
        .in("report_id", reportIds);
      if (entError) throw entError;
      return (entries ?? []).reduce(
        (acc, e) => ({
          leads: acc.leads + (e.leads || 0),
          coleta_docs: acc.coleta_docs + (e.doc_collections || 0),
          analises: acc.analises + (e.analyses_sent || 0),
          aprovados: acc.aprovados + (e.analyses_approved || 0),
          vendas: acc.vendas + (e.sales || 0),
        }),
        { leads: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 }
      );
    },
  });
  const dailyAgg = dailyQuery.data;

  // Pipeline aggregates
  const pipeQuery = useQuery({
    enabled: brokerIds.length > 0,
    queryKey: ["director-pipe", brokerIds],
    queryFn: async () => {
      const [allDeals, allLeads] = await Promise.all([listLegacyDeals(), listLegacyLeads()]);
      const rows = allDeals.filter(deal => brokerIds.includes(deal.broker1_id || "") && deal.month_base === monthBaseNow());
      const leads = allLeads.filter((lead) => brokerIds.includes(lead.broker_id) && lead.created_at >= startOfMonth());
      const analises = rows.filter((deal) => ["under_analysis", "analysis"].includes(deal.stage)).length;
      const aprovados = rows.filter((deal) => ["approved", "contract"].includes(deal.stage)).length;
      const vendas = rows.filter((deal) => deal.outcome === "won").length;
      return {
        leads: (leads ?? []).length,
        analises,
        aprovados,
        vendas,
      };
    },
  });
  const pipeAgg = pipeQuery.data;

  const isLoading = scopeQuery.isLoading || dailyQuery.isLoading || pipeQuery.isLoading;
  const queryError = scopeQuery.error || dailyQuery.error || pipeQuery.error;
  const retry = () => {
    if (scopeQuery.error) void scopeQuery.refetch();
    if (dailyQuery.error) void dailyQuery.refetch();
    if (pipeQuery.error) void pipeQuery.refetch();
  };

  const daily: FunnelStep[] = [
    { key: "leads",     label: "Leads",      value: dailyAgg?.leads ?? 0,     targetPct: 100 },
    { key: "analises",  label: "Análises",   value: dailyAgg?.analises ?? 0,  targetPct: 10 },
    { key: "aprovados", label: "Aprovações", value: dailyAgg?.aprovados ?? 0, targetPct: 40 },
    { key: "vendas",    label: "Vendas",     value: dailyAgg?.vendas ?? 0,    targetPct: 50 },
  ];

  const pipeline: FunnelStep[] = [
    { key: "leads",     label: "Leads",      value: pipeAgg?.leads ?? 0,     targetPct: 100 },
    { key: "analises",  label: "Análises",   value: pipeAgg?.analises ?? 0,  targetPct: 10 },
    { key: "aprovados", label: "Aprovações", value: pipeAgg?.aprovados ?? 0, targetPct: 40 },
    { key: "vendas",    label: "Vendas",     value: pipeAgg?.vendas ?? 0,    targetPct: 50 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Painel do Diretor</h1>
          <p className="text-[11px] text-muted-foreground">
            {directorInfo?.name || profile?.name || "—"} · {monthBaseNow()}
          </p>
        </div>
        <Select value={teamFilter} onValueChange={setTeamFilter}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Filtrar equipe" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as equipes</SelectItem>
            {(scope?.teams ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {queryError && (
        <Card className="border-destructive/40">
          <CardContent className="px-3 py-2 text-xs flex items-center justify-between gap-2">
            <span>Não foi possível carregar os dados: {queryError.message}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={retry}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}
      {isLoading && !queryError && (
        <p className="text-xs text-muted-foreground">Carregando dados do painel…</p>
      )}

      {/* KPIs compactos */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Kpi icon={Users}          label="Leads"       value={dailyAgg?.leads ?? 0} tone="text-blue-300" />
        <Kpi icon={FileText}       label="Docs"        value={dailyAgg?.coleta_docs ?? 0} tone="text-cyan-300" />
        <Kpi icon={ClipboardCheck} label="Análises"    value={dailyAgg?.analises ?? 0} tone="text-purple-300" />
        <Kpi icon={CheckCircle2}   label="Aprovações"  value={dailyAgg?.aprovados ?? 0} tone="text-amber-300" />
        <Kpi icon={DollarSign}     label="Vendas"      value={dailyAgg?.vendas ?? 0} tone="text-emerald-300" />
      </div>

      <ComparativeFunnel daily={daily} pipeline={pipeline} />

      <p className="text-[10px] text-muted-foreground text-center pt-1">
        Metas: Leads → Análises 10% · Análises → Aprovação 40% · Aprovação → Venda 50%
      </p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: number; tone: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="px-3 py-2 flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <div>
          <p className="text-[10px] uppercase text-muted-foreground leading-none">{label}</p>
          <p className={`text-lg font-bold leading-tight ${tone}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
