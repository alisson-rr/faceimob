import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { PipelineDeal } from "@/types/crm";

export default function Dashboard() {
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [brokers, setBrokers] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

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
                  const meta = 24; // Dummy meta per developer
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
        {/* Ranking de Diretores */}
        <Card className="bg-[#1e1b4b] border-white/5 overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-[11px]">
              <thead className="bg-[#1e1b4b] text-[#fbbf24] font-bold border-b border-white/5 uppercase">
                <tr>
                  <th className="p-2 text-center whitespace-nowrap font-black">Meta Remuneração</th>
                  <th className="p-2 text-center font-black">Meta</th>
                  <th className="p-2 text-center font-black">% batido</th>
                  <th className="p-2 text-left min-w-[120px] font-black">Diretor</th>
                  <th className="p-2 text-center font-black">Leads</th>
                  <th className="p-2 text-center font-black">Agil</th>
                  <th className="p-2 text-center font-black">Neg.</th>
                  <th className="p-2 text-center bg-green-900/20 font-black">Vendas</th>
                  <th className="p-2 text-right bg-green-900/20 font-black">VGV</th>
                  <th className="p-2 text-center font-black">Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {directorRanking.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 text-center font-bold">{row.metaRem}</td>
                    <td className="p-2 text-center font-bold">{row.meta}</td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-2 py-1 rounded-sm text-[10px] font-bold text-white block w-12 mx-auto",
                        row.pct >= 50 ? "bg-green-600" : "bg-yellow-600"
                      )}>
                        {row.pct}%
                      </span>
                    </td>
                    <td className="p-2 font-medium">{row.name}</td>
                    <td className="p-2 text-center">
                      <span className="bg-[#fbbf24] text-black px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.leads}</span>
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
                    <td className="p-2 text-right bg-green-900/20 font-bold text-green-400">{row.vgv}</td>
                    <td className="p-2 text-center font-bold text-gray-500">{row.off}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Ranking de Gerentes */}
        <Card className="bg-[#1e1b4b] border-white/5 overflow-hidden">
          <CardContent className="p-0">
            <table className="w-full text-[11px]">
              <thead className="bg-[#1e1b4b] text-[#fbbf24] font-bold border-b border-white/5 uppercase">
                <tr>
                  <th className="p-2 text-center whitespace-nowrap font-black">Meta Remuneração</th>
                  <th className="p-2 text-center font-black">Meta</th>
                  <th className="p-2 text-center font-black">% batido</th>
                  <th className="p-2 text-left min-w-[120px] font-black text-gray-300">Gerente</th>
                  <th className="p-2 text-center font-black">Leads</th>
                  <th className="p-2 text-center font-black">Agil</th>
                  <th className="p-2 text-center font-black">Neg.</th>
                  <th className="p-2 text-center bg-green-900/20 font-black">Vendas</th>
                  <th className="p-2 text-right bg-green-900/20 font-black">VGV</th>
                  <th className="p-2 text-center font-black">Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {managerRanking.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 text-center font-bold">{row.metaRem}</td>
                    <td className="p-2 text-center font-bold">{row.meta}</td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-2 py-1 rounded-sm text-[10px] font-bold text-white block w-12 mx-auto",
                        row.pct >= 100 ? "bg-green-600" : row.pct >= 30 ? "bg-red-600" : "bg-red-900"
                      )}>
                        {row.pct}%
                      </span>
                    </td>
                    <td className="p-2 font-medium">{row.name}</td>
                    <td className="p-2 text-center">
                      <span className="bg-red-700 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.leads}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className="bg-gray-600 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.agil}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className="bg-gray-800 text-gray-500 px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.neg}</span>
                    </td>
                    <td className="p-2 text-center bg-green-900/20">
                      <span className="bg-green-600 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.vendas}</span>
                    </td>
                    <td className="p-2 text-right bg-green-900/20 font-bold text-green-400">{row.vgv}</td>
                    <td className="p-2 text-center font-bold text-gray-500">{row.off}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── NEW SECTION FROM SECOND IMAGE ── */}
      <div className="space-y-6 pt-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Origem dos Leads */}
          <Card className="bg-[#1e1b4b] border-white/10">
            <CardHeader className="py-2">
              <CardTitle className="text-center text-amber-500 text-sm font-bold">Origem dos Leads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {leadSources.map((item) => (
                <div key={item.label} className="flex justify-between items-center py-1 border-b border-white/5 last:border-0">
                  <span className="text-gray-300">{item.label}</span>
                  <span className="font-bold">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Status CCA */}
          <Card className="bg-[#1e1b4b] border-white/10">
            <CardHeader className="py-2">
              <CardTitle className="text-center text-amber-500 text-sm font-bold">Status CCA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs">
              {ccaStatus.map((item) => (
                <div key={item.label} className="flex justify-between items-center py-1 border-b border-white/5 last:border-0">
                  <span className={cn("font-medium", item.color)}>{item.label}</span>
                  <span className="font-bold">{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Período e Staff */}
        <div className="flex flex-col items-center space-y-4">
          <div className="text-center">
            <p className="text-xs font-bold text-gray-300 mb-2">Escolher Período</p>
            <div className="bg-[#312e81] px-8 py-2 rounded-md text-sm font-bold">
              04/2026 , 04/2026
            </div>
          </div>

          {/* Staff Card */}
          <Card className="bg-[#1e1b4b] border-white/10 w-full max-w-sm">
            <CardHeader className="py-2">
              <CardTitle className="text-center text-amber-500 text-sm font-bold">Staff</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-4 pb-2 space-y-1 text-xs">
                {staffData.map((item) => (
                  <div key={item.label} className="flex justify-between items-center py-1 border-b border-white/5 last:border-0">
                    <span className={cn("text-gray-300", item.color)}>{item.label}</span>
                    <span className="font-bold">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-xs">
                {staffSummary.map((item) => (
                  <div key={item.label} className={cn("flex justify-between items-center px-4 py-1.5 font-bold", item.bgColor)}>
                    <span>{item.label}</span>
                    <span>{item.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Ranking Geral */}
        <Card className="bg-[#1e1b4b] border-white/10 overflow-hidden">
          <CardHeader className="py-3 bg-[#1e1b4b] border-b border-white/5">
            <CardTitle className="text-center text-amber-500 text-sm font-bold">Ranking Geral</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-[#312e81]/50 text-white font-bold border-b border-white/10">
                <tr>
                  <th className="p-2 text-left"></th>
                  <th className="p-2 text-left">Corretor</th>
                  <th className="p-2 text-center">Leads</th>
                  <th className="p-2 text-center">Visitas</th>
                  <th className="p-2 text-center">Agil</th>
                  <th className="p-2 text-center">Neg.</th>
                  <th className="p-2 text-center bg-green-900/20">Vendas</th>
                  <th className="p-2 text-right bg-green-900/20">VGV</th>
                  <th className="p-2 text-center">Off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {generalRanking.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 text-left font-bold text-gray-400">{row.pos}</td>
                    <td className="p-2 font-medium">{row.name}</td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block",
                        row.leads > 0 ? "bg-red-700 text-white" : "bg-transparent text-gray-500"
                      )}>{row.leads}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block",
                        row.visitas > 0 ? "bg-red-700 text-white" : "bg-transparent text-gray-500"
                      )}>{row.visitas}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block",
                        row.agil > 0 ? "bg-red-700 text-white" : "bg-transparent text-gray-500"
                      )}>{row.agil}</span>
                    </td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block",
                        row.neg > 0 ? "bg-red-700 text-white" : "bg-transparent text-gray-500"
                      )}>{row.neg}</span>
                    </td>
                    <td className="p-2 text-center bg-green-900/20">
                      <span className="bg-green-600 text-white px-2 py-0.5 rounded-sm font-bold min-w-[30px] inline-block">{row.vendas}</span>
                    </td>
                    <td className="p-2 text-right bg-green-900/20 font-bold text-green-400">{row.vgv}</td>
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
