import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// ── Data from Image ──
const summaryMetrics = [
  { label: "Leads Gerados", value: "2611" },
  { label: "Propostas", value: "121" },
  { label: "Negócios", value: "6" },
  { label: "OFF", value: "222" },
  { label: "Vendas", value: "45" },
];

const vgvMetric = { label: "VGV", value: "R$10.001.401,37" };
const metaMetric = { label: "Meta", value: "80", percent: 57 };

const vendasData = [
  { construtora: "VASCO", unidades: 14, vgv: "R$2.354.000,00" },
  { construtora: "TENDA", unidades: 12, vgv: "R$2.315.433,31" },
  { construtora: "MORANA", unidades: 4, vgv: "R$935.000,00" },
  { construtora: "MC3", unidades: 3, vgv: "R$803.000,00" },
  { construtora: "LYX", unidades: 2, vgv: "R$435.000,00" },
  { construtora: "MRV", unidades: 2, vgv: "R$499.600,00" },
  { construtora: "LOTUS", unidades: 2, vgv: "R$399.800,00" },
  { construtora: "ABACO", unidades: 2, vgv: "R$159.617,54" },
];

const propostasData = [
  { const: "TENDA", prop: 64, neg: 2, vgv: "R$400.000,00" },
  { const: "VASCO", prop: 28, neg: 4, vgv: "R$600.000,00" },
  { const: "MC3", prop: 11, neg: 0, vgv: "R$0,00" },
  { const: "LYX", prop: 8, neg: 0, vgv: "R$0,00" },
  { const: "SOUTH", prop: 2, neg: 0, vgv: "R$0,00" },
  { const: "BOLOGNE", prop: 2, neg: 0, vgv: "R$0,00" },
  { const: "MELNICK", prop: 2, neg: 0, vgv: "R$0,00" },
  { const: "APICE", prop: 2, neg: 0, vgv: "R$0,00" },
  { const: "LOTUS", prop: 1, neg: 0, vgv: "R$0,00" },
];

const metasData = [
  { construtora: "TENDA", meta: 24, pct: 58, obtido: 12 },
  { construtora: "VASCO", meta: 24, pct: 59, obtido: 14 },
  { construtora: "MC3", meta: 9, pct: 34, obtido: 3 },
  { construtora: "MRV", meta: 9, pct: 23, obtido: 2 },
  { construtora: "LYX", meta: 15, pct: 14, obtido: 2 },
];

const directorRanking = [
  { metaRem: 25, meta: 20, pct: 50, name: "Fabio Batista", leads: 638, agil: 54, neg: 3, vendas: 14, vgv: "R$3.038.252,71", off: 66 },
  { metaRem: 25, meta: 31, pct: 39, name: "Archimedes Boff", leads: 805, agil: 40, neg: 2, vendas: 12, vgv: "R$2.926.120,23", off: 79 },
  { metaRem: 20, meta: 23, pct: 58, name: "Mauricio Vieira", leads: 938, agil: 21, neg: 0, vendas: 16, vgv: "R$3.236.028,43", off: 72 },
];

const managerRanking = [
  { metaRem: 8, meta: 8, pct: 138, name: "Leonardo Valter", leads: 357, agil: 11, neg: 0, vendas: 11, vgv: "R$2.385.710,47", off: 28 },
  { metaRem: 8, meta: 8, pct: 100, name: "Victor Rafael", leads: 352, agil: 27, neg: 0, vendas: 8, vgv: "R$1.736.777,99", off: 46 },
  { metaRem: 8, meta: 8, pct: 50, name: "Jose Portilho", leads: 300, agil: 5, neg: 1, vendas: 4, vgv: "R$1.101.900,10", off: 23 },
  { metaRem: 8, meta: 8, pct: 38, name: "Alexandre Chaves", leads: 99, agil: 7, neg: 0, vendas: 3, vgv: "R$662.551,43", off: 10 },
  { metaRem: 8, meta: 8, pct: 38, name: "Alisson Luiz", leads: 513, agil: 8, neg: 0, vendas: 3, vgv: "R$690.700,32", off: 31 },
  { metaRem: 8, meta: 8, pct: 38, name: "Daiane Dias", leads: 124, agil: 4, neg: 1, vendas: 3, vgv: "R$629.474,72", off: 8 },
  { metaRem: 8, meta: 8, pct: 13, name: "Susana Cristina", leads: 263, agil: 4, neg: 1, vendas: 1, vgv: "R$240.500,00", off: 20 },
  { metaRem: 8, meta: 8, pct: 0, name: "Veronica Oliveira", leads: 17, agil: 2, neg: 0, vendas: 0, vgv: "R$0,00", off: 2 },
];
64: 
65: const leadSources = [
66:   { label: "Leadfy", value: 5 },
67:   { label: "Lead Próprio", value: 31 },
68:   { label: "Lead Loja", value: 2 },
69:   { label: "Lead Feirão", value: 1 },
70:   { label: "Lead Indicação", value: 6 },
71: ];
72: 
73: const ccaStatus = [
74:   { label: "Aprovado Total", value: 42, color: "text-blue-400" },
75:   { label: "Aprovado Condicionado", value: 6, color: "text-blue-500" },
76:   { label: "Análise p/ virar Negócio", value: 0, color: "text-green-500" },
77:   { label: "Assinado no Banco", value: 0, color: "text-blue-400" },
78:   { label: "Pendente p/ virar negócio", value: 0, color: "text-amber-500" },
79:   { label: "Pendente", value: 29, color: "text-amber-600" },
80: ];
81: 
82: const staffData = [
83:   { label: "Sócios", value: 2 },
84:   { label: "Adm", value: 1 },
85:   { label: "Administrativo", value: 6 },
86:   { label: "Diretor", value: 5 },
87:   { label: "Gerentes", value: 9 },
88:   { label: "Corretores Ativos", value: 80, color: "text-green-500" },
89:   { label: "Serviços Gerais", value: 1 },
90: ];
91: 
92: const staffSummary = [
93:   { label: "Total", value: 100, bgColor: "bg-[#1e1b4b]" },
94:   { label: "Corretores com Vendas", value: 26, bgColor: "bg-green-600" },
95:   { label: "Corretores sem Vendas", value: 54, bgColor: "bg-red-600" },
96:   { label: "% Corretores com Vendas", value: "33 %", bgColor: "bg-amber-500" },
97: ];
98: 
99: const generalRanking = [
100:   { pos: "1°", name: "Junior Moraes", leads: 70, visitas: 0, agil: 4, neg: 0, vendas: 5, vgv: "R$1.110.513,08", off: 15 },
101:   { pos: "2°", name: "Leonardo Vallier", leads: 57, visitas: 0, agil: 3, neg: 0, vendas: 4, vgv: "R$894.896,80", off: 14 },
102:   { pos: "3°", name: "Gabriel Dutra", leads: 10, visitas: 0, agil: 7, neg: 0, vendas: 4, vgv: "R$855.300,00", off: 12 },
103:   { pos: "4°", name: "Parceiro Externo", leads: 0, visitas: 0, agil: 4, neg: 0, vendas: 3, vgv: "R$801.000,00", off: 5 },
104:   { pos: "5°", name: "Kayteane Botelho Araujo", leads: 0, visitas: 0, agil: 4, neg: 0, vendas: 2, vgv: "R$483.000,00", off: 3 },
105: ];

export default function Dashboard() {
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
          <span className="text-[10px] text-gray-400 uppercase font-bold mb-1">{vgvMetric.label}</span>
          <span className="text-3xl font-bold text-white tracking-tight">{vgvMetric.value}</span>
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
                {vendasData.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-medium">{row.construtora}</td>
                    <td className="p-2 text-center font-bold text-blue-400">{row.unidades}</td>
                    <td className="p-2 text-right text-gray-300">{row.vgv}</td>
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
                {propostasData.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-medium">{row.const}</td>
                    <td className="p-2 text-center font-bold text-blue-400">{row.prop}</td>
                    <td className="p-2 text-center font-bold text-cyan-400">{row.neg}</td>
                    <td className="p-2 text-right text-gray-300">{row.vgv}</td>
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
                {metasData.map((row, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="p-2 font-medium">{row.construtora}</td>
                    <td className="p-2 text-center font-bold">{row.meta}</td>
                    <td className="p-2 text-center">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-bold text-white",
                        row.pct >= 50 ? "bg-amber-600" : "bg-red-600"
                      )}>
                        {row.pct}%
                      </span>
                    </td>
                    <td className="p-2 text-right font-bold text-blue-400">{row.obtido}</td>
                  </tr>
                ))}
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
    </div>
  );
}
