import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { PipelineDeal } from "@/types/crm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";
import { Trophy, Crown, Medal } from "lucide-react";

export default function Dashboard() {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [brokers, setBrokers] = useState<{ id: string; name: string; team?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState<string>("all");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [dealsRes, brokersRes] = await Promise.all([
          supabase.from('deals').select(`
            *,
            broker1:brokers!deals_broker1_id_fkey(name),
            broker2:brokers!deals_broker2_id_fkey(name)
          `),
          supabase.from('brokers').select('id, name')
        ]);

        if (dealsRes.error) throw dealsRes.error;
        if (brokersRes.error) throw brokersRes.error;

        const mappedDeals: PipelineDeal[] = (dealsRes.data || []).map(d => ({
          ...d,
          broker1: (d.broker1 as any)?.name || '',
          broker2: (d.broker2 as any)?.name || undefined,
        })) as any[];

        setDeals(mappedDeals);
        setBrokers(brokersRes.data || []);
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const stats = useMemo(() => {
    const leads = deals.filter(d => d.stage === 'lead').length;
    const propostas = deals.filter(d => d.stage === 'proposal').length;
    const negocios = deals.filter(d => d.active).length;
    const off = deals.filter(d => !d.active).length;
    const vendas = deals.filter(d => d.stage === 'closed' && d.active).length;
    const vgv = deals.filter(d => d.active).reduce((acc, d) => acc + (d.deal_value || 0), 0);
    
    // Construtora breakdown
    const construtoraMap: Record<string, { unidades: number; vgv: number; propostas: number; negocios: number }> = {};
    deals.forEach(d => {
      const dev = d.developer || 'N/A';
      if (!construtoraMap[dev]) construtoraMap[dev] = { unidades: 0, vgv: 0, propostas: 0, negocios: 0 };
      if (d.stage === 'closed' && d.active) {
        construtoraMap[dev].unidades++;
        construtoraMap[dev].vgv += (d.deal_value || 0);
      }
      if (d.stage === 'proposal') construtoraMap[dev].propostas++;
      if (d.active) construtoraMap[dev].negocios++;
    });

    const vendasTable = Object.entries(construtoraMap)
      .filter(([_, v]) => v.unidades > 0)
      .map(([k, v]) => ({ construtora: k, unidades: v.unidades, vgv: v.vgv }))
      .sort((a, b) => b.unidades - a.unidades);

    const propostasTable = Object.entries(construtoraMap)
      .filter(([_, v]) => v.propostas > 0)
      .map(([k, v]) => ({ const: k, prop: v.propostas, neg: v.negocios, vgv: v.vgv }))
      .sort((a, b) => b.prop - a.prop);

    // Broker ranking
    const brokerStats: Record<string, { name: string; leads: number; agil: number; neg: number; vendas: number; vgv: number; off: number }> = {};
    brokers.forEach(b => {
      brokerStats[b.name] = { name: b.name, leads: 0, agil: 0, neg: 0, vendas: 0, vgv: 0, off: 0 };
    });

    deals.forEach(d => {
      const bNames = [d.broker1, d.broker2].filter(Boolean) as string[];
      bNames.forEach(name => {
        if (!brokerStats[name]) brokerStats[name] = { name, leads: 0, agil: 0, neg: 0, vendas: 0, vgv: 0, off: 0 };
        if (d.stage === 'lead') brokerStats[name].leads++;
        if (d.stage === 'under_analysis') brokerStats[name].agil++;
        if (d.active) brokerStats[name].neg++;
        if (d.stage === 'closed' && d.active) {
          brokerStats[name].vendas++;
          brokerStats[name].vgv += (d.deal_value || 0);
        }
        if (!d.active) brokerStats[name].off++;
      });
    });

    const generalRanking = Object.values(brokerStats)
      .sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv)
      .slice(0, 10);

    return { leads, propostas, negocios, off, vendas, vgv, vendasTable, propostasTable, generalRanking };
  }, [deals, brokers]);

  const summaryMetrics = [
    { label: "Leads Gerados", value: stats.leads.toString() },
    { label: "Propostas", value: stats.propostas.toString() },
    { label: "Negócios", value: stats.negocios.toString() },
    { label: "OFF", value: stats.off.toString() },
    { label: "Vendas", value: stats.vendas.toString() },
  ];

  const vgvValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.vgv);
  const metaMetric = { label: "Meta", value: "80", percent: Math.round((stats.vendas / 80) * 100) };

  return (
    <div className="min-h-screen bg-[#020617] text-white p-4 space-y-6">
      {/* ── TOP SUMMARY CARDS ── */}
      <div className="flex flex-wrap items-stretch justify-center gap-2">
        {summaryMetrics.map((m) => (
          <div key={m.label} className="bg-[#1e1b4b] border border-white/5 rounded-md px-6 py-4 text-center flex flex-col justify-center min-w-[120px]">
            <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">{m.label}</span>
            <span className="text-3xl font-bold">{m.value}</span>
          </div>
        ))}
        
        <div className="bg-[#1e1b4b] border border-white/5 rounded-md px-10 py-4 text-center flex flex-col justify-center min-w-[280px]">
          <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">VGV</span>
          <span className="text-3xl font-bold text-white tracking-tight">{vgvValue}</span>
        </div>

        <div className="bg-[#1e1b4b] border border-white/5 rounded-md px-6 py-4 text-center flex flex-col justify-center min-w-[150px]">
          <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">{metaMetric.label}</span>
          <span className="text-3xl font-bold">{metaMetric.value}</span>
          <div className="mt-2 space-y-1">
            <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
              <div 
                className="bg-primary h-full rounded-full" 
                style={{ width: `${metaMetric.percent}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-400 uppercase font-bold">Meta Atingida %</span>
            <span className="block text-[10px] font-bold">{metaMetric.percent}%</span>
          </div>
        </div>
      </div>

      {/* ── MIDDLE ROW: Vendas, Propostas, Metas ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Vendas */}
        <Card className="bg-[#1e1b4b] border-white/5 overflow-hidden">
          <CardHeader className="py-2 px-4 bg-[#312e81]/30 border-b border-white/5">
            <CardTitle className="text-xs font-bold text-white uppercase text-center">Vendas</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[220px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#1e1b4b] text-gray-400 font-bold border-b border-white/5">
                <tr>
                  <th className="p-2 text-left">Construtora</th>
                  <th className="p-2 text-center">Unidade</th>
                  <th className="p-2 text-right">VGV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.vendasTable.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-medium">{row.construtora}</td>
                    <td className="p-2 text-center font-bold text-blue-400">{row.unidades}</td>
                    <td className="p-2 text-right text-gray-300">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(row.vgv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Propostas */}
        <Card className="bg-[#1e1b4b] border-white/5 overflow-hidden">
          <CardHeader className="py-2 px-4 bg-[#312e81]/30 border-b border-white/5">
            <CardTitle className="text-xs font-bold text-white uppercase text-center">Propostas</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[220px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#1e1b4b] text-gray-400 font-bold border-b border-white/5">
                <tr>
                  <th className="p-2 text-left">Const.</th>
                  <th className="p-2 text-center">Prop.</th>
                  <th className="p-2 text-center">Neg.</th>
                  <th className="p-2 text-right">VGV</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.propostasTable.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-medium">{row.const}</td>
                    <td className="p-2 text-center font-bold text-blue-400">{row.prop}</td>
                    <td className="p-2 text-center font-bold text-cyan-400">{row.neg}</td>
                    <td className="p-2 text-right text-gray-300">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(row.vgv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Metas */}
        <Card className="bg-[#1e1b4b] border-white/5 overflow-hidden">
          <CardHeader className="py-2 px-4 bg-[#312e81]/30 border-b border-white/5">
            <CardTitle className="text-xs font-bold text-white uppercase text-center">Metas</CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[220px] overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#1e1b4b] text-gray-400 font-bold border-b border-white/5">
                <tr>
                  <th className="p-2 text-left">Construtora</th>
                  <th className="p-2 text-center">Meta</th>
                  <th className="p-2 text-center">%</th>
                  <th className="p-2 text-right">Obtido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.vendasTable.slice(0, 5).map((row, i) => {
                  const meta = 24;
                  const pct = Math.round((row.unidades / meta) * 100);
                  return (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-2 font-medium">{row.construtora}</td>
                      <td className="p-2 text-center font-bold">{meta}</td>
                      <td className="p-2 text-center">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold text-white",
                          pct >= 50 ? "bg-amber-600" : "bg-red-600"
                        )}>
                          {pct}%
                        </span>
                      </td>
                      <td className="p-2 text-right font-bold text-blue-400">{row.unidades}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── RANKING TABLES ── */}
      <div className="space-y-4">
        {/* Ranking de Gerentes */}
        <Card className="bg-[#1e1b4b] border-white/5 overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-[11px]">
              <thead className="bg-[#1e1b4b] text-[#fbbf24] font-bold border-b border-white/5 uppercase">
                <tr>
                  <th className="p-2 text-center whitespace-nowrap font-black">#</th>
                  <th className="p-2 text-left min-w-[120px] font-black text-gray-300">Ranking Geral</th>
                  <th className="p-2 text-center font-black">Leads</th>
                  <th className="p-2 text-center font-black">Visitas</th>
                  <th className="p-2 text-center font-black">Agil</th>
                  <th className="p-2 text-center font-black">Neg.</th>
                  <th className="p-2 text-center bg-green-900/20 font-black">Vendas</th>
                  <th className="p-2 text-right bg-green-900/20 font-black">VGV</th>
                  <th className="p-2 text-center font-black">Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stats.generalRanking.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 text-center font-bold text-[#fbbf24]">{i + 1}º</td>
                    <td className="p-2 font-medium">{row.name}</td>
                    <td className="p-2 text-center">
                      <span className="bg-[#fbbf24] text-black px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.leads}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className="bg-gray-600 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">0</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className="bg-gray-600 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.agil}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className="bg-red-700 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.neg}</span>
                    </td>
                    <td className="p-2 text-center bg-green-900/20">
                      <span className="bg-green-600 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.vendas}</span>
                    </td>
                    <td className="p-2 text-right bg-green-900/20 font-bold text-green-400">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(row.vgv)}</td>
                    <td className="p-2 text-center font-bold text-gray-500">{row.off}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
