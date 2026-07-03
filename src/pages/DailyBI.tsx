import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Swords, Trophy, Target, Flame, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { startOfWeek, endOfWeek, format, addWeeks, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

const FIELDS = ["leads", "atendimentos", "propostas", "visitas_agendadas", "visitas_realizadas", "analises", "aprovados", "vendas"] as const;
type FieldKey = typeof FIELDS[number];

const IDEAL = { leads: 100, analises: 10, aprovados: 4, vendas: 2 };

export default function DailyBI() {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  const startStr = format(weekStart, "yyyy-MM-dd");
  const endStr = format(weekEnd, "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["daily-bi", startStr, endStr],
    queryFn: async () => {
      const { data: reports } = await supabase
        .from("daily_team_reports")
        .select("id, team_id, report_date, filled_by_name, notes, teams:team_id(name)")
        .gte("report_date", startStr).lte("report_date", endStr);

      const reportIds = (reports ?? []).map((r) => r.id);
      const { data: entries } = reportIds.length
        ? await supabase.from("daily_broker_entries").select("*").in("report_id", reportIds)
        : { data: [] as any[] };

      return { reports: reports ?? [], entries: entries ?? [] };
    },
  });

  const totals = useMemo(() => {
    const t: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f]: 0 }), {} as any);
    (data?.entries ?? []).forEach((e: any) => FIELDS.forEach((f) => { t[f] += e[f] || 0; }));
    return t;
  }, [data]);

  const idealComparison = useMemo(() => {
    const baseLeads = totals.leads || 0;
    const stages = [
      { key: "leads", label: "Leads", real: totals.leads, ideal: baseLeads, pct: 100, idealPct: 100 },
      { key: "analises", label: "Análises", real: totals.analises, ideal: Math.round(baseLeads * 0.10), pct: baseLeads ? (totals.analises / baseLeads) * 100 : 0, idealPct: 10 },
      { key: "aprovados", label: "Aprovados", real: totals.aprovados, ideal: Math.round(baseLeads * 0.04), pct: baseLeads ? (totals.aprovados / baseLeads) * 100 : 0, idealPct: 4 },
      { key: "vendas", label: "Vendas", real: totals.vendas, ideal: Math.round(baseLeads * 0.02), pct: baseLeads ? (totals.vendas / baseLeads) * 100 : 0, idealPct: 2 },
    ];
    return stages.map((s) => {
      const ratio = s.idealPct ? s.pct / s.idealPct : 0;
      const status = ratio >= 1 ? "acima" : ratio >= 0.8 ? "alvo" : "abaixo";
      return { ...s, ratio, status };
    });
  }, [totals]);

  const teamRanking = useMemo(() => {
    const byTeam = new Map<string, { name: string; vendas: number; leads: number; aprovados: number; analises: number }>();
    const reportTeam = new Map<string, { id: string; name: string }>();
    (data?.reports ?? []).forEach((r: any) => reportTeam.set(r.id, { id: r.team_id, name: r.teams?.name || "—" }));
    (data?.entries ?? []).forEach((e: any) => {
      const t = reportTeam.get(e.report_id); if (!t) return;
      const cur = byTeam.get(t.id) ?? { name: t.name, vendas: 0, leads: 0, aprovados: 0, analises: 0 };
      cur.vendas += e.vendas || 0; cur.leads += e.leads || 0;
      cur.aprovados += e.aprovados || 0; cur.analises += e.analises || 0;
      byTeam.set(t.id, cur);
    });
    return Array.from(byTeam.values()).sort((a, b) => b.vendas - a.vendas);
  }, [data]);

  const brokerRanking = useMemo(() => {
    const byBroker = new Map<string, { name: string; vendas: number; leads: number }>();
    (data?.entries ?? []).forEach((e: any) => {
      const key = e.broker_id || e.broker_name;
      const cur = byBroker.get(key) ?? { name: e.broker_name, vendas: 0, leads: 0 };
      cur.vendas += e.vendas || 0; cur.leads += e.leads || 0;
      byBroker.set(key, cur);
    });
    return Array.from(byBroker.values()).sort((a, b) => b.vendas - a.vendas).slice(0, 10);
  }, [data]);

  const exportCsv = () => {
    const rows = [["Data", "Equipe", "Corretor", ...FIELDS]];
    const reportMap = new Map<string, { date: string; team: string }>();
    (data?.reports ?? []).forEach((r: any) => reportMap.set(r.id, { date: r.report_date, team: r.teams?.name || "" }));
    (data?.entries ?? []).forEach((e: any) => {
      const r = reportMap.get(e.report_id);
      rows.push([r?.date || "", r?.team || "", e.broker_name, ...FIELDS.map((f) => String(e[f] || 0))]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `daily-bi-${startStr}.csv`; a.click();
  };

  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" /> Diário das Equipes — BI Semanal
          </h1>
          <p className="text-xs text-muted-foreground">
            Semana: <strong>{format(weekStart, "dd MMM", { locale: ptBR })} → {format(weekEnd, "dd MMM yyyy", { locale: ptBR })}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset((w) => w - 1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>Esta semana</Button>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset((w) => w + 1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-3 w-3 mr-1" /> CSV</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {FIELDS.map((f) => (
          <Card key={f} className="border-primary/20 bg-card/60 backdrop-blur">
            <CardContent className="p-3">
              <p className="text-[10px] uppercase text-muted-foreground truncate">{f.replace("_", " ")}</p>
              <p className="text-2xl font-black text-primary">{totals[f]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Ideal Funnel */}
      <Card className="border-primary/30 bg-gradient-to-br from-card via-card/80 to-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Target className="h-4 w-4 text-primary" /> Comparativo com o Funil Ideal (100 / 10 / 4 / 2)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {idealComparison.map((s) => {
            const color = s.status === "acima" ? "from-emerald-500 to-emerald-400" : s.status === "alvo" ? "from-amber-500 to-yellow-400" : "from-rose-600 to-rose-400";
            const badge = s.status === "acima" ? { label: "🔥 Acima do ideal", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" }
              : s.status === "alvo" ? { label: "🎯 No alvo", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" }
              : { label: "⚠️ Abaixo", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
            const realWidth = Math.min(100, s.pct);
            return (
              <div key={s.key} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">{s.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Ideal: {s.ideal} ({s.idealPct}%)</span>
                    <span className="font-bold">Real: {s.real} ({s.pct.toFixed(1)}%)</span>
                    <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>
                  </div>
                </div>
                <div className="relative h-6 rounded-lg bg-muted/30 overflow-hidden border border-border/30">
                  <div className="absolute inset-y-0 left-0 border-r-2 border-dashed border-primary/60" style={{ width: `${s.idealPct}%` }} />
                  <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color} shadow-[0_0_20px_currentColor] opacity-90`} style={{ width: `${realWidth}%` }} />
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold mix-blend-difference">
                    Aderência {(s.ratio * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Trophy className="h-4 w-4 text-yellow-400" /> Ranking de Equipes (por vendas)</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {teamRanking.length === 0 && <p className="text-xs text-muted-foreground">Sem dados na semana.</p>}
            {teamRanking.map((t, i) => (
              <div key={t.name} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 hover:bg-muted/40 transition">
                <span className={`w-6 text-center font-black ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-600" : "text-muted-foreground"}`}>#{i + 1}</span>
                <span className="text-xs flex-1 font-semibold">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.leads} leads</span>
                <Badge className="bg-primary/20 text-primary border-primary/40">{t.vendas} vendas</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-orange-400" /> Top 10 Corretores</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {brokerRanking.length === 0 && <p className="text-xs text-muted-foreground">Sem dados na semana.</p>}
            {brokerRanking.map((b, i) => (
              <div key={b.name} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20">
                <span className={`w-6 text-center font-black ${i < 3 ? "text-yellow-400" : "text-muted-foreground"}`}>#{i + 1}</span>
                <span className="text-xs flex-1 font-semibold">{b.name}</span>
                <span className="text-xs text-muted-foreground">{b.leads} leads</span>
                <Badge variant="outline">{b.vendas} vendas</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Daily detail */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Detalhamento diário (Seg → Dom)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-3">Data</th>
                <th className="text-left pr-3">Equipe</th>
                <th className="text-left pr-3">Preenchido por</th>
                {FIELDS.map((f) => <th key={f} className="text-right px-2">{f.slice(0, 4)}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => {
                const dstr = format(d, "yyyy-MM-dd");
                const dayReports = (data?.reports ?? []).filter((r: any) => r.report_date === dstr);
                if (dayReports.length === 0) return (
                  <tr key={dstr} className="border-b border-border/20 text-muted-foreground/60">
                    <td className="py-2 pr-3">{format(d, "EEE dd/MM", { locale: ptBR })}</td>
                    <td colSpan={2 + FIELDS.length} className="italic">— sem lançamento —</td>
                  </tr>
                );
                return dayReports.map((r: any) => {
                  const rowEntries = (data?.entries ?? []).filter((e: any) => e.report_id === r.id);
                  const rowTotals: any = FIELDS.reduce((a, f) => ({ ...a, [f]: 0 }), {});
                  rowEntries.forEach((e: any) => FIELDS.forEach((f) => { rowTotals[f] += e[f] || 0; }));
                  return (
                    <tr key={r.id} className="border-b border-border/20 hover:bg-muted/10">
                      <td className="py-2 pr-3">{format(d, "EEE dd/MM", { locale: ptBR })}</td>
                      <td className="pr-3 font-semibold">{r.teams?.name}</td>
                      <td className="pr-3 text-muted-foreground">{r.filled_by_name}</td>
                      {FIELDS.map((f) => <td key={f} className="text-right px-2">{rowTotals[f]}</td>)}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {isLoading && <p className="text-xs text-muted-foreground text-center">Carregando...</p>}
    </div>
  );
}
