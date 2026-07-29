import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Target, AlertTriangle, TrendingUp, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { addDays, endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { listPeople } from "@/integrations/supabase/newSchema";


type TeamRow = { id: string; name: string; display_name: string | null; manager_id: string | null; director_id: string | null };
type BrokerRow = { id: string; name: string; manager_id: string | null; director_id: string | null; user_id: string | null };
type EntryRow = {
  report_id: string; leads: number; ligacoes: number; coleta_docs: number;
  analises: number; aprovados: number; vendas: number;
};
type ReportRow = { id: string; team_id: string; report_date: string };
type Targets = { analise_enviada_pct: number; aprovada_pct: number; venda_pct: number };

const DEFAULT_TARGETS: Targets = { analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 };

export default function Checkpoint() {
  const { role, user } = useAuth();
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [brokers, setBrokers] = useState<BrokerRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [targetsMap, setTargetsMap] = useState<Record<string, Targets>>({});
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    const [t, b, tg] = await Promise.all([
      (supabase as any).from("teams").select("id,name,manager_id,director_id").eq("active", true),
      listPeople(),
      (supabase as any).from("funnel_targets").select("scope,team_id,lead_to_analysis_pct,analysis_to_approval_pct,approval_to_sale_pct").order("effective_from", { ascending: false }),
    ]);
    setTeams(((t.data as any[]) || []).map(team => ({ ...team, display_name: team.name })));
    setBrokers((b as any[]).filter(person => person.active));
    const tmap: Record<string, Targets> = {};
    (tg.data || []).forEach((r: any) => {
      const key = r.scope === "global" ? "__global__" : r.team_id;
      if (!key || tmap[key]) return;
      tmap[key] = {
        analise_enviada_pct: Number(r.lead_to_analysis_pct),
        aprovada_pct: Number(r.analysis_to_approval_pct),
        venda_pct: Number(r.approval_to_sale_pct),
      };
    });
    setTargetsMap(tmap);

    const from = format(weekStart, "yyyy-MM-dd");
    const to = format(weekEnd, "yyyy-MM-dd");
    const { data: rep } = await supabase
      .from("daily_reports" as any)
      .select("id,team_id,report_date")
      .gte("report_date", from)
      .lte("report_date", to);
    setReports((rep as any) || []);
    const ids = (rep || []).map((r: any) => r.id);
    if (ids.length) {
      const { data: ent } = await supabase
        .from("daily_entries" as any)
        .select("report_id,leads,calls,doc_collections,analyses_sent,analyses_approved,sales")
        .in("report_id", ids);
      setEntries(((ent as any[]) || []).map(entry => ({
        report_id: entry.report_id,
        leads: entry.leads,
        ligacoes: entry.calls,
        coleta_docs: entry.doc_collections,
        analises: entry.analyses_sent,
        aprovados: entry.analyses_approved,
        vendas: entry.sales,
      })));
    } else {
      setEntries([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [weekStart.getTime()]);

  const myBroker = useMemo(() => brokers.find(b => b.user_id === user?.id) || null, [brokers, user]);

  const visibleTeams = useMemo(() => {
    if (role === "admin") return teams;
    if (role === "director" && myBroker) {
      return teams.filter(t => t.director_id === myBroker.id);
    }
    if (role === "manager" && myBroker) return teams.filter(t => t.manager_id === myBroker.id);
    return [];
  }, [role, teams, brokers, myBroker]);

  const filteredTeams = teamFilter === "all" ? visibleTeams : visibleTeams.filter(t => t.id === teamFilter);

  const teamNameFor = (t: TeamRow) => t.display_name?.trim() || t.name || "Equipe";

  const targetsFor = (teamId: string): Targets => targetsMap[teamId] ?? targetsMap["__global__"] ?? DEFAULT_TARGETS;

  const aggregate = (teamId: string) => {
    const rIds = new Set(reports.filter(r => r.team_id === teamId).map(r => r.id));
    const acc = { leads: 0, ligacoes: 0, coleta_docs: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
    entries.forEach(e => {
      if (!rIds.has(e.report_id)) return;
      acc.leads += e.leads || 0;
      acc.ligacoes += e.ligacoes || 0;
      acc.coleta_docs += e.coleta_docs || 0;
      acc.enviadas += e.analises || 0;
      acc.aprovadas += e.aprovados || 0;
      acc.vendas += e.vendas || 0;
    });
    return acc;
  };

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold">Checkpoint Semanal</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="px-3 py-1 rounded-md border border-primary/30 bg-primary/5 text-xs">
            {format(weekStart, "dd MMM", { locale: ptBR })} — {format(weekEnd, "dd MMM yyyy", { locale: ptBR })}
          </div>
          <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-56 h-8 text-xs"><SelectValue placeholder="Filtrar equipe" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as equipes</SelectItem>
              {visibleTeams.map(t => <SelectItem key={t.id} value={t.id}>{teamNameFor(t)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </header>

      {loading ? (
        <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…</div>
      ) : filteredTeams.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma equipe visível para você.</Card>
      ) : (
        <>
          {role === "manager" ? (
            <div className="grid grid-cols-1 gap-4">
              {filteredTeams.map(t => <TeamCheckpointCard key={t.id} team={t} aggr={aggregate(t.id)} targets={targetsFor(t.id)} name={teamNameFor(t)} />)}
            </div>
          ) : (
            <DirectorFunnelSection
              role={role}
              myBroker={myBroker}
              brokers={brokers}
              teams={visibleTeams}
              aggregate={aggregate}
              targetsFor={targetsFor}
              teamNameFor={teamNameFor}
            />
          )}


        </>
      )}
    </div>
  );
}


export function TeamCheckpointCard({ team, aggr, targets, name }: {
  team: TeamRow;
  aggr: { leads: number; ligacoes: number; coleta_docs: number; enviadas: number; aprovadas: number; vendas: number };
  targets: Targets;
  name: string;
}) {
  const pctEnviadas = aggr.leads ? (aggr.enviadas / aggr.leads) * 100 : 0;
  const pctAprovadas = aggr.enviadas ? (aggr.aprovadas / aggr.enviadas) * 100 : 0;
  const pctVendas = aggr.aprovadas ? (aggr.vendas / aggr.aprovadas) * 100 : 0;

  const stages = [
    { label: "Leads", value: aggr.leads, pct: 100, target: 100 },
    { label: "Análise Enviada", value: aggr.enviadas, pct: pctEnviadas, target: targets.analise_enviada_pct },
    { label: "Análise Aprovada", value: aggr.aprovadas, pct: pctAprovadas, target: targets.aprovada_pct },
    { label: "Venda", value: aggr.vendas, pct: pctVendas, target: targets.venda_pct },
  ];

  const belowStages = stages.slice(1).filter(s => s.pct < s.target);
  const anyBelow = belowStages.length > 0;
  const worst = belowStages.sort((a, b) => (a.pct - a.target) - (b.pct - b.target))[0];

  return (
    <Card className="border-primary/20 bg-card/60 backdrop-blur-xl">
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-primary" /> {name}
        </CardTitle>
        {anyBelow ? (
          <Badge variant="outline" className="border-rose-500/50 text-rose-400 text-[9px] py-0 h-5">
            <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Gargalo: {worst.label}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 text-[9px] py-0 h-5">No ritmo</Badge>
        )}
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 space-y-2">
        <div className="grid grid-cols-4 gap-1.5">
          {stages.map((s, i) => {
            const below = i > 0 && s.pct < s.target;
            const ok = i === 0 || s.pct >= s.target;
            const accent = below ? "rose" : "emerald";
            return (
              <div key={s.label} className={cn(
                "px-2 py-1.5 rounded-md border bg-secondary/20 flex flex-col gap-0.5",
                below ? "border-rose-500/50 bg-rose-500/5" : "border-emerald-500/30",
              )}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-[9px] uppercase text-muted-foreground truncate">{s.label}</span>
                  {i > 0 && <span className="text-[8px] text-muted-foreground shrink-0">m{s.target}%</span>}
                </div>
                <div className="flex items-baseline justify-between gap-1">
                  <span className={cn("text-lg font-black leading-none", ok ? "text-emerald-400" : "text-rose-400")}>{s.value}</span>
                  <span className={cn("text-[10px] font-semibold", ok ? "text-emerald-400" : "text-rose-400")}>{s.pct.toFixed(0)}%</span>
                </div>
                <div className="h-0.5 rounded-full bg-border/50 overflow-hidden">
                  <div className={cn("h-full", below ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, s.pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="px-2 py-0.5 rounded border border-border/40 bg-secondary/20">
            <span className="text-muted-foreground uppercase mr-1">Ligações</span>
            <span className="font-bold text-sky-400">{aggr.ligacoes}</span>
          </span>
          <span className="px-2 py-0.5 rounded border border-border/40 bg-secondary/20">
            <span className="text-muted-foreground uppercase mr-1">Coleta docs</span>
            <span className="font-bold text-indigo-400">{aggr.coleta_docs}</span>
          </span>
          {anyBelow && (
            <span className="ml-auto text-rose-400">
              ⚠ {worst.label}: {worst.pct.toFixed(1)}% (faltam {(worst.target - worst.pct).toFixed(1)}pp para meta {worst.target}%)
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


// ============ Director-level funnel ============

type DirAggr = { leads: number; enviadas: number; aprovadas: number; vendas: number };

function DirectorFunnelSection({
  role, myBroker, brokers, teams, aggregate, targetsFor, teamNameFor,
}: {
  role: string | null;
  myBroker: BrokerRow | null;
  brokers: BrokerRow[];
  teams: TeamRow[];
  aggregate: (teamId: string) => { leads: number; ligacoes: number; coleta_docs: number; enviadas: number; aprovadas: number; vendas: number };
  targetsFor: (teamId: string) => Targets;
  teamNameFor: (t: TeamRow) => string;
}) {
  // Map manager broker id -> director broker id
  const mgrToDir = useMemo(() => {
    const m = new Map<string, string | null>();
    brokers.forEach(b => m.set(b.id, b.director_id));
    return m;
  }, [brokers]);

  // Group teams by director id
  const directorGroups = useMemo(() => {
    const groups = new Map<string, { director: BrokerRow | null; teams: TeamRow[] }>();
    teams.forEach(t => {
      const dirId = (t.manager_id && mgrToDir.get(t.manager_id)) || "__none__";
      if (!groups.has(dirId)) {
        const director = dirId === "__none__" ? null : brokers.find(b => b.id === dirId) || null;
        groups.set(dirId, { director, teams: [] });
      }
      groups.get(dirId)!.teams.push(t);
    });
    let arr = Array.from(groups.entries()).map(([id, g]) => ({ id, ...g }));
    // Directors only see themselves
    if (role === "director" && myBroker) arr = arr.filter(g => g.id === myBroker.id);
    // Managers don't need director-level view
    if (role === "manager") return [];
    return arr.sort((a, b) => (a.director?.name || "").localeCompare(b.director?.name || ""));
  }, [teams, brokers, mgrToDir, role, myBroker]);

  if (!directorGroups.length) return null;

  return (
    <div className="space-y-3">
      {directorGroups.map(g => {
        const acc: DirAggr = { leads: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
        g.teams.forEach(t => {
          const a = aggregate(t.id);
          acc.leads += a.leads; acc.enviadas += a.enviadas; acc.aprovadas += a.aprovadas; acc.vendas += a.vendas;
        });
        const target = g.teams[0] ? targetsFor(g.teams[0].id) : DEFAULT_TARGETS;
        return (
          <DirectorFunnelCard
            key={g.id}
            title={g.director?.name || "Sem diretor"}
            aggr={acc}
            targets={target}
            teams={g.teams}
            aggregate={aggregate}
            targetsFor={targetsFor}
            teamNameFor={teamNameFor}
          />
        );
      })}
    </div>
  );
}

export function DirectorFunnelCard({
  title, aggr, targets, teams, aggregate, targetsFor, teamNameFor,
}: {
  title: string;
  aggr: DirAggr;
  targets: Targets;
  teams: TeamRow[];
  aggregate: (teamId: string) => { leads: number; ligacoes: number; coleta_docs: number; enviadas: number; aprovadas: number; vendas: number };
  targetsFor: (teamId: string) => Targets;
  teamNameFor: (t: TeamRow) => string;
}) {
  const pEnv = aggr.leads ? (aggr.enviadas / aggr.leads) * 100 : 0;
  const pApr = aggr.enviadas ? (aggr.aprovadas / aggr.enviadas) * 100 : 0;
  const pVen = aggr.aprovadas ? (aggr.vendas / aggr.aprovadas) * 100 : 0;
  const rows = [
    { key: "leads",  label: "Leads",       value: aggr.leads,     pct: 100, target: 100 },
    { key: "env",    label: "Análises",    value: aggr.enviadas,  pct: pEnv, target: targets.analise_enviada_pct },
    { key: "apr",    label: "Aprovações",  value: aggr.aprovadas, pct: pApr, target: targets.aprovada_pct },
    { key: "ven",    label: "Vendas",      value: aggr.vendas,    pct: pVen, target: targets.venda_pct },
  ];
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-yellow-400/30 bg-gradient-to-br from-yellow-400/5 via-transparent to-primary/5">
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4 text-yellow-400" /> Diretor: {title}
        </CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1">
              <Users className="h-3 w-3" /> Ver gerentes ({teams.length})
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Gerentes de {title}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              {teams.map(t => (
                <TeamCheckpointCard key={t.id} team={t} aggr={aggregate(t.id)} targets={targetsFor(t.id)} name={teamNameFor(t)} />
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <div className="flex items-center gap-3">
          {/* 3D funnel (Topo/Meio/Fundo -> 4 tigelas) */}
          <svg viewBox="0 0 140 160" className="h-24 shrink-0" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id={`dir-funil-${title}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(217 85% 30%)" />
                <stop offset="50%" stopColor="hsl(217 91% 55%)" />
                <stop offset="100%" stopColor="hsl(217 85% 28%)" />
              </linearGradient>
            </defs>
            {[
              { y: 2,   top: 130, bot: 100, h: 22 },
              { y: 40,  top: 100, bot: 74,  h: 20 },
              { y: 76,  top: 74,  bot: 48,  h: 18 },
              { y: 110, top: 48,  bot: 26,  h: 16 },
            ].map((s, i) => {
              const cx = 70;
              const topRx = s.top / 2, botRx = s.bot / 2;
              const yTop = s.y, yBot = s.y + s.h;
              const ellipseRy = topRx * 0.18;
              const d = `M ${cx - topRx} ${yTop} L ${cx - botRx} ${yBot} A ${botRx} ${botRx * 0.22} 0 0 0 ${cx + botRx} ${yBot} L ${cx + topRx} ${yTop} A ${topRx} ${ellipseRy} 0 0 1 ${cx - topRx} ${yTop} Z`;
              return (
                <g key={i}>
                  <path d={d} fill={`url(#dir-funil-${title})`} stroke="hsl(217 60% 20%)" strokeWidth="0.5" />
                  <ellipse cx={cx} cy={yTop} rx={topRx} ry={ellipseRy} fill="hsl(217 85% 35%)" opacity="0.9" />
                </g>
              );
            })}
          </svg>

          {/* Stage vs target */}
          <div className="flex-1 grid grid-cols-4 gap-2">
            {rows.map((r, i) => {
              const below = i > 0 && r.pct < r.target;
              const above = i > 0 && r.pct >= r.target;
              return (
                <div key={r.key} className={cn(
                  "px-2 py-1.5 rounded-md border bg-secondary/20",
                  below ? "border-rose-500/50 bg-rose-500/5" : above ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/40",
                )}>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[9px] uppercase text-muted-foreground truncate">{r.label}</span>
                    {i > 0 && <span className="text-[8px] text-muted-foreground">m{r.target}%</span>}
                  </div>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={cn("text-lg font-black leading-none", below ? "text-rose-400" : above ? "text-emerald-400" : "text-foreground")}>{r.value}</span>
                    <span className={cn("text-[10px] font-semibold", below ? "text-rose-400" : above ? "text-emerald-400" : "text-muted-foreground")}>{r.pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-0.5 rounded-full bg-border/50 overflow-hidden mt-1">
                    <div className={cn("h-full", below ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, r.pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
