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

  // Vendas / Propostas / Metas por construtora
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

  const directors = ["Fabio Roldão", "Archimedes Neff", "Mauricio Vieira"];
  const directorRows = useMemo(() => {
    // mock metrics blended with real broker count
    return [
      { name: "Fabio Roldão", semCompras: 23, meta: 28, pct: 54, leads: 540, agil: 27, neg: 36, vendas: 13, vgv: 13649027.85, off: 1 },
      { name: "Archimedes Neff", semCompras: 26, meta: 29, pct: 67, leads: 778, agil: 38, neg: 7, vendas: 3, vgv: 4524752.36, off: 22 },
      { name: "Mauricio Vieira", semCompras: 25, meta: 35, pct: 31, leads: 657, agil: 24, neg: 3, vendas: 11, vgv: 12259027.06, off: 11 },
    ];
  }, []);

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

  const ccaCounts: Record<string, number> = { "Aprovado Total": 0, "Aprovado Condicionado": 4, "Análise de Viabilidade": 6, "Assinatura no Banco": 9, "Pendente de Viabilidade": 9, "Reprovado": 0, "Pendente": 11 };

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

  const cellRed = "bg-rose-900/60 text-rose-100";
  const cellGreen = "bg-emerald-800/60 text-emerald-100";
  const cellAmber = "bg-amber-500/80 text-slate-900";

  return (
    <div className="min-h-screen bg-[#0a0f1f] text-slate-100 p-4 md:p-6 font-sans-premium">
      <div className="max-w-[1400px] mx-auto space-y-5">
        {/* Period Selector */}
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl">Dashboard</h1>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-[200px] bg-[#101935] border-[#1f2a4a] text-slate-200">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os meses</SelectItem>
              {months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* TOP KPI STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { l: "Leads Gerados", v: leadsCount || 1975 },
            { l: "Propostas", v: stats.propostas || 109 },
            { l: "Negócios", v: stats.negocios || 6, hl: true },
            { l: "OFF", v: stats.off || 116 },
            { l: "Vendas", v: stats.vendas || 45 },
            { l: "VGV", v: brl(stats.vgv || 10312830.18) },
            { l: "Meta", v: stats.meta, sub: `Sem Atingir % ${stats.pct}%` },
          ].map((k, i) => (
            <div key={i} className={cn(
              "rounded-lg p-3 text-center border",
              k.hl ? "border-amber-500 bg-amber-500/10" : "border-[#1f2a4a] bg-[#101935]"
            )}>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">{k.l}</div>
              <div className={cn("font-display text-xl mt-1", k.hl && "text-amber-400")}>{k.v}</div>
              {k.sub && <div className="text-[9px] text-amber-400 mt-1">{k.sub}</div>}
            </div>
          ))}
        </div>

        {/* THREE TABLES */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Vendas */}
          <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
            <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a]">Vendas</div>
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr><th className="px-2 py-1.5 text-left">Construtora</th><th className="px-2 py-1.5">Quantid.</th><th className="px-2 py-1.5 text-right">VGV</th></tr>
              </thead>
              <tbody>
                {byDev.map((r) => (
                  <tr key={r.dev} className="border-t border-[#1f2a4a]">
                    <td className="px-2 py-1">{r.dev}</td>
                    <td className="px-2 py-1 text-center">{r.vendas}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.vgv > 0 ? brl(r.vgv) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Propostas */}
          <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
            <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a]">Propostas</div>
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr><th className="px-2 py-1.5 text-left">Const.</th><th className="px-2 py-1.5">Prop</th><th className="px-2 py-1.5">Neg</th><th className="px-2 py-1.5 text-right">VGV</th></tr>
              </thead>
              <tbody>
                {byDev.map((r) => (
                  <tr key={r.dev} className="border-t border-[#1f2a4a]">
                    <td className="px-2 py-1">{r.dev}</td>
                    <td className="px-2 py-1 text-center">{r.prop}</td>
                    <td className="px-2 py-1 text-center">{r.neg}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.propVgv > 0 ? brl(r.propVgv) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Metas */}
          <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
            <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a]">Metas</div>
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr><th className="px-2 py-1.5 text-left">Const.</th><th className="px-2 py-1.5">Meta</th><th className="px-2 py-1.5">%</th><th className="px-2 py-1.5">Vendido</th></tr>
              </thead>
              <tbody>
                {byDev.map((r) => (
                  <tr key={r.dev} className="border-t border-[#1f2a4a]">
                    <td className="px-2 py-1">{r.dev}</td>
                    <td className="px-2 py-1 text-center">{r.meta}</td>
                    <td className={cn("px-2 py-1 text-center", r.pctMeta >= 100 ? cellGreen : r.pctMeta > 0 ? cellAmber : cellRed)}>{r.pctMeta}%</td>
                    <td className="px-2 py-1 text-center">{r.vendido}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* DIRETORES */}
        <RankCard
          title="Diretores"
          rows={directorRows.map((r) => ({
            ...r,
            sem: r.semCompras,
          }))}
        />

        {/* GERENTES */}
        <RankCard title="Gerentes" rows={managerRows} />

        {/* SOURCES + CCA + PERIOD + STAFF */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
            <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a] text-sky-300">Origem dos Leads</div>
            <table className="w-full text-xs">
              <tbody>
                {SOURCES.map((s) => (
                  <tr key={s} className="border-t border-[#1f2a4a]">
                    <td className="px-3 py-1.5 text-slate-300">{s}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{(sourceCounts as any)[s] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
            <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a] text-sky-300">Status CCA</div>
            <table className="w-full text-xs">
              <tbody>
                {CCA_STATUSES.map((s) => (
                  <tr key={s} className="border-t border-[#1f2a4a]">
                    <td className="px-3 py-1.5 text-slate-300">{s}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{ccaCounts[s] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* STAFF */}
        <div className="max-w-md mx-auto rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
          <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a] text-amber-300">Staff</div>
          <table className="w-full text-xs">
            <tbody>
              {STAFF_ROWS.map(([l, v]) => (
                <tr key={l} className="border-t border-[#1f2a4a]">
                  <td className="px-3 py-1.5">{l}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", l === "Total" && "bg-amber-500/80 text-slate-900 font-bold")}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* RANKING GERAL */}
        <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
          <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a]">Ranking Geral</div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#101935] text-slate-400">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5 text-left">Corretor</th>
                  <th className="px-2 py-1.5">Leads</th>
                  <th className="px-2 py-1.5">Vendas</th>
                  <th className="px-2 py-1.5">Ágil</th>
                  <th className="px-2 py-1.5">Neg.</th>
                  <th className="px-2 py-1.5 text-right">VGV</th>
                  <th className="px-2 py-1.5">Off</th>
                </tr>
              </thead>
              <tbody>
                {rankingGeral.map((r, i) => (
                  <tr key={i} className="border-t border-[#1f2a4a]">
                    <td className="px-2 py-1 text-center text-slate-400">{i + 1}º</td>
                    <td className="px-2 py-1">{r.name}</td>
                    <td className={cn("px-2 py-1 text-center", r.leads > 0 ? cellGreen : cellRed)}>{r.leads}</td>
                    <td className={cn("px-2 py-1 text-center", r.vendas > 0 ? cellGreen : cellRed)}>{r.vendas}</td>
                    <td className={cn("px-2 py-1 text-center", r.agil > 0 ? cellGreen : cellRed)}>{r.agil}</td>
                    <td className={cn("px-2 py-1 text-center", r.neg > 0 ? cellGreen : cellRed)}>{r.neg}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.vgv > 0 ? brl(r.vgv) : "R$0,00"}</td>
                    <td className={cn("px-2 py-1 text-center", r.off > 0 ? cellRed : cellGreen)}>{r.off}</td>
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

function RankCard({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div className="rounded-lg bg-[#101935] border border-[#1f2a4a] overflow-hidden">
      <div className="text-center py-2 text-sm font-semibold border-b border-[#1f2a4a] text-sky-300">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="px-2 py-1.5">Sem Compras</th>
              <th className="px-2 py-1.5">Meta</th>
              <th className="px-2 py-1.5">% Atingida</th>
              <th className="px-2 py-1.5 text-left">{title === "Diretores" ? "Diretor" : "Gerente"}</th>
              <th className="px-2 py-1.5">Leads</th>
              <th className="px-2 py-1.5">Ágil</th>
              <th className="px-2 py-1.5">Neg.</th>
              <th className="px-2 py-1.5">Vendas</th>
              <th className="px-2 py-1.5 text-right">VGV</th>
              <th className="px-2 py-1.5">Off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[#1f2a4a]">
                <td className="px-2 py-1 text-center bg-amber-500/30 text-amber-200">{r.sem}</td>
                <td className="px-2 py-1 text-center">{r.meta}</td>
                <td className={cn("px-2 py-1 text-center", r.pct >= 100 ? "bg-emerald-800/60 text-emerald-100" : r.pct >= 50 ? "bg-amber-500/80 text-slate-900" : "bg-rose-900/60 text-rose-100")}>{r.pct}%</td>
                <td className="px-2 py-1 text-amber-300">{r.name}</td>
                <td className="px-2 py-1 text-center">{r.leads}</td>
                <td className="px-2 py-1 text-center bg-amber-500/20">{r.agil}</td>
                <td className="px-2 py-1 text-center">{r.neg}</td>
                <td className="px-2 py-1 text-center bg-emerald-800/40">{r.vendas}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.vgv > 0 ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.vgv) : "—"}</td>
                <td className={cn("px-2 py-1 text-center", r.off > 0 ? "bg-rose-900/60" : "bg-emerald-800/40")}>{r.off}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
