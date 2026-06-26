import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

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
  developer: string | null;
  stage: string;
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

// Design tokens (locked: Midnight Indigo + Space Grotesk / DM Sans)
const display = "font-['Space_Grotesk']";
const panel =
  "rounded-3xl bg-[#141432]/60 backdrop-blur-xl border border-[#1e1e5a] shadow-[0_0_40px_-12px_rgba(79,70,229,0.25)]";
const panelGrad =
  "rounded-3xl bg-gradient-to-br from-[#141432] to-[#1e1e5a]/40 border border-[#1e1e5a] relative overflow-hidden";
const headerCell = "text-[10px] uppercase tracking-widest text-slate-500";
const rowHover = "hover:bg-[#4f46e5]/5 transition-colors ease-[cubic-bezier(.22,1,.36,1)]";

export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [leadsCount, setLeadsCount] = useState(0);
  const [month, setMonth] = useState("all");

  useEffect(() => {
    (async () => {
      const { data: d } = await supabase.from("deals").select("*");
      const { data: b } = await supabase.from("brokers").select("*");
      const { count } = await supabase.from("leads").select("*", { count: "exact", head: true });
      const mapped = (d || []).map((x: any) => ({
        ...x,
        month_base: x.month_base || (x.created_at ? format(parseISO(x.created_at), "MM/yyyy") : null),
      }));
      setDeals(mapped as Deal[]);
      setBrokers((b || []) as Broker[]);
      setLeadsCount(count || 0);
    })();
  }, []);

  const months = useMemo(() => {
    const s = new Set<string>();
    deals.forEach((d) => d.month_base && s.add(d.month_base));
    return Array.from(s).sort((a, b) => {
      const [ma, ya] = a.split("/").map(Number);
      const [mb, yb] = b.split("/").map(Number);
      return yb - ya || mb - ma;
    });
  }, [deals]);

  const filtered = useMemo(
    () => (month === "all" ? deals : deals.filter((d) => d.month_base === month)),
    [deals, month]
  );

  const stats = useMemo(() => {
    const vendas = filtered.filter((d) => d.stage === "closed" || d.stage === "contract").length;
    const propostas = filtered.filter((d) => ["proposal", "contract", "approved"].includes(d.stage)).length;
    const negocios = filtered.filter((d) => !["lead", "incomplete"].includes(d.stage)).length;
    const off = filtered.filter((d) => d.active === false).length;
    const vgv = filtered.filter((d) => d.active !== false).reduce((a, d) => a + (d.deal_value || 0), 0);
    const meta = 92;
    const pct = Math.min(999, Math.round((vendas / meta) * 100));
    return { vendas, propostas, negocios, off, vgv, meta, pct };
  }, [filtered]);

  const byDev = useMemo(() => {
    return DEVELOPERS.map((dev) => {
      const ds = filtered.filter((d) => (d.developer || "").toUpperCase() === dev);
      const v = ds.filter((d) => d.stage === "closed" || d.stage === "contract");
      const p = ds.filter((d) => ["proposal", "contract", "approved"].includes(d.stage));
      const n = ds.filter((d) => !["lead", "incomplete"].includes(d.stage));
      const vgv = v.reduce((a, d) => a + (d.deal_value || 0), 0);
      const propVgv = p.reduce((a, d) => a + (d.deal_value || 0), 0);
      const meta = 10;
      const pctMeta = Math.round((v.length / meta) * 100);
      return { dev, vendas: v.length, vgv, prop: p.length, neg: n.length, propVgv, meta, pctMeta, vendido: v.length };
    });
  }, [filtered]);

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
      const v = ds.filter((d) => d.stage === "closed" || d.stage === "contract");
      return {
        name: b.name,
        leads: ds.length,
        vendas: v.length,
        agil: ds.filter((d) => d.stage === "approved").length,
        neg: ds.filter((d) => !["lead", "incomplete"].includes(d.stage)).length,
        vgv: v.reduce((a, d) => a + (d.deal_value || 0), 0),
        off: ds.filter((d) => d.active === false).length,
      };
    });
    return rows.sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
  }, [brokers, filtered]);

  const cellGood = "bg-emerald-500/15 text-emerald-300";
  const cellWarn = "bg-amber-500/15 text-amber-300";
  const cellBad = "bg-rose-500/15 text-rose-300";
  const cellOf = (n: number, good = true) =>
    n > 0 ? (good ? cellGood : cellBad) : good ? cellBad : cellGood;

  const kpis = [
    { l: "Leads Gerados", v: leadsCount || 0, accent: "text-sky-400" },
    { l: "Propostas", v: stats.propostas, accent: "text-indigo-400" },
    { l: "Negócios", v: stats.negocios, accent: "text-amber-300", glow: true },
    { l: "OFF", v: stats.off, accent: "text-slate-300" },
    { l: "Vendas", v: stats.vendas, accent: "text-emerald-400" },
    { l: "VGV", v: brl(stats.vgv || 0), accent: "text-white", small: true },
    { l: "Meta", v: `${stats.pct}%`, accent: "text-[#4f46e5]", bar: stats.pct },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a1a] font-['DM_Sans'] text-slate-300 p-4 md:p-6 relative overflow-hidden">
      {/* Ambient indigo glows */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[#4f46e5]/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-[#1e1e5a]/30 blur-3xl" />

      <div className="relative max-w-[1500px] mx-auto space-y-6 animate-in fade-in duration-700">
        {/* Header */}
        <header className="flex items-end justify-between">
          <div>
            <h1 className={cn(display, "text-3xl font-bold text-white tracking-tight")}>
              Dashboard de Performance
            </h1>
            <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest">
              Acompanhamento em tempo real · {month === "all" ? "Todos os meses" : month}
            </p>
          </div>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[220px] bg-[#141432]/60 backdrop-blur-xl border border-[#1e1e5a] text-slate-200 rounded-xl">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent className="bg-[#141432] border-[#1e1e5a] text-slate-200">
              <SelectItem value="all">Todos os meses</SelectItem>
              {months.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </header>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {kpis.map((k, i) => (
            <div
              key={k.l}
              className={cn(
                panelGrad,
                "p-5 group hover:-translate-y-0.5 transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)]",
                k.glow && "ring-1 ring-amber-400/30",
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-[#4f46e5]/10 blur-3xl group-hover:bg-[#4f46e5]/25 transition-all" />
              <span className={cn("text-[10px] font-bold uppercase tracking-widest block mb-2", k.accent)}>{k.l}</span>
              <div className={cn(display, "font-bold text-white", k.small ? "text-lg" : "text-2xl")}>{k.v}</div>
              {k.bar !== undefined && (
                <div className="mt-3 h-1 w-full bg-[#0a0a1a] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4f46e5] rounded-full shadow-[0_0_10px_#4f46e5] transition-all duration-1000"
                    style={{ width: `${Math.min(100, k.bar)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Vendas / Propostas / Metas */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <PanelTable title="Vendas" subtitle="Por construtora">
            <thead>
              <tr className={headerCell}>
                <th className="px-5 py-3 text-left font-semibold">Construtora</th>
                <th className="px-5 py-3 font-semibold">Qtd</th>
                <th className="px-5 py-3 text-right font-semibold">VGV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e5a]/40">
              {byDev.map((r) => (
                <tr key={r.dev} className={rowHover}>
                  <td className="px-5 py-2.5 text-white text-sm font-medium">{r.dev}</td>
                  <td className="px-5 py-2.5 text-center text-sm">{r.vendas}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-sm text-[#4f46e5] font-semibold">{r.vgv > 0 ? brl(r.vgv) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </PanelTable>

          <PanelTable title="Propostas" subtitle="Pipeline ativo">
            <thead>
              <tr className={headerCell}>
                <th className="px-5 py-3 text-left font-semibold">Const.</th>
                <th className="px-5 py-3 font-semibold">Prop</th>
                <th className="px-5 py-3 font-semibold">Neg</th>
                <th className="px-5 py-3 text-right font-semibold">VGV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e5a]/40">
              {byDev.map((r) => (
                <tr key={r.dev} className={rowHover}>
                  <td className="px-5 py-2.5 text-white text-sm font-medium">{r.dev}</td>
                  <td className="px-5 py-2.5 text-center text-sm">{r.prop}</td>
                  <td className="px-5 py-2.5 text-center text-sm">{r.neg}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-sm">{r.propVgv > 0 ? brl(r.propVgv) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </PanelTable>

          <PanelTable title="Metas" subtitle="Atingimento">
            <thead>
              <tr className={headerCell}>
                <th className="px-5 py-3 text-left font-semibold">Const.</th>
                <th className="px-5 py-3 font-semibold">Meta</th>
                <th className="px-5 py-3 font-semibold">%</th>
                <th className="px-5 py-3 font-semibold">Vendido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e5a]/40">
              {byDev.map((r) => (
                <tr key={r.dev} className={rowHover}>
                  <td className="px-5 py-2.5 text-white text-sm font-medium">{r.dev}</td>
                  <td className="px-5 py-2.5 text-center text-sm">{r.meta}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.pctMeta >= 100 ? cellGood : r.pctMeta > 0 ? cellWarn : cellBad)}>{r.pctMeta}%</span>
                  </td>
                  <td className="px-5 py-2.5 text-center text-sm">{r.vendido}</td>
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
            <h3 className={cn(headerCell, "mb-5 font-bold")}>Origem dos Leads</h3>
            <div className="space-y-3">
              {SOURCES.map((s) => {
                const v = (sourceCounts as any)[s] ?? 0;
                const max = Math.max(...Object.values(sourceCounts).map(Number));
                const pct = max ? (v / max) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-300">{s}</span>
                      <span className="text-white font-bold tabular-nums">{v}</span>
                    </div>
                    <div className="h-1.5 bg-[#0a0a1a] rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-[#4f46e5] to-indigo-400 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className={cn(panel, "p-6")}>
            <h3 className={cn(headerCell, "mb-5 font-bold")}>Status CCA</h3>
            <div className="space-y-3">
              {CCA_STATUSES.map((s) => (
                <div key={s} className="flex items-center justify-between py-1.5 border-b border-[#1e1e5a]/40 last:border-0">
                  <span className="text-xs text-slate-400">{s}</span>
                  <span className="text-sm font-bold text-white tabular-nums">{ccaCounts[s] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={cn(panel, "p-6")}>
            <h3 className={cn(headerCell, "mb-5 font-bold text-amber-300")}>Staff</h3>
            <div className="space-y-2">
              {STAFF_ROWS.map(([l, v]) => (
                <div
                  key={l}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 rounded-lg",
                    l === "Total" ? "bg-gradient-to-r from-[#4f46e5]/30 to-transparent border border-[#4f46e5]/30" : "hover:bg-[#1e1e5a]/30 transition-colors",
                  )}
                >
                  <span className={cn("text-xs", l === "Total" ? "text-white font-bold uppercase tracking-wider" : "text-slate-300")}>{l}</span>
                  <span className={cn("tabular-nums font-bold", l === "Total" ? "text-white text-lg " + display : "text-sm text-white")}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ranking Geral */}
        <div className={cn(panel, "overflow-hidden")}>
          <div className="px-6 py-4 border-b border-[#1e1e5a] flex justify-between items-center bg-[#1e1e5a]/20">
            <h3 className={cn(display, "font-bold text-white")}>Ranking Geral</h3>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">{rankingGeral.length} corretores</span>
          </div>
          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#141432] backdrop-blur-xl">
                <tr className={cn(headerCell, "border-b border-[#1e1e5a]/50")}>
                  <th className="px-5 py-3 font-semibold">#</th>
                  <th className="px-5 py-3 text-left font-semibold">Corretor</th>
                  <th className="px-5 py-3 font-semibold">Leads</th>
                  <th className="px-5 py-3 font-semibold">Vendas</th>
                  <th className="px-5 py-3 font-semibold">Ágil</th>
                  <th className="px-5 py-3 font-semibold">Neg.</th>
                  <th className="px-5 py-3 text-right font-semibold">VGV</th>
                  <th className="px-5 py-3 font-semibold">Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1e1e5a]/30">
                {rankingGeral.map((r, i) => (
                  <tr key={i} className={rowHover}>
                    <td className="px-5 py-2.5 text-center">
                      <span className={cn(display, "font-bold", i < 3 ? "text-[#4f46e5]" : "text-slate-500")}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-indigo-900/50 border border-indigo-700/50 flex items-center justify-center text-[10px] font-bold text-indigo-100">
                          {r.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <span className="text-white font-medium">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.leads))}>{r.leads}</span>
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.vendas))}>{r.vendas}</span>
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.agil))}>{r.agil}</span>
                    </td>
                    <td className="px-5 py-2.5 text-center">
                      <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", cellOf(r.neg))}>{r.neg}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-white font-semibold">{r.vgv > 0 ? brl(r.vgv) : "—"}</td>
                    <td className="px-5 py-2.5 text-center">
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
    <div className={cn(panel, "overflow-hidden")}>
      <div className="px-5 py-4 border-b border-[#1e1e5a] flex items-end justify-between bg-[#1e1e5a]/20">
        <h3 className={cn(display, "font-bold text-white text-sm")}>{title}</h3>
        {subtitle && <span className="text-[10px] uppercase tracking-widest text-slate-500">{subtitle}</span>}
      </div>
      <table className="w-full">{children}</table>
    </div>
  );
}

function RankCard({ title, rows, kind }: { title: string; rows: any[]; kind: string }) {
  const cellGood = "bg-emerald-500/15 text-emerald-300";
  const cellWarn = "bg-amber-500/15 text-amber-300";
  const cellBad = "bg-rose-500/15 text-rose-300";
  return (
    <div className={cn(panel, "overflow-hidden")}>
      <div className="px-6 py-4 border-b border-[#1e1e5a] flex justify-between items-center bg-[#1e1e5a]/20">
        <h3 className={cn(display, "font-bold text-white")}>{title}</h3>
        <span className="px-2 py-0.5 rounded-md bg-[#4f46e5]/20 text-[#a5a3f0] text-[10px] font-bold uppercase tracking-widest">{rows.length} {kind}s</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-[#1e1e5a]/50">
            <tr>
              <th className="px-5 py-3 font-semibold">Sem Compras</th>
              <th className="px-5 py-3 font-semibold">Meta</th>
              <th className="px-5 py-3 font-semibold">% Atingida</th>
              <th className="px-5 py-3 text-left font-semibold">{kind}</th>
              <th className="px-5 py-3 font-semibold">Leads</th>
              <th className="px-5 py-3 font-semibold">Ágil</th>
              <th className="px-5 py-3 font-semibold">Neg.</th>
              <th className="px-5 py-3 font-semibold">Vendas</th>
              <th className="px-5 py-3 text-right font-semibold">VGV</th>
              <th className="px-5 py-3 font-semibold">Off</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1e1e5a]/30">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-[#4f46e5]/5 transition-colors">
                <td className="px-5 py-2.5 text-center">
                  <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.sem > 0 ? cellWarn : cellGood)}>{r.sem}</span>
                </td>
                <td className="px-5 py-2.5 text-center text-white">{r.meta}</td>
                <td className="px-5 py-2.5 text-center">
                  <span className={cn("inline-block px-2 py-0.5 rounded-md text-xs font-bold", r.pct >= 100 ? cellGood : r.pct >= 50 ? cellWarn : cellBad)}>{r.pct}%</span>
                </td>
                <td className="px-5 py-2.5 text-white font-medium">{r.name}</td>
                <td className="px-5 py-2.5 text-center">{r.leads}</td>
                <td className="px-5 py-2.5 text-center">{r.agil}</td>
                <td className="px-5 py-2.5 text-center">{r.neg}</td>
                <td className="px-5 py-2.5 text-center">
                  <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-500/15 text-emerald-300">{r.vendas}</span>
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#4f46e5] font-semibold">{r.vgv > 0 ? brl(r.vgv) : "—"}</td>
                <td className="px-5 py-2.5 text-center">
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
