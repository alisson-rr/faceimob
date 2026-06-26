import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { PipelineDeal } from "@/types/crm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { DollarSign, Share2, ThumbsUp, Star, Crown, ArrowUpRight, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from "recharts";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export default function Dashboard() {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [, setBrokers] = useState<{ id: string; name: string }[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data: dealsData } = await supabase.from('deals').select('*');
      const { data: brokersData } = await supabase.from('brokers').select('id, name');
      const mapped: PipelineDeal[] = (dealsData || []).map((d: any) => {
        let m = d.month_base;
        if (!m && d.created_at) m = format(parseISO(d.created_at), "MM/yyyy");
        return { ...d, broker1: d.broker_name || 'Sem Corretor', month_base: m } as unknown as PipelineDeal;
      });
      setDeals(mapped);
      setBrokers(brokersData || []);
    })();
  }, []);

  const availableMonths = useMemo(() => {
    const s = new Set<string>();
    deals.forEach(d => d.month_base && s.add(d.month_base));
    return Array.from(s).sort((a, b) => {
      const [ma, ya] = a.split("/").map(Number);
      const [mb, yb] = b.split("/").map(Number);
      return yb - ya || mb - ma;
    });
  }, [deals]);

  const filtered = useMemo(
    () => selectedMonth === "all" ? deals : deals.filter(d => d.month_base === selectedMonth),
    [deals, selectedMonth]
  );

  const stats = useMemo(() => {
    const vendas = filtered.filter(d => d.stage === 'closed' || d.stage === 'contract').length;
    const vgv = filtered.filter(d => d.active !== false).reduce((a, d) => a + (d.deal_value || 0), 0);
    const leads = filtered.filter(d => ['lead', 'incomplete'].includes(d.stage)).length;
    const propostas = filtered.filter(d => ['proposal', 'contract'].includes(d.stage)).length;
    const negocios = filtered.length;
    const meta = 80;
    const pct = Math.min(100, Math.round((vendas / meta) * 100));

    const year = new Date().getFullYear();
    const byMonth = Array.from({ length: 12 }, (_, i) => ({ name: MONTH_LABELS[i], vendas: 0, propostas: 0 }));
    deals.forEach(d => {
      if (!d.month_base) return;
      const [mm, yy] = d.month_base.split("/").map(Number);
      if (yy !== year) return;
      const idx = mm - 1;
      if (d.stage === 'closed' || d.stage === 'contract') byMonth[idx].vendas++;
      if (d.stage === 'proposal' || d.stage === 'contract') byMonth[idx].propostas++;
    });

    const area = byMonth.map(m => ({ name: m.name, valor: m.vendas * 250000 }));

    const bMap: Record<string, number> = {};
    filtered.forEach(d => {
      if (d.stage === 'closed' || d.stage === 'contract') {
        const n = d.broker1 || '—';
        bMap[n] = (bMap[n] || 0) + 1;
      }
    });
    const top = Object.entries(bMap).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([name, v]) => ({ name, v }));

    return { vendas, vgv, leads, propostas, negocios, meta, pct, byMonth, area, top };
  }, [filtered, deals]);

  const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

  const kpis = [
    { label: "VGV", value: brl(stats.vgv), icon: DollarSign, trend: "+12.4%", featured: true },
    { label: "Negócios", value: stats.negocios.toLocaleString('pt-BR'), icon: Share2, trend: "+8.1%" },
    { label: "Propostas", value: stats.propostas.toLocaleString('pt-BR'), icon: ThumbsUp, trend: "+5.6%" },
    { label: "Vendas", value: stats.vendas.toLocaleString('pt-BR'), icon: Star, trend: `${stats.pct}%` },
  ];

  const donutData = [
    { name: 'Atingido', value: stats.pct },
    { name: 'Restante', value: 100 - stats.pct },
  ];
  const DONUT_COLORS = ['hsl(36 95% 58%)', 'hsl(220 10% 22%)'];

  const topBroker = stats.top[0];

  return (
    <div className="min-h-screen font-sans-premium bg-background gradient-premium">
      <div className="max-w-[1600px] mx-auto p-4 md:p-8 grid grid-cols-12 gap-6">
        {/* PROFILE / SIDE */}
        <aside className="col-span-12 lg:col-span-3 animate-fade-in">
          <div className="relative overflow-hidden rounded-3xl p-8 text-white shadow-premium-lg"
               style={{ background: "linear-gradient(160deg, hsl(220 40% 18%) 0%, hsl(220 50% 10%) 100%)" }}>
            <div className="absolute -top-20 -right-20 w-56 h-56 rounded-full bg-amber-400/10 blur-3xl" />
            <div className="absolute -bottom-24 -left-10 w-48 h-48 rounded-full bg-blue-500/10 blur-3xl" />

            <div className="relative flex flex-col items-center text-center">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-amber-300 to-amber-500 p-[2px] mb-4">
                <div className="w-full h-full rounded-full bg-[hsl(220_50%_10%)] flex items-center justify-center">
                  <Crown className="h-9 w-9 text-amber-300" />
                </div>
              </div>
              <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 mb-1">Top Performer</p>
              <h2 className="font-display text-2xl text-balance">{topBroker?.name || "Faceimob"}</h2>
              <p className="text-xs text-white/50 mt-1">{topBroker?.v ?? 0} vendas no período</p>
            </div>

            <nav className="relative mt-8 space-y-1">
              {[
                { l: "Dashboard", href: "/dashboard", active: true },
                { l: "Pipeline", href: "/pipeline" },
                { l: "CCA", href: "/cca" },
                { l: "Equipes", href: "/team" },
                { l: "Marketing", href: "/marketing" },
                { l: "Gamificação", href: "/gamification" },
              ].map(i => (
                <a key={i.href} href={i.href}
                   className={cn(
                     "group flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all duration-300 ease-premium",
                     i.active ? "bg-white/10 text-white" : "text-white/60 hover:text-white hover:bg-white/5 hover:translate-x-1"
                   )}>
                  <span>{i.l}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* MAIN */}
        <main className="col-span-12 lg:col-span-9 space-y-6">
          {/* HEADER */}
          <header className="flex items-end justify-between animate-fade-in">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground mb-1">Visão Geral</p>
              <h1 className="font-display text-5xl md:text-6xl text-foreground leading-none">Dashboard</h1>
            </div>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[200px] h-11 rounded-full border-border/60 bg-card/60 backdrop-blur-xl shadow-sm">
                <SelectValue placeholder="Selecionar período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {availableMonths.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </header>

          {/* KPI ROW */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {kpis.map((k, i) => (
              <Card key={i}
                    className={cn(
                      "group relative overflow-hidden p-6 rounded-3xl border-0 transition-all duration-500 ease-premium hover:-translate-y-1 animate-fade-in opacity-0",
                      ["stagger-1","stagger-2","stagger-3","stagger-4"][i],
                      k.featured
                        ? "text-white shadow-premium-lg"
                        : "bg-card/80 backdrop-blur-xl shadow-premium hover:shadow-premium-lg"
                    )}
                    style={k.featured ? { animationFillMode: 'forwards', background: "linear-gradient(135deg, hsl(220 50% 12%), hsl(220 45% 18%))" } : { animationFillMode: 'forwards' }}>
                {k.featured && (
                  <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-amber-400/20 blur-2xl" />
                )}
                <div className="relative flex items-start justify-between mb-6">
                  <span className={cn("text-xs uppercase tracking-[0.2em] font-medium", k.featured ? "text-white/60" : "text-muted-foreground")}>{k.label}</span>
                  <div className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 ease-premium",
                    k.featured ? "bg-amber-400 text-[hsl(220_50%_12%)]" : "bg-primary/10 text-primary"
                  )}>
                    <k.icon className="h-4 w-4" />
                  </div>
                </div>
                <div className={cn("font-display text-4xl leading-none mb-3", k.featured ? "text-white" : "text-foreground")}>{k.value}</div>
                <div className={cn("flex items-center gap-1.5 text-xs font-medium", k.featured ? "text-amber-300" : "text-success")}>
                  <TrendingUp className="h-3 w-3" />
                  {k.trend}
                </div>
              </Card>
            ))}
          </div>

          {/* CHART + DONUT */}
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-12 lg:col-span-8 p-6 rounded-3xl border-0 bg-card/80 backdrop-blur-xl shadow-premium animate-fade-in stagger-5 opacity-0" style={{ animationFillMode: 'forwards' }}>
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-display text-2xl text-foreground">Resultado mensal</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Propostas vs Vendas — {new Date().getFullYear()}</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: 'hsl(220 50% 30%)' }} /> Propostas</span>
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /> Vendas</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.byMonth} barGap={4}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted) / .3)' }} />
                  <Bar dataKey="propostas" fill="hsl(220 50% 30%)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="vendas" fill="hsl(36 95% 58%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="col-span-12 lg:col-span-4 p-6 rounded-3xl border-0 bg-card/80 backdrop-blur-xl shadow-premium animate-fade-in stagger-6 opacity-0" style={{ animationFillMode: 'forwards' }}>
              <h3 className="font-display text-2xl text-foreground mb-1">Meta</h3>
              <p className="text-xs text-muted-foreground mb-2">Progresso do período</p>
              <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={donutData} innerRadius={62} outerRadius={82} dataKey="value" startAngle={90} endAngle={-270} stroke="none">
                      {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="font-display text-4xl text-foreground leading-none">{stats.pct}%</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">atingido</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                {[{l:"Vendas",v:stats.vendas},{l:"Leads",v:stats.leads},{l:"Prop.",v:stats.propostas}].map((s,i)=>(
                  <div key={i} className="rounded-xl bg-muted/40 py-2">
                    <div className="text-sm font-semibold text-foreground">{s.v}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* AREA + CALENDAR */}
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-12 lg:col-span-8 p-6 rounded-3xl border-0 bg-card/80 backdrop-blur-xl shadow-premium animate-fade-in opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '420ms' }}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display text-2xl text-foreground">Evolução de VGV</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Tendência ao longo do ano</p>
                </div>
                <Button variant="ghost" size="sm" className="rounded-full text-xs h-8 text-muted-foreground hover:text-foreground">
                  Ver detalhes <ArrowUpRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={stats.area} margin={{ left: -10 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(36 95% 58%)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(36 95% 58%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/1000000).toFixed(1)}M`} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} formatter={(v: number) => brl(v)} />
                  <Area type="monotone" dataKey="valor" stroke="hsl(36 95% 58%)" strokeWidth={2.5} fill="url(#g1)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card className="col-span-12 lg:col-span-4 p-4 rounded-3xl border-0 bg-card/80 backdrop-blur-xl shadow-premium flex items-center justify-center animate-fade-in opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '480ms' }}>
              <Calendar mode="single" className="rounded-2xl" />
            </Card>
          </div>

          {/* TOP RANKING */}
          <Card className="p-6 rounded-3xl border-0 bg-card/80 backdrop-blur-xl shadow-premium animate-fade-in opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '540ms' }}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display text-2xl text-foreground">Top Corretores</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Classificação por vendas no período</p>
              </div>
            </div>
            <div className="space-y-3">
              {stats.top.length === 0 && <p className="text-sm text-muted-foreground">Sem vendas no período.</p>}
              {stats.top.map((t, i) => (
                <div key={i} className="group flex items-center gap-4 p-3 rounded-2xl transition-all duration-300 ease-premium hover:bg-muted/40">
                  <div className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center font-display text-sm",
                    i === 0 ? "bg-gradient-to-br from-amber-300 to-amber-500 text-[hsl(220_50%_12%)]" :
                    i === 1 ? "bg-muted text-foreground" :
                    "bg-muted/50 text-muted-foreground"
                  )}>{i + 1}</div>
                  <span className="flex-1 text-sm text-foreground font-medium">{t.name}</span>
                  <div className="flex-1 max-w-[280px] h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700 ease-premium"
                         style={{ width: `${(t.v / stats.top[0].v) * 100}%`, background: 'linear-gradient(90deg, hsl(36 95% 58%), hsl(20 90% 55%))' }} />
                  </div>
                  <span className="text-sm font-semibold text-foreground w-12 text-right tabular-nums">{t.v}</span>
                </div>
              ))}
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}
