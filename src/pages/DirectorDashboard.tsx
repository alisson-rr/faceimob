import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ComparativeFunnel, { type FunnelStep } from "@/components/ComparativeFunnel";
import { Users, FileText, ClipboardCheck, CheckCircle2, DollarSign } from "lucide-react";

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

  // Identify the director broker row (falls back to first director if none matches — helpful in demo)
  const { data: directorInfo } = useQuery({
    queryKey: ["director-info", user?.id],
    queryFn: async () => {
      let broker: any = null;
      if (user?.id) {
        const { data } = await supabase.from("brokers").select("id, name").eq("user_id", user.id).maybeSingle();
        broker = data;
      }
      if (!broker) {
        const { data } = await supabase.from("brokers").select("id, name").eq("role", "director").limit(1).maybeSingle();
        broker = data;
      }
      return broker as { id: string; name: string } | null;
    },
  });

  // Managers under this director + their brokers
  const { data: scope } = useQuery({
    enabled: !!directorInfo?.id,
    queryKey: ["director-scope", directorInfo?.id],
    queryFn: async () => {
      const dirId = directorInfo!.id;
      const { data: managers } = await supabase.from("brokers").select("id, name").eq("director_id", dirId);
      const managerIds = (managers ?? []).map((m) => m.id);
      const { data: brokers } = await supabase.from("brokers").select("id, name, manager_id").in("manager_id", managerIds.length ? managerIds : ["00000000-0000-0000-0000-000000000000"]);
      const { data: teams } = await supabase.from("teams").select("id, name, manager_id").in("manager_id", managerIds.length ? managerIds : ["00000000-0000-0000-0000-000000000000"]);
      return { managers: managers ?? [], brokers: brokers ?? [], teams: teams ?? [] };
    },
  });

  const brokerIds = useMemo(() => {
    if (!scope) return [];
    if (teamFilter === "all") return scope.brokers.map((b) => b.id);
    const team = scope.teams.find((t) => t.id === teamFilter);
    if (!team) return [];
    return scope.brokers.filter((b) => b.manager_id === team.manager_id).map((b) => b.id);
  }, [scope, teamFilter]);

  // Daily entries (mês corrente)
  const { data: dailyAgg } = useQuery({
    enabled: brokerIds.length > 0,
    queryKey: ["director-daily", brokerIds, teamFilter],
    queryFn: async () => {
      const from = startOfMonth();
      const { data: reports } = await supabase
        .from("daily_team_reports")
        .select("id, team_id, report_date")
        .gte("report_date", from);
      const teamIds = teamFilter === "all" ? scope!.teams.map((t) => t.id) : [teamFilter];
      const reportIds = (reports ?? []).filter((r) => teamIds.includes(r.team_id!)).map((r) => r.id);
      if (!reportIds.length) return { leads: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 };
      const { data: entries } = await supabase
        .from("daily_broker_entries")
        .select("leads, coleta_docs, analises, aprovados, vendas")
        .in("report_id", reportIds);
      return (entries ?? []).reduce(
        (acc, e: any) => ({
          leads: acc.leads + (e.leads || 0),
          coleta_docs: acc.coleta_docs + (e.coleta_docs || 0),
          analises: acc.analises + (e.analises || 0),
          aprovados: acc.aprovados + (e.aprovados || 0),
          vendas: acc.vendas + (e.vendas || 0),
        }),
        { leads: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 }
      );
    },
  });

  // Pipeline aggregates
  const { data: pipeAgg } = useQuery({
    enabled: brokerIds.length > 0,
    queryKey: ["director-pipe", brokerIds],
    queryFn: async () => {
      const mb = monthBaseNow();
      const { data: deals } = await supabase
        .from("deals")
        .select("id, stage, status, broker1_id, month_base")
        .in("broker1_id", brokerIds)
        .eq("month_base", mb);
      const { data: leads } = await supabase
        .from("leads")
        .select("id, broker_id, created_at")
        .in("broker_id", brokerIds.map(String))
        .gte("created_at", startOfMonth());
      const rows = deals ?? [];
      const analises = rows.filter((d: any) => d.stage === "under_analysis").length;
      const aprovados = rows.filter((d: any) => d.stage === "approved" || d.stage === "contract").length;
      const vendas = rows.filter((d: any) => d.stage === "closed" || String(d.status).toUpperCase() === "VENDA").length;
      return {
        leads: (leads ?? []).length,
        analises,
        aprovados,
        vendas,
      };
    },
  });

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

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
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
