import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Trophy, Users, FileText, TrendingUp, XCircle, CheckCircle2, DollarSign, Target } from "lucide-react";
import { isResultado, isProducao, isPerda, normalizeStatus, pickOpenMonth, compareMonth } from "@/lib/dealStatus";

const DEVELOPERS = ["VASCO", "TENDA", "MRV", "MELNICK", "LYX", "MAB", "ABACO", "MCG", "MITRANA"];
const SOURCES = ["Leadfy", "Lead Próprio", "Lead Loja", "Lead Padrão", "Lead Indicação"];
const CCA_STATUSES = [
  "Aprovado Total",
  "Aprovado Condicionado",
  "Análise de Viabilidade",
  "Assinatura no Banco",
  "Pendente de Viabilidade",
  "Reprovado",
  "Pendente",
];
const STAFF_ROWS = [
  ["Sócios", 3],
  ["Adm", 4],
  ["Administrativo", 5],
  ["Direção", 3],
  ["Gerentes", 11],
  ["Corretores Ativos", 75],
  ["Sempre Gerais", 4],
  ["Total", 105],
] as const;

type Deal = {
  id: string;
  client: string | null;
  developer: string | null;
  stage: string;
  status: string | null;
  deal_value: number | null;
  active: boolean | null;
  month_base: string | null;
  broker1_id: string | null;
  manager1_id: string | null;
  created_at: string;
};
type Broker = { id: string; name: string; role?: string | null; manager_id?: string | null; team?: string | null };

const brl = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(n);

// Premium design tokens
const GOLD = "#3B82F6";
const panel = "rounded-2xl bg-white/[0.02] border border-white/10 backdrop-blur-sm shadow-[0_10px_40px_-15px_rgba(0,0,0,0.5)]";
const panelGold = "rounded-2xl bg-white/[0.03] border border-[#3B82F6]/20 backdrop-blur-sm shadow-[0_0_50px_-10px_rgba(59,130,246,0.15)]";
const headerCell = "text-[10px] uppercase tracking-[0.18em] text-white/40 font-bold";
const rowHover = "hover:bg-white/[0.03] transition-colors duration-200";

export default function Dashboard() {
  const [month, setMonth] = useState<string | null>(null);

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

  // Default to most recent OPEN month (skip already-closed months).
  useEffect(() => {
    if (month === null && months.length > 0) {
      setMonth(pickOpenMonth(months, closedMonths));
    }
  }, [month, months, closedMonths]);

  const activeMonth = month ?? "all";

  const filtered = useMemo(
    () => (activeMonth === "all" ? deals : deals.filter((d) => d.month_base === activeMonth)),
    [deals, activeMonth]
  );

  // "Distrato posterior à venda" — precisa considerar TODOS os deals para o cliente,
  // não só os do mês filtrado, e testar se há uma VENDA em mês anterior.
  const distratoPosteriorIds = useMemo(() => {
    const vendasPorCliente = new Map<string, string[]>(); // client -> months onde teve VENDA
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
        if (vendas.some((vm) => compareMonth(vm, d.month_base!) < 0)) {
          ids.add(d.id);
        }
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
    const off = filtered.filter((d) => normalizeStatus(d.status) === "OFF").length;
    const vgv = filtered.filter((d) => isResultado(d.status)).reduce((a, d) => a + (d.deal_value || 0), 0);
    const meta = 92;
    const pct = Math.min(999, Math.round((vendas / meta) * 100));
    return { vendas, propostas, negocios, off, perdas, vgv, meta, pct };
  }, [filtered, distratoPosteriorIds]);

  const byDev = useMemo(() => {
    return DEVELOPERS.map((dev) => {
      const ds = filtered.filter((d) => (d.developer || "").toUpperCase() === dev);
      const v = ds.filter((d) => isResultado(d.status));
      const p = ds.filter((d) => isProducao(d.status));
      const perdas = ds.filter((d) => normalizeStatus(d.status) === "QUEDA" || distratoPosteriorIds.has(d.id));
      const vgv = v.reduce((a, d) => a + (d.deal_value || 0), 0);
      const propVgv = p.reduce((a, d) => a + (d.deal_value || 0), 0);
      const meta = 10;
      const pctMeta = Math.round((v.length / meta) * 100);
      return { dev, vendas: v.length, vgv, prop: p.length, neg: v.length + p.length, propVgv, meta, pctMeta, vendido: v.length, perdas: perdas.length };
    });
  }, [filtered, distratoPosteriorIds]);

  const directorRows = [
    { name: "Fabio Roldão", sem: 23, meta: 28, pct: 54, leads: 540, agil: 27, neg: 36, vendas: 13, vgv: 13649027.85, off: 1 },
    { name: "Archimedes Neff", sem: 26, meta: 29, pct: 67, leads: 778, agil: 38, neg: 7, vendas: 3, vgv: 4524752.36, off: 22 },
    { name: "Mauricio Vieira", sem: 25, meta: 35, pct: 31, leads: 657, agil: 24, neg: 3, vendas: 11, vgv: 12259027.06, off: 11 },
  ];

  const managerRows = [
    { name: "José Portilho", sem: 0, meta: 8, pct: 113, leads: 175, agil: 6, neg: 9, vendas: 9, vgv: 8853376.91, off: 0 },
    { name: "Leonardo Júnior", sem: 0, meta: 12, pct: 33, leads: 142, agil: 2, neg: 0, vendas: 4, vgv: 4434179.17, off: 0 },
    { name: "Daiane Dias", sem: 0, meta: 10, pct: 50, leads: 99, agil: 9, neg: 0, vendas: 5, vgv: 4753403.32, off: 0 },
    { name: "Alisson Loll", sem: 0, meta: 10, pct: 70, leads: 247, agil: 3, neg: 0, vendas: 7, vgv: 7350072.79, off: 0 },
    { name: "Susana Christina", sem: 0, meta: 8, pct: 0, leads: 371, agil: 0, neg: 0, vendas: 0, vgv: 0, off: 0 },
    { name: "Victor Padovani", sem: 0, meta: 10, pct: 20, leads: 268, agil: 27.5, neg: 0, vendas: 2, vgv: 2229839.46, off: 0 },
    { name: "Alexandre Cheres", sem: 0, meta: 8, pct: 38, leads: 0, agil: 0, neg: 0, vendas: 3, vgv: 3739979.04, off: 0 },
    { name: "Verónica Oliveira", sem: 0, meta: 8, pct: 75, leads: 81, agil: 6, neg: 0, vendas: 6, vgv: 0, off: 0 },
  ];

  const sourceCounts = useMemo(
    () => ({ "Leadfy": leadsCount, "Lead Próprio": 23, "Lead Loja": 9, "Lead Padrão": 5, "Lead Indicação": 50 }),
    [leadsCount]
  );

  const ccaCounts: Record<string, number> = {
    "Aprovado Total": 0,
    "Aprovado Condicionado": 4,
    "Análise de Viabilidade": 6,
    "Assinatura no Banco": 9,
    "Pendente de Viabilidade": 9,
    "Reprovado": 0,
    "Pendente": 11,
  };

  const rankingGeral = useMemo(() => {
    const rows = brokers.map((b) => {
      const ds = filtered.filter((d) => d.broker1_id === b.id);
      const v = ds.filter((d) => isResultado(d.status));
      const p = ds.filter((d) => isProducao(d.status));
      const perdas = ds.filter((d) => normalizeStatus(d.status) === "QUEDA" || distratoPosteriorIds.has(d.id));
      return {
        name: b.name,
        leads: ds.length,
        vendas: v.length,
        agil: p.length,
        neg: v.length + p.length,
        vgv: v.reduce((a, d) => a + (d.deal_value || 0), 0),
        off: perdas.length,
      };
    });
    return rows.sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
  }, [brokers, filtered, distratoPosteriorIds]);

  const cellGood = "bg-emerald-500/15 text-emerald-300";
  const cellWarn = "bg-[#3B82F6]/15 text-[#3B82F6]";
  const cellBad = "bg-rose-500/15 text-rose-300";
  const cellOf = (n: number, good = true) =>
    n > 0 ? (good ? cellGood : cellBad) : good ? cellBad : cellGood;

  const isMonthClosed = activeMonth !== "all" && closedMonths.includes(activeMonth);
  const kpis = [
    { l: "Leads Gerados", v: leadsCount || 0, sub: "Base ativa", Icon: Users },
    { l: "Produção", v: stats.propostas, sub: "Propostas", Icon: FileText },
    { l: "Resultado", v: stats.vendas, sub: "Vendas", popular: true, Icon: TrendingUp },
    { l: "Perdas", v: stats.perdas, sub: "Quedas + distratos", Icon: XCircle },
    { l: "Negócios", v: stats.negocios, sub: "Vendas + propostas", Icon: CheckCircle2 },
    { l: "VGV", v: brl(stats.vgv || 0), sub: "Volume vendido", small: true, Icon: DollarSign },
    { l: "Meta", v: `${stats.pct}%`, sub: `${stats.vendas}/${stats.meta}`, bar: stats.pct, Icon: Target },
  ];

  return (
    <div className="min-h-screen bg-[#05070A] font-['Plus_Jakarta_Sans',sans-serif] text-white p-4 md:p-8 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-[#3B82F6]/[0.06] blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -left-40 w-[500px] h-[500px] rounded-full bg-[#1E3A8A]/[0.08] blur-3xl" />

      <div className="relative max-w-[1500px] mx-auto flex flex-col gap-8 animate-in fade-in duration-700">
        {/* Tabs Top */}
        <div className="flex items-center gap-1 border-b border-white/[0.06] pb-1 overflow-x-auto">
          {["Visão Geral", "Vendas", "Propostas", "Metas"].map((t, i) => (
            <button
              key={t}
              className={cn(
                "px-6 py-2.5 text-sm font-semibold whitespace-nowrap transition-all duration-300 border-b-2 -mb-[1px]",
                i === 0
                  ? "border-[#3B82F6] text-white"
                  : "border-transparent text-white/40 hover:text-white/80",
              )}
            >
              {t}
            </button>
          ))}
          <div className="ml-auto pl-4 pb-1">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[200px] bg-white/[0.03] border border-white/10 text-white/80 rounded-xl h-9 backdrop-blur-md hover:border-white/20 transition-colors">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent className="bg-[#0B0D12] border-white/10 text-white/80">
                <SelectItem value="all">Todos os meses</SelectItem>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Header Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/10 backdrop-blur-xl p-8 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6)] animate-in fade-in slide-in-from-bottom-2 duration-700">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_60%)]" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#3B82F6] to-[#1E3A8A] flex items-center justify-center shadow-lg shadow-blue-600/30 ring-1 ring-white/10">
                <Trophy className="w-7 h-7 text-white" strokeWidth={2} />
              </div>
              <div className="space-y-1">
                <p className="text-[#60A5FA] text-[11px] uppercase tracking-[0.2em] font-semibold">Visão Geral</p>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">Dashboard CRM</h1>
                <p className="text-white/50 text-sm font-medium">
                  Consolidado · {month === "all" ? "Todos os meses" : month}
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-2.5 bg-white/[0.04] border border-[#3B82F6]/30 px-4 py-2 rounded-full self-start md:self-auto backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
              <span className="text-white text-xs font-bold tracking-[0.18em] uppercase">Nível Lendário</span>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {kpis.map((k, i) => (
            <div
              key={k.l}
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: "backwards" }}
              className={cn(
                "group relative bg-white/[0.03] border p-5 rounded-2xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/[0.05] backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 duration-500",
                k.popular
                  ? "border-[#3B82F6]/40 shadow-[0_0_30px_-8px_rgba(59,130,246,0.4)]"
                  : "border-white/10 hover:border-white/20",
              )}
            >
              <div className="flex justify-between items-start mb-3">
                <p className="text-white/50 text-[10px] font-bold uppercase tracking-[0.15em]">{k.l}</p>
                <div className="p-1.5 bg-[#3B82F6]/10 rounded-lg border border-[#3B82F6]/20 group-hover:bg-[#3B82F6]/20 group-hover:scale-110 transition-all duration-300">
                  <k.Icon className="w-3.5 h-3.5 text-[#60A5FA]" strokeWidth={2.2} />
                </div>
              </div>
              <p className={cn("font-bold text-white tabular-nums tracking-tight", k.small ? "text-lg" : "text-2xl")}>{k.v}</p>
              {k.bar !== undefined ? (
                <div className="w-full bg-white/[0.06] h-1 rounded-full mt-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-[#60A5FA] to-[#3B82F6] h-full rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)] transition-all duration-1000"
                    style={{ width: `${Math.min(100, k.bar)}%` }}
                  />
                </div>
              ) : (
                <p className="text-[#60A5FA]/70 text-[10px] mt-2 font-semibold uppercase tracking-wider">{k.sub}</p>
              )}
              {k.popular && (
                <span className="absolute -top-2 right-3 bg-gradient-to-r from-[#3B82F6] to-[#1E40AF] text-white text-[9px] px-2 py-0.5 font-bold rounded-full uppercase tracking-widest shadow-lg shadow-blue-600/40">Popular</span>
              )}
            </div>
          ))}
        </div>


        {/* Vendas / Propostas / Metas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <PanelTable title="Vendas" subtitle="Por construtora">
            <thead>
              <tr className={headerCell}>
                <th className="px-5 py-3 text-left">Construtora</th>
                <th className="px-5 py-3">Qtd</th>
                <th className="px-5 py-3 text-right">VGV</th>
              </tr>
            </thead>
            <tbody>
              {byDev.map((r) => (
                <tr key={r.dev} className={cn("border-b border-white/5 last:border-0", rowHover)}>
                  <td className="px-5 py-3 text-white text-sm font-medium">{r.dev}</td>
                  <td className="px-5 py-3 text-center text-sm">{r.vendas}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-sm text-[#3B82F6] font-semibold font-mono">
                    {r.vgv > 0 ? brl(r.vgv) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </PanelTable>

          <PanelTable title="Propostas" subtitle="Pipeline ativo">
            <thead>
              <tr className={headerCell}>
                <th className="px-5 py-3 text-left">Const.</th>
                <th className="px-5 py-3">Prop</th>
                <th className="px-5 py-3">Neg</th>
                <th className="px-5 py-3 text-right">VGV</th>
              </tr>
            </thead>
            <tbody>
              {byDev.map((r) => (
                <tr key={r.dev} className={cn("border-b border-white/5 last:border-0", rowHover)}>
                  <td className="px-5 py-3 text-white text-sm font-medium">{r.dev}</td>
                  <td className="px-5 py-3 text-center text-sm">{r.prop}</td>
                  <td className="px-5 py-3 text-center text-sm">{r.neg}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-sm font-mono text-white/80">
                    {r.propVgv > 0 ? brl(r.propVgv) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </PanelTable>

          <PanelTable title="Metas" subtitle="Atingimento">
            <thead>
              <tr className={headerCell}>
                <th className="px-5 py-3 text-left">Const.</th>
                <th className="px-5 py-3">Meta</th>
                <th className="px-5 py-3">%</th>
                <th className="px-5 py-3">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {byDev.map((r) => (
                <tr key={r.dev} className={cn("border-b border-white/5 last:border-0", rowHover)}>
                  <td className="px-5 py-3 text-white text-sm font-medium">{r.dev}</td>
                  <td className="px-5 py-3 text-center text-sm">{r.meta}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.pctMeta >= 100 ? cellGood : r.pctMeta > 0 ? cellWarn : cellBad)}>{r.pctMeta}%</span>
                  </td>
                  <td className="px-5 py-3 text-center text-sm">{r.vendido}</td>
                </tr>
              ))}
            </tbody>
          </PanelTable>
        </div>

        {/* Diretores & Gerentes */}
        <RankCard title="Ranking Diretores" rows={directorRows} kind="Diretor" />
        <RankCard title="Ranking Gerentes" rows={managerRows} kind="Gerente" />

        {/* Origem + CCA + Staff */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={cn(panel, "p-6")}>
            <h3 className={cn(headerCell, "mb-5")}>Origem dos Leads</h3>
            <div className="space-y-3">
              {SOURCES.map((s) => {
                const v = (sourceCounts as any)[s] ?? 0;
                const max = Math.max(...Object.values(sourceCounts).map(Number));
                const pct = max ? (v / max) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-white/70">{s}</span>
                      <span className="text-white font-bold tabular-nums">{v}</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#3B82F6] to-[#1E40AF] rounded-full transition-all duration-1000 shadow-[0_0_8px_rgba(59,130,246,0.4)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={cn(panel, "p-6")}>
            <h3 className={cn(headerCell, "mb-5")}>Status CCA</h3>
            <div className="space-y-1">
              {CCA_STATUSES.map((s) => (
                <div key={s} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <span className="text-xs text-white/60">{s}</span>
                  <span className="text-sm font-bold text-white tabular-nums">{ccaCounts[s] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={cn(panel, "p-6")}>
            <h3 className={cn(headerCell, "mb-5 text-[#3B82F6]")}>Staff</h3>
            <div className="space-y-1.5">
              {STAFF_ROWS.map(([l, v]) => (
                <div
                  key={l}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg",
                    l === "Total"
                      ? "bg-gradient-to-r from-[#3B82F6]/20 to-transparent border border-[#3B82F6]/30"
                      : "hover:bg-white/[0.03] transition-colors",
                  )}
                >
                  <span className={cn("text-xs", l === "Total" ? "text-[#3B82F6] font-black uppercase tracking-widest" : "text-white/70")}>{l}</span>
                  <span className={cn("tabular-nums font-bold", l === "Total" ? "text-white text-lg" : "text-sm text-white")}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Metas Globais Bar Chart */}
        <div className={cn(panel, "p-6")}>
          <h3 className={cn(headerCell, "mb-5")}>Desempenho Semanal · Metas Globais</h3>
          <div className="flex items-end gap-2 h-40 mb-4">
            {[40, 65, 55, 90, 100, 45, 30].map((h, i) => (
              <div
                key={i}
                className={cn(
                  "flex-1 rounded-t-sm transition-all",
                  h === 100
                    ? "bg-gradient-to-t from-[#3B82F6]/30 to-[#3B82F6] shadow-[0_0_15px_rgba(59,130,246,0.4)]"
                    : "bg-white/5 hover:bg-[#3B82F6]/40",
                )}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-white/30 font-bold uppercase tracking-widest">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
              <span key={d} className="flex-1 text-center">{d}</span>
            ))}
          </div>
        </div>

        {/* Ranking Geral */}
        <div className={cn(panel, "overflow-hidden")}>
          <div className="p-6 border-b border-white/5 flex justify-between items-center">
            <h3 className="font-bold uppercase tracking-widest text-sm">Ranking Geral</h3>
            <span className="text-[10px] text-[#3B82F6] uppercase font-bold tracking-widest">
              {rankingGeral.length} corretores
            </span>
          </div>
          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0B0D12]/95 backdrop-blur-md">
                <tr className={cn(headerCell, "border-b border-white/5")}>
                  <th className="px-5 py-4 text-left">#</th>
                  <th className="px-5 py-4 text-left">Corretor</th>
                  <th className="px-5 py-4">Leads</th>
                  <th className="px-5 py-4">Vendas</th>
                  <th className="px-5 py-4">Ágil</th>
                  <th className="px-5 py-4">Neg.</th>
                  <th className="px-5 py-4 text-right">VGV</th>
                  <th className="px-5 py-4">Off</th>
                </tr>
              </thead>
              <tbody>
                {rankingGeral.map((r, i) => (
                  <tr key={i} className={cn("border-b border-white/5 last:border-0", rowHover)}>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "w-7 h-7 inline-flex items-center justify-center rounded font-black text-xs",
                          i === 0
                            ? "bg-gradient-to-r from-[#3B82F6] to-[#1E3A8A] text-black"
                            : i < 3
                            ? "border border-[#3B82F6]/40 text-[#3B82F6]"
                            : "border border-white/10 text-white/40",
                        )}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[10px] font-bold text-white/80">
                          {r.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <span className="text-white font-medium">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.leads))}>{r.leads}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.vendas))}>{r.vendas}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.agil))}>{r.agil}</span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.neg))}>{r.neg}</span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-[#3B82F6] font-semibold font-mono">
                      {r.vgv > 0 ? brl(r.vgv) : "—"}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.off, false))}>{r.off}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function PanelTable({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm shadow-[0_10px_40px_-15px_rgba(0,0,0,0.5)]">
      <div className="px-5 py-4 border-b border-white/5 flex items-end justify-between">
        <h3 className="font-bold uppercase tracking-widest text-white text-sm">{title}</h3>
        {subtitle && <span className="text-[10px] uppercase tracking-widest text-[#3B82F6]/70 font-bold">{subtitle}</span>}
      </div>
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}

function RankCard({ title, rows, kind }: { title: string; rows: any[]; kind: string }) {
  const cellGood = "bg-emerald-500/15 text-emerald-300";
  const cellWarn = "bg-[#3B82F6]/15 text-[#3B82F6]";
  const cellBad = "bg-rose-500/15 text-rose-300";
  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm shadow-[0_10px_40px_-15px_rgba(0,0,0,0.5)]">
      <div className="p-6 border-b border-white/5 flex justify-between items-center">
        <h3 className="font-bold uppercase tracking-widest text-sm">{title}</h3>
        <span className="px-3 py-1 rounded-full bg-[#3B82F6]/10 border border-[#3B82F6]/30 text-[#3B82F6] text-[10px] font-black uppercase tracking-widest">
          {rows.length} {kind}s
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-white/30 font-bold border-b border-white/5">
              <th className="px-5 py-4">Sem Compras</th>
              <th className="px-5 py-4">Meta</th>
              <th className="px-5 py-4">% Atingida</th>
              <th className="px-5 py-4 text-left">{kind}</th>
              <th className="px-5 py-4">Leads</th>
              <th className="px-5 py-4">Ágil</th>
              <th className="px-5 py-4">Neg.</th>
              <th className="px-5 py-4">Vendas</th>
              <th className="px-5 py-4 text-right text-[#3B82F6]">VGV</th>
              <th className="px-5 py-4">Off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="px-5 py-3 text-center">
                  <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.sem > 0 ? cellWarn : cellGood)}>{r.sem}</span>
                </td>
                <td className="px-5 py-3 text-center text-white">{r.meta}</td>
                <td className="px-5 py-3 text-center">
                  <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.pct >= 100 ? cellGood : r.pct >= 50 ? cellWarn : cellBad)}>{r.pct}%</span>
                </td>
                <td className="px-5 py-3 text-white font-medium">{r.name}</td>
                <td className="px-5 py-3 text-center">{r.leads}</td>
                <td className="px-5 py-3 text-center">{r.agil}</td>
                <td className="px-5 py-3 text-center">{r.neg}</td>
                <td className="px-5 py-3 text-center">
                  <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-500/15 text-emerald-300">{r.vendas}</span>
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-[#3B82F6] font-semibold font-mono">{r.vgv > 0 ? brl(r.vgv) : "—"}</td>
                <td className="px-5 py-3 text-center">
                  <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.off > 0 ? cellBad : cellGood)}>{r.off}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const brlFmt = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
export { brlFmt };
