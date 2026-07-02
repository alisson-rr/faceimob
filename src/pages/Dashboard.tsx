import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy, Users, FileText, TrendingUp, XCircle, CheckCircle2, DollarSign, Target,
  Crown, Medal, Award, Flame, Building2, Layers, UserCog,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  RadialBarChart, RadialBar, PolarAngleAxis, LineChart, Line, Legend,
} from "recharts";
import { isResultado, isProducao, isPerda, normalizeStatus, pickOpenMonth, compareMonth } from "@/lib/dealStatus";

// ─── Static tables ──────────────────────────────────────────────────────────
const DEVELOPERS = ["VASCO", "TENDA", "MRV", "MELNICK", "LYX", "MAB", "ABACO", "MCG", "MITRANA"];
const DEV_COLORS: Record<string, string> = {
  VASCO:   "#3B82F6",
  TENDA:   "#F59E0B",
  MRV:     "#10B981",
  MELNICK: "#8B5CF6",
  LYX:     "#EC4899",
  MAB:     "#06B6D4",
  ABACO:   "#F97316",
  MCG:     "#14B8A6",
  MITRANA: "#EAB308",
};
const SOURCES = ["Leadfy", "Lead Próprio", "Lead Loja", "Lead Padrão", "Lead Indicação"];
const SOURCE_COLORS = ["#3B82F6", "#F59E0B", "#10B981", "#EC4899", "#8B5CF6"];
const CCA_STATUSES = [
  "Aprovado Total", "Aprovado Condicionado", "Análise de Viabilidade",
  "Assinatura no Banco", "Pendente de Viabilidade", "Reprovado", "Pendente",
] as const;
const CCA_COLORS: Record<string, string> = {
  "Aprovado Total":         "#10B981",
  "Aprovado Condicionado":  "#22C55E",
  "Análise de Viabilidade": "#06B6D4",
  "Assinatura no Banco":    "#3B82F6",
  "Pendente de Viabilidade":"#F59E0B",
  "Reprovado":              "#EF4444",
  "Pendente":               "#A855F7",
};
const STAFF_ROWS = [
  ["Sócios", 3, "#3B82F6"], ["Adm", 4, "#8B5CF6"], ["Administrativo", 5, "#06B6D4"],
  ["Direção", 3, "#F59E0B"], ["Gerentes", 11, "#EC4899"], ["Corretores Ativos", 75, "#10B981"],
  ["Sempre Gerais", 4, "#A855F7"], ["Total", 105, "#F97316"],
] as const;

// ─── Types ──────────────────────────────────────────────────────────────────
type Deal = {
  id: string; client: string | null; developer: string | null; stage: string;
  status: string | null; deal_value: number | null; active: boolean | null;
  month_base: string | null; broker1_id: string | null; manager1_id: string | null; created_at: string;
};
type Broker = { id: string; name: string; role?: string | null; manager_id?: string | null; team?: string | null };

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n);

const panel =
  "rounded-2xl bg-white/[0.02] border border-white/10 backdrop-blur-sm shadow-[0_10px_40px_-15px_rgba(0,0,0,0.5)]";
const headerCell = "text-[10px] uppercase tracking-[0.18em] text-white/40 font-bold";

// ─── Component ──────────────────────────────────────────────────────────────
type TabKey = "geral" | "propostas" | "vendas" | "metas";

export default function Dashboard() {
  const [month, setMonth] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("geral");

  const { data: deals = [] } = useQuery({
    queryKey: ["dashboard", "deals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("deals").select("*");
      if (error) throw error;
      return (data || []).map((x: any) => ({
        ...x,
        month_base: x.month_base || (x.created_at ? format(parseISO(x.created_at), "MM/yyyy") : null),
      })) as Deal[];
    },
    staleTime: 60_000,
  });

  const { data: brokers = [] } = useQuery({
    queryKey: ["dashboard", "brokers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brokers").select("*");
      if (error) throw error;
      return (data || []) as Broker[];
    },
    staleTime: 5 * 60_000,
  });

  const { data: leadsCount = 0 } = useQuery({
    queryKey: ["dashboard", "leadsCount"],
    queryFn: async () => {
      const { count, error } = await supabase.from("leads").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
    staleTime: 60_000,
  });

  const { data: closedMonths = [] } = useQuery({
    queryKey: ["closed_months"],
    queryFn: async () => {
      const { data, error } = await supabase.from("closed_months" as any).select("month_base");
      if (error) throw error;
      return ((data as any[]) || []).map((r) => r.month_base as string);
    },
    staleTime: 60_000,
  });

  const months = useMemo(() => {
    const s = new Set<string>();
    deals.forEach((d) => d.month_base && s.add(d.month_base));
    return Array.from(s).sort((a, b) => compareMonth(b, a));
  }, [deals]);

  useEffect(() => {
    if (month === null && months.length > 0) setMonth(pickOpenMonth(months, closedMonths));
  }, [month, months, closedMonths]);

  const activeMonth = month ?? "all";

  const filtered = useMemo(
    () => (activeMonth === "all" ? deals : deals.filter((d) => d.month_base === activeMonth)),
    [deals, activeMonth],
  );

  const distratoPosteriorIds = useMemo(() => {
    const vendasPorCliente = new Map<string, string[]>();
    deals.forEach((d) => {
      if (isResultado(d.status) && d.client && d.month_base) {
        const arr = vendasPorCliente.get(d.client) || [];
        arr.push(d.month_base);
        vendasPorCliente.set(d.client, arr);
      }
    });
    const ids = new Set<string>();
    deals.forEach((d) => {
      if (normalizeStatus(d.status) === "DISTRATO" && d.client && d.month_base) {
        const vendas = vendasPorCliente.get(d.client) || [];
        if (vendas.some((vm) => compareMonth(vm, d.month_base!) < 0)) ids.add(d.id);
      }
    });
    return ids;
  }, [deals]);

  const stats = useMemo(() => {
    const vendas = filtered.filter((d) => isResultado(d.status)).length;
    const propostas = filtered.filter((d) => isProducao(d.status)).length;
    const quedas = filtered.filter((d) => normalizeStatus(d.status) === "QUEDA").length;
    const distratos = filtered.filter((d) => distratoPosteriorIds.has(d.id)).length;
    const perdas = quedas + distratos;
    const negocios = vendas + propostas;
    const vgv = filtered.filter((d) => isResultado(d.status)).reduce((a, d) => a + (d.deal_value || 0), 0);
    const meta = 92;
    const pct = Math.min(999, Math.round((vendas / meta) * 100));
    return { vendas, propostas, negocios, perdas, vgv, meta, pct };
  }, [filtered, distratoPosteriorIds]);

  const byDev = useMemo(() => {
    return DEVELOPERS.map((dev) => {
      const ds = filtered.filter((d) => (d.developer || "").toUpperCase() === dev);
      const v = ds.filter((d) => isResultado(d.status));
      const p = ds.filter((d) => isProducao(d.status));
      const vgv = v.reduce((a, d) => a + (d.deal_value || 0), 0);
      const propVgv = p.reduce((a, d) => a + (d.deal_value || 0), 0);
      const meta = 10;
      return {
        dev, vendas: v.length, prop: p.length, neg: v.length + p.length,
        vgv, propVgv, meta, pctMeta: Math.round((v.length / meta) * 100),
        color: DEV_COLORS[dev] || "#3B82F6",
      };
    });
  }, [filtered]);

  const brokerMap = useMemo(() => {
    const m = new Map<string, string>();
    brokers.forEach((b) => m.set(b.id, b.name));
    return m;
  }, [brokers]);

  // Aggregations per role — 100% real deals data.
  const rankBrokers = useMemo(() => {
    const map = new Map<string, { name: string; vendas: number; vgv: number }>();
    filtered.forEach((d) => {
      if (!isResultado(d.status) || !d.broker1_id) return;
      const name = brokerMap.get(d.broker1_id) || "(sem nome)";
      const e = map.get(d.broker1_id) || { name, vendas: 0, vgv: 0 };
      e.vendas += 1;
      e.vgv += d.deal_value || 0;
      map.set(d.broker1_id, e);
    });
    return Array.from(map.values()).sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
  }, [filtered, brokerMap]);

  const rankManagers = useMemo(() => {
    const map = new Map<string, { name: string; vendas: number; vgv: number }>();
    filtered.forEach((d) => {
      if (!isResultado(d.status) || !d.manager1_id) return;
      const name = brokerMap.get(d.manager1_id) || "(gerente)";
      const e = map.get(d.manager1_id) || { name, vendas: 0, vgv: 0 };
      e.vendas += 1;
      e.vgv += d.deal_value || 0;
      map.set(d.manager1_id, e);
    });
    return Array.from(map.values()).sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
  }, [filtered, brokerMap]);

  const rankDirectors = useMemo(() => {
    const map = new Map<string, { name: string; vendas: number; vgv: number }>();
    filtered.forEach((d: any) => {
      if (!isResultado(d.status) || !d.director1_id) return;
      const name = brokerMap.get(d.director1_id) || "(diretor)";
      const e = map.get(d.director1_id) || { name, vendas: 0, vgv: 0 };
      e.vendas += 1;
      e.vgv += d.deal_value || 0;
      map.set(d.director1_id, e);
    });
    return Array.from(map.values()).sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
  }, [filtered, brokerMap]);

  // Real leads by source
  const { data: leadsBySource = [] } = useQuery({
    queryKey: ["dashboard", "leads_by_source"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("source");
      if (error) throw error;
      const counts = new Map<string, number>();
      (data || []).forEach((r: any) => {
        const s = (r.source || "Sem origem").toString();
        counts.set(s, (counts.get(s) || 0) + 1);
      });
      return Array.from(counts.entries()).map(([name, v]) => ({ name, v }));
    },
    staleTime: 60_000,
  });
  const sourceData = useMemo(
    () => leadsBySource.map((s, i) => ({ ...s, color: SOURCE_COLORS[i % SOURCE_COLORS.length] })),
    [leadsBySource],
  );

  // Real CCA counts by status
  const { data: ccaCounts = {} } = useQuery({
    queryKey: ["dashboard", "cca_counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cca_deals").select("status");
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        const s = (r.status || "pendente").toString();
        counts[s] = (counts[s] || 0) + 1;
      });
      return counts;
    },
    staleTime: 60_000,
  });

  // Real staff counts
  const staffRows = useMemo(() => {
    const active = brokers.filter((b) => (b as any).active !== false).length;
    const managerIds = new Set(brokers.map((b: any) => b.manager_id).filter(Boolean));
    const directorIds = new Set(brokers.map((b: any) => b.director_id).filter(Boolean));
    return [
      ["Corretores", brokers.length, "#10B981"],
      ["Ativos", active, "#3B82F6"],
      ["Gerentes", managerIds.size, "#EC4899"],
      ["Diretores", directorIds.size, "#F59E0B"],
      ["Total", brokers.length, "#F97316"],
    ] as const;
  }, [brokers]);


  // Monthly series for "Metas" chart
  const monthlyByYear = useMemo(() => {
    const acc: Record<string, Record<string, number>> = {}; // { "01": { "2025": 3, "2026": 5 } }
    for (let m = 1; m <= 12; m++) acc[String(m).padStart(2, "0")] = {};
    deals.forEach((d) => {
      if (!isResultado(d.status) || !d.month_base) return;
      const [mm, yyyy] = d.month_base.split("/");
      if (!acc[mm]) return;
      acc[mm][yyyy] = (acc[mm][yyyy] || 0) + 1;
    });
    const years = Array.from(new Set(deals.map((d) => d.month_base?.split("/")[1]).filter(Boolean))) as string[];
    years.sort();
    return { rows: Object.entries(acc).map(([mm, ys]) => ({ mes: mm, ...ys })), years };
  }, [deals]);

  const isMonthClosed = activeMonth !== "all" && closedMonths.includes(activeMonth);

  // KPIs — cores por card + selo laranja em "Negócios (possíveis vendas)"
  const kpis = [
    { l: "Leads",     v: leadsCount || 0,       Icon: Users,       color: "#3B82F6" },
    { l: "Produção",  v: stats.propostas,       Icon: FileText,    color: "#8B5CF6" },
    { l: "Resultado", v: stats.vendas,          Icon: TrendingUp,  color: "#10B981" },
    { l: "Perdas",    v: stats.perdas,          Icon: XCircle,     color: "#EF4444" },
    { l: "Negócios",  v: stats.negocios,        Icon: CheckCircle2,color: "#F97316", highlight: true },
    { l: "VGV",       v: brl(stats.vgv || 0),   Icon: DollarSign,  color: "#EAB308", small: true },
    { l: "Meta",      v: `${stats.pct}%`,       Icon: Target,      color: "#06B6D4", bar: stats.pct },
  ];

  return (
    <div className="min-h-screen bg-[#05070A] font-['Plus_Jakarta_Sans',sans-serif] text-white p-4 md:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-[#3B82F6]/[0.06] blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -left-40 w-[500px] h-[500px] rounded-full bg-[#1E3A8A]/[0.08] blur-3xl" />

      <div className="relative max-w-[1500px] mx-auto flex flex-col gap-5 animate-in fade-in duration-500">
        {/* Tabs + Period */}
        <div className="flex items-center gap-1 border-b border-white/[0.06] pb-1 overflow-x-auto">
          {([
            ["geral", "Visão Geral"],
            ["propostas", "Propostas"],
            ["vendas", "Vendas"],
            ["metas", "Metas"],
          ] as [TabKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "px-5 py-2 text-sm font-semibold whitespace-nowrap transition-all duration-300 border-b-2 -mb-[1px]",
                tab === k ? "border-[#3B82F6] text-white" : "border-transparent text-white/40 hover:text-white/80",
              )}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto pl-4 pb-1 flex items-center gap-2">
            {activeMonth !== "all" && (
              <span className={cn(
                "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                isMonthClosed
                  ? "bg-white/[0.04] border-white/15 text-white/60"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
              )}>
                {isMonthClosed ? "Fechado" : "Aberto"}
              </span>
            )}
            <Select value={activeMonth} onValueChange={setMonth}>
              <SelectTrigger className="w-[180px] bg-white/[0.03] border border-white/10 text-white/80 rounded-xl h-9 backdrop-blur-md">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent className="bg-[#0B0D12] border-white/10 text-white/80">
                <SelectItem value="all">Todos os meses</SelectItem>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m} {closedMonths.includes(m) ? "· fechado" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Compact header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/10 backdrop-blur-xl px-5 py-4 flex items-center justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_60%)]" />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3B82F6] to-[#1E3A8A] flex items-center justify-center ring-1 ring-white/10">
              <Trophy className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[#60A5FA] text-[10px] uppercase tracking-[0.2em] font-semibold">Dashboard BI</p>
              <h1 className="text-xl font-bold tracking-tight">
                Dashboard CRM · <span className="text-white/60 font-medium">{activeMonth === "all" ? "Todos" : activeMonth}</span>
              </h1>
            </div>
          </div>
          <div className="relative hidden md:inline-flex items-center gap-2 bg-white/[0.04] border border-[#3B82F6]/30 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse" />
            <span className="text-white text-[10px] font-bold tracking-[0.18em] uppercase">Nível Lendário</span>
          </div>
        </div>

        {/* KPIs — always visible, compact */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {kpis.map((k, i) => (
            <motion.div
              key={k.l}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className={cn(
                "group relative bg-white/[0.03] border p-3 rounded-xl backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5",
                k.highlight
                  ? "border-[#F97316]/50 shadow-[0_0_30px_-8px_rgba(249,115,22,0.5)]"
                  : "border-white/10 hover:border-white/20",
              )}
            >
              <div className="flex justify-between items-start mb-2">
                <p className="text-white/50 text-[9px] font-bold uppercase tracking-[0.15em]">{k.l}</p>
                <div
                  className="p-1 rounded-md border transition-transform group-hover:scale-110"
                  style={{ backgroundColor: `${k.color}20`, borderColor: `${k.color}40` }}
                >
                  <k.Icon className="w-3 h-3" strokeWidth={2.4} style={{ color: k.color }} />
                </div>
              </div>
              <p className={cn("font-bold text-white tabular-nums tracking-tight", k.small ? "text-sm" : "text-xl")}>{k.v}</p>
              {k.bar !== undefined && (
                <div className="w-full bg-white/[0.06] h-1 rounded-full mt-2 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, k.bar)}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${k.color}, ${k.color}80)` }}
                  />
                </div>
              )}
              {k.highlight && (
                <span className="absolute -top-2 right-2 bg-gradient-to-r from-[#F97316] to-[#000] text-white text-[8px] px-2 py-0.5 font-black rounded-full uppercase tracking-widest shadow-lg shadow-orange-500/50 border border-orange-400/40">
                  Possível Venda
                </span>
              )}
            </motion.div>
          ))}
        </div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col gap-5"
          >
            {tab === "geral" && <GeralTab byDev={byDev} />}
            {tab === "propostas" && (
              <PropostasTab byDev={byDev} sources={sourceData} ccaCounts={ccaCounts} staffRows={staffRows} />
            )}
            {tab === "vendas" && (
              <VendasTab directors={rankDirectors} managers={rankManagers} brokers={rankBrokers} />
            )}
            {tab === "metas" && (
              <MetasTab pct={stats.pct} vendas={stats.vendas} meta={stats.meta} monthly={monthlyByYear} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Tab: Visão Geral ───────────────────────────────────────────────────────
function GeralTab({ byDev }: { byDev: any[] }) {
  const data = byDev.map((d) => ({ name: d.dev, Vendas: d.vendas, Propostas: d.prop, fill: d.color }));
  return (
    <div className={cn(panel, "p-5")}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-sm">Panorama por Construtora</h3>
          <p className="text-white/40 text-xs">Vendas vs Propostas · mês corrente</p>
        </div>
        <Layers className="w-4 h-4 text-[#3B82F6]" />
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={11} />
            <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
            <Tooltip contentStyle={{ background: "#0B0D12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
            <Legend wrapperStyle={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }} />
            <Bar dataKey="Vendas" fill="#10B981" radius={[6, 6, 0, 0]} animationDuration={900} />
            <Bar dataKey="Propostas" fill="#8B5CF6" radius={[6, 6, 0, 0]} animationDuration={900} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Tab: Propostas ─────────────────────────────────────────────────────────
function PropostasTab({
  byDev, sources, ccaCounts, staffRows,
}: {
  byDev: any[];
  sources: { name: string; v: number; color: string }[];
  ccaCounts: Record<string, number>;
  staffRows: readonly (readonly [string, number, string])[];
}) {
  return (
    <>
      {/* Propostas por construtora - cards coloridos */}
      <section>
        <SectionHeader icon={<Building2 className="w-4 h-4" />} title="Propostas por Construtora" caption="Vermelho quando zerado" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {byDev.map((d, i) => {
            const zero = d.prop === 0;
            const color = zero ? "#EF4444" : d.color;
            return (
              <motion.div
                key={d.dev}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="relative p-4 rounded-xl border backdrop-blur-sm overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${color}22, ${color}08)`,
                  borderColor: `${color}55`,
                  boxShadow: `0 10px 30px -10px ${color}55`,
                }}
              >
                <div className="flex justify-between items-center mb-3">
                  <span className="text-white/80 text-[10px] uppercase font-bold tracking-widest">{d.dev}</span>
                  <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: color }}>
                    <FileText className="w-3 h-3 text-white" />
                  </div>
                </div>
                <p className="text-3xl font-black tabular-nums" style={{ color }}>{d.prop}</p>
                <p className="text-white/40 text-[10px] mt-1 uppercase tracking-widest">
                  {zero ? "Sem propostas" : `${brl(d.propVgv)} VGV`}
                </p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Ranking horizontal de propostas por construtora */}
      <section>
        <SectionHeader icon={<Building2 className="w-4 h-4" />} title="Ranking de Propostas" caption="Ordenado do maior para o menor" />
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4" style={{ height: Math.max(180, byDev.length * 38 + 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={[...byDev].sort((a, b) => b.prop - a.prop).map((d) => ({ name: d.dev, Propostas: d.prop, fill: d.prop === 0 ? "#EF4444" : d.color }))}
              margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" stroke="rgba(255,255,255,0.4)" fontSize={11} allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="rgba(255,255,255,0.6)" fontSize={11} width={90} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} contentStyle={{ background: "#0F1524", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8 }} />
              <Bar dataKey="Propostas" radius={[0, 6, 6, 0]} animationDuration={900} label={{ position: "right", fill: "rgba(255,255,255,0.7)", fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Origem de leads (cards) */}
      <section>
        <SectionHeader icon={<Flame className="w-4 h-4" />} title="Origem de Leads" caption="Distribuição por canal" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {sources.map((s, i) => (
            <motion.div
              key={s.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
              className="p-4 rounded-xl border backdrop-blur-sm"
              style={{
                background: `linear-gradient(135deg, ${s.color}22, ${s.color}08)`,
                borderColor: `${s.color}55`,
              }}
            >
              <p className="text-white/70 text-[10px] uppercase font-bold tracking-widest">{s.name}</p>
              <p className="text-2xl font-black tabular-nums mt-2" style={{ color: s.color }}>{s.v}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Status CCA (cards) */}
      <section>
        <SectionHeader icon={<Layers className="w-4 h-4" />} title="Status CCA" caption="Situação dos processos" />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {Object.entries(ccaCounts).length === 0 && (
            <p className="text-white/40 text-xs col-span-full">Sem processos CCA cadastrados.</p>
          )}
          {Object.entries(ccaCounts).map(([s, v], i) => {
            const color = CCA_COLORS[s] || SOURCE_COLORS[i % SOURCE_COLORS.length];
            return (
              <motion.div
                key={s}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="p-3 rounded-xl border backdrop-blur-sm"
                style={{
                  background: `linear-gradient(135deg, ${color}22, ${color}08)`,
                  borderColor: `${color}55`,
                }}
              >
                <p className="text-white/70 text-[9px] uppercase font-bold tracking-wider leading-tight">{s}</p>
                <p className="text-2xl font-black tabular-nums mt-2" style={{ color }}>{v}</p>
              </motion.div>
            );
          })}
        </div>
      </section>


      {/* Staff */}
      <section>
        <SectionHeader icon={<UserCog className="w-4 h-4" />} title="Staff" caption="Composição do time" />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {staffRows.map(([l, v, color]) => (
            <div
              key={l as string}
              className="p-3 rounded-xl border backdrop-blur-sm"
              style={{
                background: `linear-gradient(135deg, ${color}22, ${color}08)`,
                borderColor: `${color}55`,
              }}
            >
              <p className="text-white/70 text-[9px] uppercase font-bold tracking-wider">{l}</p>
              <p className="text-xl font-black tabular-nums mt-1" style={{ color: color as string }}>{v}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

// ─── Tab: Vendas ────────────────────────────────────────────────────────────
function VendasTab({
  directors, managers, brokers,
}: {
  directors: { name: string; vendas: number; vgv: number }[];
  managers: { name: string; vendas: number; vgv: number }[];
  brokers: { name: string; vendas: number; vgv: number }[];
}) {
  return (
    <>
      <RankingBlock title="Ranking Diretores" rows={directors} />
      <RankingBlock title="Ranking Gerentes" rows={managers} />
      <RankingBlock title="Ranking Geral (Corretores)" rows={brokers} scroll />
    </>
  );
}

const PODIUM = [
  { color: "#F5B301", glow: "#F5B30166", ic: Crown, label: "Ouro"   },
  { color: "#C0C0C0", glow: "#C0C0C066", ic: Medal, label: "Prata"  },
  { color: "#CD7F32", glow: "#CD7F3266", ic: Award, label: "Bronze" },
];

function RankingBlock({
  title, rows, scroll,
}: {
  title: string;
  rows: { name: string; vendas: number; vgv: number }[];
  scroll?: boolean;
}) {
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  return (
    <div className={cn(panel, "overflow-hidden")}>
      <div className="p-5 border-b border-white/5 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-[#F5B301]" />
        <h3 className="font-bold uppercase tracking-widest text-sm flex-1">{title}</h3>
        <span className="text-[10px] text-[#3B82F6] uppercase font-bold tracking-widest">
          {rows.length} · vendas · VGV desempate
        </span>
      </div>

      {/* Podium — legendary game style */}
      {top3.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-5">
          {top3.map((r, i) => {
            const P = PODIUM[i];
            return (
              <motion.div
                key={r.name + i}
                initial={{ opacity: 0, y: 24, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.55, delay: i * 0.12, type: "spring", stiffness: 120 }}
                whileHover={{ y: -4 }}
                className="relative rounded-2xl overflow-hidden border h-[280px] flex flex-col"
                style={{
                  background: `linear-gradient(180deg, #0F1524 0%, #0F1524 25%, ${P.color}66 75%, ${P.color} 100%)`,
                  borderColor: `${P.color}66`,
                  boxShadow: `0 0 0 1px ${P.color}33, 0 25px 50px -12px ${P.glow}, inset 0 1px 0 rgba(255,255,255,0.08)`,
                }}
              >
                {/* soft outer glow */}
                <div
                  className="absolute -inset-1 rounded-2xl blur-xl opacity-40 -z-10"
                  style={{ background: `radial-gradient(circle at 50% 100%, ${P.color}, transparent 70%)` }}
                />
                {/* corner icon */}
                <div className="absolute top-3 left-3">
                  <P.ic className="w-5 h-5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" style={{ color: P.color }} />
                </div>
                <div className="absolute top-3 right-3 text-[9px] uppercase tracking-widest font-black opacity-70" style={{ color: P.color }}>
                  #{i + 1} · {P.label}
                </div>

                {/* content */}
                <div className="relative flex-1 flex flex-col items-center justify-center text-center px-4 pt-8">
                  <h4
                    className="text-xl md:text-2xl font-black tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] truncate max-w-full"
                    style={{ color: P.color }}
                  >
                    {r.name}
                  </h4>
                  <p className="mt-1 text-xs text-white/70 font-medium">Ranking Mensal</p>

                  <p
                    className="mt-5 text-5xl font-black tabular-nums drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)]"
                    style={{ color: P.color }}
                  >
                    {r.vendas}
                  </p>
                  <p className="text-xs text-white/70 font-semibold -mt-1">vendas</p>
                </div>

                {/* footer bar */}
                <div
                  className="relative py-3 text-center border-t"
                  style={{ borderColor: "rgba(0,0,0,0.35)", background: "rgba(0,0,0,0.25)" }}
                >
                  <p className="text-white font-black text-base drop-shadow tabular-nums">
                    {r.vgv > 0 ? brl(r.vgv) : "R$ 0"} <span className="text-white/70 font-bold text-xs uppercase tracking-widest ml-1">VGV</span>
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Rest table */}
      {rest.length > 0 && (
        <div className={cn("overflow-x-auto", scroll && "max-h-[420px] overflow-y-auto")}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-[#0B0D12]/95 backdrop-blur-md">
              <tr className={cn(headerCell, "border-b border-white/5")}>
                <th className="px-5 py-3 text-left">#</th>
                <th className="px-5 py-3 text-left">Nome</th>
                <th className="px-5 py-3">Vendas</th>
                <th className="px-5 py-3 text-right">VGV</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((r, i) => (
                <tr key={r.name + i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors">
                  <td className="px-5 py-2.5 text-white/50 font-bold tabular-nums">{i + 4}</td>
                  <td className="px-5 py-2.5 text-white font-medium">{r.name}</td>
                  <td className="px-5 py-2.5 text-center font-bold">{r.vendas}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-[#3B82F6] font-semibold font-mono">
                    {r.vgv > 0 ? brl(r.vgv) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Metas ─────────────────────────────────────────────────────────────
function MetasTab({
  pct, vendas, meta, monthly,
}: {
  pct: number;
  vendas: number;
  meta: number;
  monthly: { rows: any[]; years: string[] };
}) {
  const gaugeData = [{ name: "Atingimento", value: Math.min(100, pct), fill: pct >= 100 ? "#10B981" : pct >= 60 ? "#F59E0B" : "#EF4444" }];
  const yearColors = ["#3B82F6", "#F97316", "#10B981", "#EC4899", "#8B5CF6"];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Thermometer / Radial */}
      <div className={cn(panel, "p-5")}>
        <SectionHeader icon={<Target className="w-4 h-4" />} title="Meta Mensal · Termômetro" caption={`${vendas} de ${meta} vendas`} />
        <div className="h-[300px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart innerRadius="70%" outerRadius="100%" data={gaugeData} startAngle={210} endAngle={-30}>
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar background={{ fill: "rgba(255,255,255,0.05)" }} dataKey="value" cornerRadius={20} animationDuration={1200} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[10px] uppercase font-bold tracking-widest text-white/40">Atingimento</p>
            <p className="text-5xl font-black tabular-nums" style={{ color: gaugeData[0].fill }}>{pct}%</p>
            <p className="text-xs text-white/50 mt-1">{vendas}/{meta}</p>
          </div>
        </div>
      </div>

      {/* Monthly comparison by year */}
      <div className={cn(panel, "p-5")}>
        <SectionHeader icon={<TrendingUp className="w-4 h-4" />} title="Comparativo Mensal por Ano" caption="Vendas por mês" />
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly.rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="mes" stroke="rgba(255,255,255,0.4)" fontSize={11} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} />
              <Tooltip contentStyle={{ background: "#0B0D12", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }} />
              <Legend wrapperStyle={{ color: "rgba(255,255,255,0.6)", fontSize: 11 }} />
              {monthly.years.map((y, i) => (
                <Line
                  key={y}
                  type="monotone"
                  dataKey={y}
                  stroke={yearColors[i % yearColors.length]}
                  strokeWidth={3}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  animationDuration={1200}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function SectionHeader({ icon, title, caption }: { icon: React.ReactNode; title: string; caption?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center text-[#3B82F6]">
          {icon}
        </div>
        <div>
          <h3 className="font-bold text-sm">{title}</h3>
          {caption && <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold">{caption}</p>}
        </div>
      </div>
    </div>
  );
}

export const brlFmt = brl;
