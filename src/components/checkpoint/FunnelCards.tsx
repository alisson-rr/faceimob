import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Target, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  belowTarget, directorTargetKey, funnelBaseLabel, teamBottleneck, teamStages,
  type Targets, type TeamAggr,
} from "./funnel";

export type TeamRow = {
  id: string; name: string; display_name: string | null;
  manager_id: string | null; director_id: string | null;
  /** Equipe desativada no meio da semana continua no quadro, marcada. */
  active: boolean;
};
export type BrokerRow = { id: string; name: string; manager_id: string | null; director_id: string | null; user_id: string | null };
export type { TeamAggr };
type DirAggr = { lancamentos: number; leads: number; enviadas: number; aprovadas: number; vendas: number };

export function TeamCheckpointCard({
  aggr, targets, name, inactive = false,
}: {
  aggr: TeamAggr; targets: Targets; name: string;
  /** Equipe desativada com lançamento na semana: some do quadro se não avisar. */
  inactive?: boolean;
}) {
  // `base` é o denominador de cada conversão; sem ele o estágio não é medível.
  // A lista sai de `teamStages`, a mesma que a exportação usa: uma segunda
  // conta do gargalo no CSV poderia apontar estágio diferente do da tela.
  const stages = teamStages(aggr, targets);
  const semBase = funnelBaseLabel(aggr);
  const worst = teamBottleneck(aggr, targets);

  return (
    <Card className="border-primary/20 bg-card/60 backdrop-blur-xl">
      <CardHeader className="py-2 px-3 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm flex min-w-0 items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 shrink-0 text-primary" /> <span className="truncate">{name}</span>
          {/* Sem esta marca, equipe desativada no meio da semana sumia do
              quadro junto com os lançamentos que ela já tinha feito. */}
          {inactive && (
            <Badge variant="outline" size="sm" className="shrink-0 border-warning/50 text-warning">
              desativada
            </Badge>
          )}
        </CardTitle>
        {worst ? (
          <Badge variant="outline" size="sm" className="border-destructive/50 text-destructive">
            <AlertTriangle className="h-2.5 w-2.5 mr-1" /> Gargalo: {worst.label}
          </Badge>
        ) : semBase ? (
          <Badge variant="outline" size="sm" className="text-muted-foreground">{semBase}</Badge>
        ) : (
          <Badge variant="outline" size="sm" className="border-success/50 text-success">No ritmo</Badge>
        )}
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 space-y-2">
        {/* A 375 px sobram ~301 px de largura útil: quatro colunas de valor em
            `text-lg` pedem mais que isso e empurram a página para o lado. */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {stages.map((s, i) => {
            const below = !semBase && belowTarget(s);
            const ok = !semBase && s.base > 0 && s.pct >= s.target;
            return (
              <div key={s.label} className={cn(
                "min-w-0 px-2 py-1.5 rounded-md border bg-secondary/20 flex flex-col gap-0.5",
                below ? "border-destructive/50 bg-destructive/5" : ok ? "border-success/30" : "border-border/40",
              )}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-eyebrow truncate">{s.label}</span>
                  {i > 0 && <span className="text-eyebrow shrink-0">m{s.target}%</span>}
                </div>
                <div className="flex items-baseline justify-between gap-1">
                  <span className={cn("text-lg font-black leading-none", ok ? "text-success" : below ? "text-destructive" : "text-foreground")}>{s.value}</span>
                  <span className={cn("text-xs font-semibold", ok ? "text-success" : below ? "text-destructive" : "text-muted-foreground")}>{s.pct.toFixed(0)}%</span>
                </div>
                <div className="h-0.5 rounded-full bg-border/50 overflow-hidden">
                  <div className={cn("h-full", below ? "bg-destructive" : ok ? "bg-success" : "bg-border")} style={{ width: `${semBase ? 0 : Math.min(100, s.pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded border border-border/40 bg-secondary/20">
            <span className="text-muted-foreground uppercase mr-1">Ligações</span>
            <span className="font-bold text-info">{aggr.ligacoes}</span>
          </span>
          <span className="px-2 py-0.5 rounded border border-border/40 bg-secondary/20">
            <span className="text-muted-foreground uppercase mr-1">Coleta docs</span>
            <span className="font-bold text-info">{aggr.coleta_docs}</span>
          </span>
          {/* Visitas ficam como chip, ao lado de Ligações e Coleta docs, e FORA
              do funil: o funil compara cada estágio com uma meta de conversão, e
              visita não tem meta em `funnel_targets`. Entrar como quinta coluna
              inventaria uma meta que ninguém cadastrou. */}
          <span className="px-2 py-0.5 rounded border border-border/40 bg-secondary/20">
            <span className="text-muted-foreground uppercase mr-1">Visitas agendadas</span>
            <span className="font-bold text-info">{aggr.visitas_agendadas}</span>
          </span>
          <span className="px-2 py-0.5 rounded border border-border/40 bg-secondary/20">
            <span className="text-muted-foreground uppercase mr-1">Visitas feitas</span>
            <span className="font-bold text-info">{aggr.visitas_feitas}</span>
          </span>
          {worst && (
            <span className="ml-auto text-destructive">
              ⚠ {worst.label}: {worst.pct.toFixed(1)}% (faltam {(worst.target - worst.pct).toFixed(1)}pp para meta {worst.target}%)
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}


// ============ Director-level funnel ============

export function DirectorFunnelSection({
  brokers, teams, aggregate, targetsFor, teamNameFor,
}: {
  brokers: BrokerRow[];
  teams: TeamRow[];
  aggregate: (teamId: string) => TeamAggr;
  targetsFor: (key: string) => Targets;
  teamNameFor: (t: TeamRow) => string;
}) {
  // Agrupa pela diretoria da própria equipe (`teams.director_id`) — o mesmo
  // campo que decide o que o diretor enxerga. A versão anterior ia pelo diretor
  // do gerente (via `team_members`), e gerente que não é membro de equipe
  // nenhuma jogava a equipe em "Sem diretor": para o diretor, a tela ficava em
  // branco, sem nem o estado vazio.
  const directorGroups = useMemo(() => {
    const groups = new Map<string, { director: BrokerRow | null; teams: TeamRow[] }>();
    teams.forEach(t => {
      const dirId = t.director_id || "__none__";
      if (!groups.has(dirId)) {
        groups.set(dirId, { director: brokers.find(b => b.id === dirId) || null, teams: [] });
      }
      groups.get(dirId)!.teams.push(t);
    });
    return Array.from(groups.entries())
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => (a.director?.name || "").localeCompare(b.director?.name || ""));
  }, [teams, brokers]);

  if (!directorGroups.length) return null;

  return (
    <div className="space-y-3">
      {directorGroups.map(g => {
        const acc: DirAggr = { lancamentos: 0, leads: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
        g.teams.forEach(t => {
          const a = aggregate(t.id);
          acc.lancamentos += a.lancamentos;
          acc.leads += a.leads; acc.enviadas += a.enviadas; acc.aprovadas += a.aprovadas; acc.vendas += a.vendas;
        });
        // A meta da diretoria, não a da primeira equipe do grupo: é o que a RPC
        // pública (`public_director_checkpoint`) já mostra para o mesmo diretor.
        const target = targetsFor(directorTargetKey(g.id));
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
  aggregate: (teamId: string) => TeamAggr;
  targetsFor: (key: string) => Targets;
  teamNameFor: (t: TeamRow) => string;
}) {
  const pEnv = aggr.leads ? (aggr.enviadas / aggr.leads) * 100 : 0;
  const pApr = aggr.enviadas ? (aggr.aprovadas / aggr.enviadas) * 100 : 0;
  const pVen = aggr.aprovadas ? (aggr.vendas / aggr.aprovadas) * 100 : 0;
  const rows = [
    { key: "leads",  label: "Leads",       value: aggr.leads,     base: aggr.leads,     pct: 100, target: 100 },
    { key: "env",    label: "Análises",    value: aggr.enviadas,  base: aggr.leads,     pct: pEnv, target: targets.analise_enviada_pct },
    { key: "apr",    label: "Aprovações",  value: aggr.aprovadas, base: aggr.enviadas,  pct: pApr, target: targets.aprovada_pct },
    { key: "ven",    label: "Vendas",      value: aggr.vendas,    base: aggr.aprovadas, pct: pVen, target: targets.venda_pct },
  ];
  const semBase = funnelBaseLabel(aggr);
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-warning/30 bg-gradient-to-br from-warning/5 via-transparent to-primary/5">
      <CardHeader className="py-2 px-3 flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm flex min-w-0 items-center gap-2">
          <Target className="h-4 w-4 shrink-0 text-warning" /> <span className="truncate">Diretor: {title}</span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {semBase && <Badge variant="outline" size="sm" className="text-muted-foreground">{semBase}</Badge>}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                <Users className="h-3 w-3" /> Ver gerentes ({teams.length})
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Gerentes de {title}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                {teams.map(t => (
                  <TeamCheckpointCard
                    key={t.id}
                    aggr={aggregate(t.id)}
                    targets={targetsFor(t.id)}
                    name={teamNameFor(t)}
                    inactive={!t.active}
                  />
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0">
        <div className="flex items-center gap-3">
          {/* 3D funnel (Topo/Meio/Fundo -> 4 tigelas). Decorativo: no celular ele
              consumia 84 dos ~301 px úteis e empurrava a grade para fora da tela. */}
          <svg viewBox="0 0 140 160" className="hidden h-24 shrink-0 sm:block" preserveAspectRatio="xMidYMid meet" aria-hidden>
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
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {rows.map((r, i) => {
              const below = !semBase && belowTarget(r);
              const above = !semBase && i > 0 && r.base > 0 && r.pct >= r.target;
              return (
                <div key={r.key} className={cn(
                  "min-w-0 px-2 py-1.5 rounded-md border bg-secondary/20",
                  below ? "border-destructive/50 bg-destructive/5" : above ? "border-success/40 bg-success/5" : "border-border/40",
                )}>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-eyebrow truncate">{r.label}</span>
                    {i > 0 && <span className="text-eyebrow shrink-0">m{r.target}%</span>}
                  </div>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={cn("text-lg font-black leading-none", below ? "text-destructive" : above ? "text-success" : "text-foreground")}>{r.value}</span>
                    <span className={cn("text-xs font-semibold", below ? "text-destructive" : above ? "text-success" : "text-muted-foreground")}>{r.pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-0.5 rounded-full bg-border/50 overflow-hidden mt-1">
                    <div className={cn("h-full", below ? "bg-destructive" : semBase ? "bg-border" : "bg-success")} style={{ width: `${semBase ? 0 : Math.min(100, r.pct)}%` }} />
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
