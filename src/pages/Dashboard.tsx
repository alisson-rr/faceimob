import { useState, useMemo, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { PipelineDeal } from "@/types/crm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { DollarSign, Share2, ThumbsUp, Star, Crown } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";

const MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export default function Dashboard() {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [brokers, setBrokers] = useState<{ id: string; name: string }[]>([]);
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

    // monthly bars for current year
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

    // area: vgv evolution by month
    const area = byMonth.map(m => ({ name: m.name, valor: m.vendas * 250000 }));

    // top brokers
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
    { label: "VGV", value: brl(stats.vgv), icon: DollarSign, accent: true },
    { label: "Negócios", value: stats.negocios.toLocaleString('pt-BR'), icon: Share2 },
    { label: "Propostas", value: stats.propostas.toLocaleString('pt-BR'), icon: ThumbsUp },
    { label: "Vendas", value: stats.vendas.toLocaleString('pt-BR'), icon: Star },
  ];

  const donutData = [
    { name: 'Atingido', value: stats.pct },
    { name: 'Restante', value: 100 - stats.pct },
  ];
  const DONUT_COLORS = ['#f59e0b', '#1e293b'];

  const topBroker = stats.top[0];

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-[#020617] p-4 md:p-6">
      <div className="grid grid-cols-12 gap-4 max-w-[1600px] mx-auto">
        {/* SIDEBAR-LIKE PROFILE */}
        <aside className="col-span-12 md:col-span-3 bg-[#1e3a5f] text-white rounded-2xl p-6 flex flex-col items-center text-center">
          <div className="w-24 h-24 rounded-full bg-white/10 border-4 border-white/20 flex items-center justify-center mb-3">
            <Crown className="h-10 w-10 text-amber-300" />
          </div>
          <h2 className="text-lg font-bold">{topBroker?.name || "Faceimob"}</h2>
          <p className="text-xs text-white/60 mb-6">Top performer do período</p>

          <div className="w-full space-y-2 text-sm">
            {[
              { l: "Dashboard", href: "/dashboard" },
              { l: "Pipeline", href: "/pipeline" },
              { l: "CCA", href: "/cca" },
              { l: "Equipes", href: "/team" },
              { l: "Marketing", href: "/marketing" },
              { l: "Gamificação", href: "/gamification" },
            ].map(i => (
              <a key={i.href} href={i.href} className="block text-left px-4 py-2 rounded-lg hover:bg-white/10 transition">
                {i.l}
              </a>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <main className="col-span-12 md:col-span-9 space-y-4">
          {/* HEADER */}
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Dashboard</h1>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[180px] bg-white dark:bg-[#1e1b4b]"><SelectValue placeholder="Mês" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Meses</SelectItem>
                {availableMonths.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* KPI ROW */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {kpis.map((k, i) => (
              <Card key={i} className={`p-5 rounded-2xl border-0 shadow-sm ${k.accent ? 'bg-[#1e3a5f] text-white' : 'bg-white dark:bg-[#1e1b4b] dark:text-white'}`}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-sm font-semibold ${k.accent ? 'text-white/80' : 'text-slate-600 dark:text-slate-300'}`}>{k.label}</span>
                  <div className={`h-7 w-7 rounded-full flex items-center justify-center ${k.accent ? 'bg-amber-400 text-[#1e3a5f]' : 'bg-amber-100 text-amber-600'}`}>
                    <k.icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="text-3xl font-bold tracking-tight">{k.value}</div>
              </Card>
            ))}
          </div>

          {/* CHART + DONUT */}
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-12 lg:col-span-8 p-5 rounded-2xl border-0 shadow-sm bg-white dark:bg-[#1e1b4b]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-800 dark:text-white">Resultado mensal</h3>
                <Button size="sm" className="bg-amber-400 hover:bg-amber-500 text-[#1e3a5f] rounded-full h-7 px-4 text-xs font-bold">Ver agora</Button>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={stats.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip />
                  <Bar dataKey="propostas" name="Propostas" fill="#1e3a5f" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="vendas" name="Vendas" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="col-span-12 lg:col-span-4 p-5 rounded-2xl border-0 shadow-sm bg-white dark:bg-[#1e1b4b]">
              <h3 className="font-bold text-slate-800 dark:text-white mb-2">Meta</h3>
              <div className="relative">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={donutData} innerRadius={55} outerRadius={80} dataKey="value" startAngle={90} endAngle={-270}>
                      {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-3xl font-bold text-slate-800 dark:text-white">{stats.pct}%</span>
                </div>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                <li>Vendas: <b>{stats.vendas}</b> / {stats.meta}</li>
                <li>Leads: <b>{stats.leads}</b></li>
                <li>Propostas: <b>{stats.propostas}</b></li>
              </ul>
              <Button size="sm" className="mt-3 w-full bg-amber-400 hover:bg-amber-500 text-[#1e3a5f] rounded-full h-7 text-xs font-bold">Ver agora</Button>
            </Card>
          </div>

          {/* AREA + CALENDAR */}
          <div className="grid grid-cols-12 gap-4">
            <Card className="col-span-12 lg:col-span-8 p-5 rounded-2xl border-0 shadow-sm bg-white dark:bg-[#1e1b4b]">
              <div className="flex items-center gap-4 mb-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> VGV</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#1e3a5f]" /> Tendência</span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={stats.area}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <Tooltip formatter={(v: number) => brl(v)} />
                  <Area type="monotone" dataKey="valor" stroke="#f59e0b" fill="url(#g1)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card className="col-span-12 lg:col-span-4 p-3 rounded-2xl border-0 shadow-sm bg-white dark:bg-[#1e1b4b] flex items-center justify-center">
              <Calendar mode="single" className="rounded-md" />
            </Card>
          </div>

          {/* TOP RANKING */}
          <Card className="p-5 rounded-2xl border-0 shadow-sm bg-white dark:bg-[#1e1b4b]">
            <h3 className="font-bold text-slate-800 dark:text-white mb-3">Top Corretores do Período</h3>
            <div className="space-y-2">
              {stats.top.length === 0 && <p className="text-sm text-slate-500">Sem vendas no período.</p>}
              {stats.top.map((t, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-6 text-xs font-bold text-amber-500">{i + 1}º</span>
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 font-medium">{t.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-amber-400" style={{ width: `${(t.v / stats.top[0].v) * 100}%` }} />
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200 w-10 text-right">{t.v}</span>
                </div>
              ))}
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}
