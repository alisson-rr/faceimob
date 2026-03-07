import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Trophy, Filter, RefreshCw, Brain, TrendingUp, MessageSquare, Send, Lightbulb, Target, Zap, Bell, Activity, Radio } from "lucide-react";
import { mockDeals, mockLeads } from "@/data/mockData";
import { generateInsights, generateForecast, generateFollowUps, generateAlerts, analyzeBrokers, askAssistant } from "@/lib/aiAnalytics";
import { generatePipelineAlerts, calculateSourceMetrics } from "@/lib/automationEngine";
import { motion, AnimatePresence } from "framer-motion";

// ── Construtora colors ──
const construtoraColors: Record<string, string> = {
  "TRISUL/SA": "border-l-4 border-l-blue-500",
  "VASCO": "border-l-4 border-l-emerald-500",
  "MRV": "border-l-4 border-l-amber-500",
  "DIRECIONAL": "border-l-4 border-l-purple-500",
  "EVEN/A": "border-l-4 border-l-cyan-500",
  "MELNICK": "border-l-4 border-l-rose-500",
  "LTK": "border-l-4 border-l-orange-500",
};

const construtoraTextColors: Record<string, string> = {
  "TRISUL/SA": "text-blue-400",
  "VASCO": "text-emerald-400",
  "MRV": "text-amber-400",
  "DIRECIONAL": "text-purple-400",
  "EVEN/A": "text-cyan-400",
  "MELNICK": "text-rose-400",
  "LTK": "text-orange-400",
};

// ── Data ──
const topMetrics = [
  { label: "Leads Captados", value: "3304" },
  { label: "Propostas", value: "0" },
  { label: "Diplomas", value: "0" },
  { label: "CM+", value: "155" },
  { label: "Vendas", value: "52" },
  { label: "VGV", value: "R$12.489.637,52" },
  { label: "Meta", value: "81" },
];

const subMetrics = [
  { label: "Custo del Lead", value: "US$1,85" },
  { label: "Idad de prop.", value: "139" },
  { label: "Previsão de receita", value: "52" },
];

const vendasConstrutora = [
  { construtora: "TRISUL/SA", unidades: 11, vgv: "R$3.386.503,00" },
  { construtora: "VASCO", unidades: 10, vgv: "R$2.468.620,00" },
  { construtora: "MRV", unidades: 8, vgv: "R$2.005.017,00" },
  { construtora: "DIRECIONAL", unidades: 8, vgv: "R$2.625.017,00" },
  { construtora: "EVEN/A", unidades: 5, vgv: "R$802.031,00" },
  { construtora: "MELNICK", unidades: 3, vgv: "R$989.618,15" },
];

const propostasConstrutora = [
  { construtora: "TRISUL/SA", prop: 0, neg: 0 },
  { construtora: "VASCO", prop: 0, neg: 0 },
  { construtora: "MRV", prop: 0, neg: 0 },
  { construtora: "EVEN/A", prop: 0, neg: 0 },
];

const metasConstrutora = [
  { construtora: "TRISUL/SA", meta: 30, pct: 37, obtido: 6 },
  { construtora: "VASCO", meta: 20, pct: 55, obtido: 10 },
  { construtora: "MRV", meta: 10, pct: 90, obtido: 7 },
  { construtora: "LTK", meta: 10, pct: 60, obtido: 6 },
];

const managerTeams = [
  {
    managers: [
      { rank: 25, meta: 20, pct: "50%", pctColor: "bg-yellow-500", construtora: "AntRecibo Gol", leads: 1316, agd: 0, neg: 0, vendas: 14.5, vgv: "R$5.633.462,00", cm: 50 },
      { rank: 20, meta: 20, pct: "35%", pctColor: "bg-red-500", construtora: "Feliio Solano", leads: 1019, agd: 0, neg: 0, vendas: 25.5, vgv: "R$9.847.796,14", cm: 15 },
      { rank: 20, meta: 23, pct: "30%", pctColor: "bg-red-500", construtora: "Mauricio Vieira", leads: 777, agd: 0, neg: 0, vendas: 8, vgv: "R$1.006.835,38", cm: 34 },
    ],
  },
];

const directorTeams = [
  {
    directors: [
      { rank: 65, meta: 63, pct: "78%", pctColor: "bg-blue-500", name: "Carlos Mendes", leads: 3112, agd: 0, neg: 0, vendas: 48, vgv: "R$16.488.093,52", cm: 99 },
      { rank: 40, meta: 40, pct: "45%", pctColor: "bg-amber-500", name: "Roberto Almeida", leads: 1850, agd: 0, neg: 0, vendas: 22, vgv: "R$7.250.000,00", cm: 55 },
    ],
  },
];

const brokerRanking = [
  { pos: 1, name: "Lucas de Domingos", leads: 85, vendas: 0, agd: 0, neg: 0, qtdVendas: 1, vgv: "R$1.000.000,00", cm: 0 },
  { pos: 2, name: "Sandra Carvalho", leads: 3, vendas: 0, agd: 0, neg: 0, qtdVendas: 0, vgv: "R$245.000,00", cm: 0 },
  { pos: 3, name: "Paulo Germano", leads: 1, vendas: 0, agd: 0, neg: 0, qtdVendas: 0, vgv: "R$0,00", cm: 0 },
  { pos: 4, name: "Pedro Lougany", leads: 29, vendas: 3, agd: 0, neg: 0, qtdVendas: 0, vgv: "R$0,00", cm: 0 },
  { pos: 5, name: "Marco Gonçalves", leads: 72, vendas: 0, agd: 0, neg: 0, qtdVendas: 0, vgv: "R$0,00", cm: 0 },
  { pos: 6, name: "Jaqueline Zanoni", leads: 12, vendas: 0, agd: 0, neg: 0, qtdVendas: 1, vgv: "R$80,00", cm: 0 },
  { pos: 7, name: "Gisele Jadi|M.Clin", leads: 4, vendas: 0, agd: 0, neg: 0, qtdVendas: 1, vgv: "R$0,00", cm: 1 },
  { pos: 8, name: "Leodélia", leads: 14, vendas: 0, agd: 0, neg: 0, qtdVendas: 0, vgv: "R$919.044,38", cm: 0 },
  { pos: 9, name: "Jayler Siva", leads: 4, vendas: 0, agd: 0, neg: 0, qtdVendas: 0, vgv: "R$0,00", cm: 0 },
  { pos: 10, name: "Tatiana Nicola", leads: 18, vendas: 0, agd: 0, neg: 0, qtdVendas: 1, vgv: "R$0,00", cm: 0 },
];

const leadOrigins = [
  { source: "Leadfy", count: 6 },
  { source: "Lead Próprio", count: 30 },
  { source: "Lead Loja", count: 0 },
  { source: "Lead Físico", count: 9 },
  { source: "Lead Indicação", count: 5 },
];

const ccaStatusList = [
  { label: "Aprovado Total", value: 0, color: "text-blue-400" },
  { label: "Aprovado Condicional", value: 0, color: "text-blue-300" },
  { label: "Análise em Incorporação", value: 0, color: "text-primary" },
  { label: "Assinado no Banco", value: 0, color: "text-blue-200" },
  { label: "Pendencia em Geração", value: 0, color: "text-amber-400" },
  { label: "Pendente", value: 0, color: "text-red-400" },
];

const staffData = [
  { label: "Sócios", value: 3 },
  { label: "Ativos", value: 8 },
  { label: "Administrativo", value: 0 },
  { label: "Gestor", value: 5 },
  { label: "Corretores", value: 0 },
  { label: "Corretores Inativos", value: 0, highlight: true },
  { label: "Serviços Gerais", value: 0 },
  { label: "Total", value: 16, bold: true },
];

const staffMetrics = [
  { label: "Domicílio com Vendas", value: "" },
  { label: "Domicílio sem Vendas", value: "" },
  { label: "% Corretores com Vendas", value: "0.1%" },
];

const months = [
  { value: "01", label: "Janeiro" }, { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" }, { value: "04", label: "Abril" },
  { value: "05", label: "Maio" }, { value: "06", label: "Junho" },
  { value: "07", label: "Julho" }, { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" }, { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

const insightTypeStyles = {
  info: "border-primary/30 bg-primary/5",
  warning: "border-amber-500/30 bg-amber-500/5",
  success: "border-blue-500/30 bg-blue-500/5",
  tip: "border-blue-400/30 bg-blue-400/5",
};

export default function Dashboard() {
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("03");
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<{ role: "user" | "ai"; text: string }[]>([
    { role: "ai", text: "Olá! Sou o Jarvis, seu assistente inteligente de vendas. 🤖\n\nAqui está um resumo rápido:\n\n📊 VGV Total: R$12.489.637,52\n🏆 Top Corretor: Lucas de Domingos (85 leads)\n📈 Meta atingida: 85%\n⚠️ 3 deals estão há mais de 30 dias no pipeline\n\nComo posso ajudar?" },
  ]);

  const insights = useMemo(() => generateInsights(mockDeals), []);
  const forecast = useMemo(() => generateForecast(mockDeals), []);
  const followUps = useMemo(() => generateFollowUps(mockDeals), []);
  const alerts = useMemo(() => generateAlerts(mockDeals), []);
  const brokerAnalysis = useMemo(() => analyzeBrokers(mockDeals), []);
  const pipelineAlerts = useMemo(() => generatePipelineAlerts(mockLeads, mockDeals), []);
  const sourceMetrics = useMemo(() => calculateSourceMetrics(mockLeads), []);

  const handleAssistantSend = () => {
    if (!assistantInput.trim()) return;
    const q = assistantInput.trim();
    setAssistantMessages((prev) => [...prev, { role: "user", text: q }]);
    const answer = askAssistant(q, mockDeals);
    setTimeout(() => setAssistantMessages((prev) => [...prev, { role: "ai", text: answer }]), 300);
    setAssistantInput("");
  };

  return (
    <div className="space-y-4 text-sm">
      {/* ── MONTH SELECTOR ─────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[160px] text-xs bg-card border-border/50">
              <SelectValue placeholder="Mês" />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date range picker - single popover */}
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs border-border/50">
              <CalendarIcon className="h-3 w-3 mr-2" />
              {dateRange.from ? format(dateRange.from, "dd/MM") : "Início"} — {dateRange.to ? format(dateRange.to, "dd/MM") : "Fim"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="flex flex-col sm:flex-row">
              <div className="p-2 border-b sm:border-b-0 sm:border-r border-border/30">
                <p className="text-[10px] font-semibold text-muted-foreground px-3 py-1">INÍCIO</p>
                <Calendar mode="single" selected={dateRange.from} onSelect={(d) => setDateRange((prev) => ({ ...prev, from: d }))} className="p-2 pointer-events-auto" />
              </div>
              <div className="p-2">
                <p className="text-[10px] font-semibold text-muted-foreground px-3 py-1">FIM</p>
                <Calendar mode="single" selected={dateRange.to} onSelect={(d) => { setDateRange((prev) => ({ ...prev, to: d })); setDatePickerOpen(false); }} className="p-2 pointer-events-auto" />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* ── TOP METRICS BAR ────────────────────────────────── */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {topMetrics.map((m) => (
          <div key={m.label} className="flex flex-col items-center justify-center px-2 py-3 rounded-lg bg-card border border-border/30">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">{m.label}</span>
            <span className={cn("text-lg font-bold", m.label === "VGV" ? "text-primary text-sm" : "text-foreground")}>{m.value}</span>
          </div>
        ))}
        <div className="flex flex-col items-center justify-center px-2 py-3 rounded-lg bg-card border border-primary/30">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Meta %</span>
          <span className="text-lg font-bold text-primary">85%</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {subMetrics.map((s) => (
          <span key={s.label}>{s.label}: <span className="font-semibold text-foreground">{s.value}</span></span>
        ))}
      </div>

      {/* ── AI SECTION ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="border-primary/20 bg-card">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <CardTitle className="text-xs font-semibold text-primary">AI Insights</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {insights.map((insight, i) => (
              <motion.div key={insight.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }}
                className={cn("p-2 rounded-lg border text-xs flex items-start gap-2", insightTypeStyles[insight.type])}>
                <span className="text-sm flex-shrink-0">{insight.icon}</span>
                <span>{insight.text}</span>
              </motion.div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-card">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <CardTitle className="text-xs font-semibold text-primary">Previsão de Vendas</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-4">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Fechamentos Esperados</p>
              <p className="text-3xl font-bold text-primary">{forecast.expectedClosings}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase">VGV Projetado</p>
              <p className="text-xl font-bold text-blue-400">R$ {(forecast.projectedVGV / 1000000).toFixed(2)}M</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Probabilidade Média</p>
              <div className="flex items-center gap-2 justify-center mt-1">
                <Progress value={forecast.avgProbability} className="h-2 flex-1 max-w-32" />
                <span className="text-sm font-bold">{forecast.avgProbability}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-500/20 bg-card">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Bell className="h-4 w-4 text-red-400" />
            <CardTitle className="text-xs font-semibold text-red-400">Alertas Inteligentes</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {alerts.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum alerta no momento 🎉</p>}
            {alerts.map((alert, i) => (
              <motion.div key={alert.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                className={cn("p-2 rounded-lg border text-xs", alert.type === "danger" ? "border-red-500/20 bg-red-500/5" : "border-amber-500/20 bg-amber-500/5")}>
                <p className="font-semibold text-[10px] uppercase tracking-wider mb-0.5">{alert.title}</p>
                <p className="text-muted-foreground">{alert.text}</p>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── FOLLOW-UP ──────────────────────────────────────── */}
      <Card className="border-blue-400/20 bg-card">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <Lightbulb className="h-4 w-4 text-blue-400" />
          <CardTitle className="text-xs font-semibold text-blue-400">Recomendações de Follow-up</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {followUps.map((rec, i) => (
              <motion.div key={rec.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }}
                className={cn("p-2 rounded-lg border text-xs flex items-start gap-2",
                  rec.priority === "high" ? "border-red-500/20 bg-red-500/5" :
                  rec.priority === "medium" ? "border-amber-500/20 bg-amber-500/5" : "border-border/30 bg-card")}>
                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                  rec.priority === "high" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                )}>{rec.priority === "high" ? "URGENTE" : "MÉDIO"}</span>
                <span className="flex-1">{rec.text}</span>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── AI BROKER PERFORMANCE ──────────────────────────── */}
      <Card className="border-primary/20 bg-card">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <CardTitle className="text-xs font-semibold text-primary">Performance dos Corretores (AI)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/40 text-muted-foreground">
                <th className="p-2 text-left font-medium">Corretor</th>
                <th className="p-2 text-right font-medium">Ativos</th>
                <th className="p-2 text-right font-medium">Fechados</th>
                <th className="p-2 text-right font-medium">VGV</th>
                <th className="p-2 text-right font-medium">Conv. %</th>
                <th className="p-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {brokerAnalysis.map((b) => (
                <tr key={b.name} className="border-b border-border/10 hover:bg-primary/5">
                  <td className="p-2 font-medium">{b.name}</td>
                  <td className="p-2 text-right">{b.dealsActive}</td>
                  <td className="p-2 text-right">{b.dealsClosed}</td>
                  <td className="p-2 text-right text-primary">R$ {(b.totalVGV / 1000).toFixed(0)}k</td>
                  <td className="p-2 text-right">{b.conversionRate}%</td>
                  <td className="p-2">
                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold",
                      b.status === "top" ? "bg-blue-500/20 text-blue-400" :
                      b.status === "underperforming" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                    )}>{b.status === "top" ? "⭐ TOP" : b.status === "underperforming" ? "⚠ ATENÇÃO" : "🔄 REGULAR"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── THREE CARDS: Vendas, Propostas, Metas (by Construtora with colors) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="border-primary/20 bg-card">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">Vendas por Construtora</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2 font-medium">Construtora</th><th className="text-right p-2 font-medium">Unidades</th><th className="text-right p-2 font-medium">VGV</th></tr></thead>
              <tbody>{vendasConstrutora.map((row) => (
                <tr key={row.construtora} className={cn("border-b border-border/10 hover:bg-primary/5", construtoraColors[row.construtora])}>
                  <td className={cn("p-2 font-medium", construtoraTextColors[row.construtora])}>{row.construtora}</td>
                  <td className="p-2 text-right font-semibold">{row.unidades}</td>
                  <td className="p-2 text-right text-muted-foreground">{row.vgv}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-card">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">Propostas por Construtora</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2 font-medium">Construtora</th><th className="text-right p-2 font-medium">Prop.</th><th className="text-right p-2 font-medium">Neg.</th></tr></thead>
              <tbody>{propostasConstrutora.map((row) => (
                <tr key={row.construtora} className={cn("border-b border-border/10 hover:bg-primary/5", construtoraColors[row.construtora])}>
                  <td className={cn("p-2 font-medium", construtoraTextColors[row.construtora])}>{row.construtora}</td>
                  <td className="p-2 text-right">{row.prop}</td>
                  <td className="p-2 text-right">{row.neg}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-primary/20 bg-card">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">Metas por Construtora</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2 font-medium">Construtora</th><th className="text-right p-2 font-medium">Meta</th><th className="p-2 font-medium">%</th><th className="text-right p-2 font-medium">Obtido</th></tr></thead>
              <tbody>{metasConstrutora.map((row) => (
                <tr key={row.construtora} className={cn("border-b border-border/10 hover:bg-primary/5", construtoraColors[row.construtora])}>
                  <td className={cn("p-2 font-medium", construtoraTextColors[row.construtora])}>{row.construtora}</td>
                  <td className="p-2 text-right">{row.meta}</td>
                  <td className="p-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold", row.pct >= 80 ? "bg-blue-500/30 text-blue-300" : row.pct >= 50 ? "bg-amber-500/30 text-amber-300" : "bg-red-500/30 text-red-300")}>{row.pct}%</span></td>
                  <td className="p-2 text-right font-semibold">{row.obtido}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── MANAGER TEAM TABLES ────────────────────────────── */}
      {managerTeams.map((team, ti) => (
        <Card key={ti} className="bg-card border-primary/20">
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-right font-medium">Meta</th><th className="p-2 text-right font-medium">Mede</th><th className="p-2 font-medium">% Imóble</th><th className="p-2 font-medium">Gerente</th><th className="p-2 text-right font-medium">Leads</th><th className="p-2 text-right font-medium">Agd</th><th className="p-2 text-right font-medium">Neg.</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">VGV</th><th className="p-2 text-right font-medium">CM</th></tr></thead>
              <tbody>{team.managers.map((m, mi) => (
                <tr key={mi} className="border-b border-border/10 hover:bg-primary/5">
                  <td className="p-2 text-right">{m.rank}</td>
                  <td className="p-2 text-right">{m.meta}</td>
                  <td className="p-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold text-white", m.pctColor)}>{m.pct}</span></td>
                  <td className="p-2 font-medium">{m.construtora}</td>
                  <td className={cn("p-2 text-right font-semibold", m.leads > 1000 ? "text-primary" : "text-amber-400")}>{m.leads}</td>
                  <td className="p-2 text-right text-red-400">{m.agd}</td>
                  <td className="p-2 text-right text-red-400">{m.neg}</td>
                  <td className="p-2 text-right font-semibold text-primary">{m.vendas}</td>
                  <td className="p-2 text-right text-blue-300 text-[11px]">{m.vgv}</td>
                  <td className="p-2 text-right">{m.cm}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {/* ── DIRECTOR TEAM TABLES ───────────────────────────── */}
      {directorTeams.map((team, ti) => (
        <Card key={`dir-${ti}`} className="bg-card border-primary/20">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs font-semibold text-primary flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              Ranking de Diretores
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-right font-medium">Meta</th><th className="p-2 text-right font-medium">Mede</th><th className="p-2 font-medium">% Imóble</th><th className="p-2 font-medium">Diretor</th><th className="p-2 text-right font-medium">Leads</th><th className="p-2 text-right font-medium">Agd</th><th className="p-2 text-right font-medium">Neg.</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">VGV</th><th className="p-2 text-right font-medium">CM</th></tr></thead>
              <tbody>{team.directors.map((d, di) => (
                <tr key={di} className="border-b border-border/10 hover:bg-primary/5">
                  <td className="p-2 text-right">{d.rank}</td>
                  <td className="p-2 text-right">{d.meta}</td>
                  <td className="p-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold text-white", d.pctColor)}>{d.pct}</span></td>
                  <td className="p-2 font-medium">{d.name}</td>
                  <td className={cn("p-2 text-right font-semibold", d.leads > 2000 ? "text-primary" : "text-amber-400")}>{d.leads}</td>
                  <td className="p-2 text-right text-red-400">{d.agd}</td>
                  <td className="p-2 text-right text-red-400">{d.neg}</td>
                  <td className="p-2 text-right font-semibold text-primary">{d.vendas}</td>
                  <td className="p-2 text-right text-blue-300 text-[11px]">{d.vgv}</td>
                  <td className="p-2 text-right">{d.cm}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {/* ── ORIGEM LEADS + STATUS CCA ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="bg-card border-border/30">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">Origem dos Leads</CardTitle></CardHeader>
          <CardContent className="p-3">
            <table className="w-full text-xs"><tbody>{leadOrigins.map((o) => (
              <tr key={o.source} className="border-b border-border/10 hover:bg-primary/5"><td className="py-1.5">{o.source}</td><td className="py-1.5 text-right font-semibold">{o.count}</td></tr>
            ))}</tbody></table>
          </CardContent>
        </Card>
        <Card className="bg-card border-border/30">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">Status CCA</CardTitle></CardHeader>
          <CardContent className="p-3">
            <table className="w-full text-xs"><tbody>{ccaStatusList.map((s) => (
              <tr key={s.label} className="border-b border-border/10 hover:bg-primary/5"><td className={cn("py-1.5", s.color)}>{s.label}</td><td className="py-1.5 text-right font-semibold">{s.value}</td></tr>
            ))}</tbody></table>
          </CardContent>
        </Card>
      </div>

      {/* ── STAFF ──────────────────────────────────────────── */}
      <Card className="bg-card border-border/30 max-w-md mx-auto">
        <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary text-center">Staff</CardTitle></CardHeader>
        <CardContent className="p-3">
          <table className="w-full text-xs"><tbody>{staffData.map((s) => (
            <tr key={s.label} className={cn("border-b border-border/10", s.bold && "font-bold")}><td className={cn("py-1", s.highlight && "text-amber-400")}>{s.label}</td><td className="py-1 text-right font-semibold">{s.value}</td></tr>
          ))}</tbody></table>
          <div className="mt-2 pt-2 border-t border-border/20 space-y-1">{staffMetrics.map((s) => (
            <div key={s.label} className="flex justify-between text-[10px]"><span className="text-primary">{s.label}</span><span className="font-semibold">{s.value}</span></div>
          ))}</div>
        </CardContent>
      </Card>

      {/* ── RANKING GERAL ──────────────────────────────────── */}
      <Card className="border-primary/20 bg-card">
        <CardHeader className="py-2 px-3 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold flex items-center gap-2"><Trophy className="h-4 w-4 text-primary" /><span className="text-primary">Ranking Geral</span></CardTitle>
          <div className="flex gap-1"><Button variant="ghost" size="icon" className="h-6 w-6"><Filter className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-6 w-6"><RefreshCw className="h-3 w-3" /></Button></div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-center font-medium w-10">#</th><th className="p-2 text-left font-medium">Corretor</th><th className="p-2 text-right font-medium">Leads</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">Agd</th><th className="p-2 text-right font-medium">Neg.</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">VGV</th><th className="p-2 text-right font-medium">CM</th></tr></thead>
            <tbody>{brokerRanking.map((row) => {
              const medals = ["🥇", "🥈", "🥉"];
              return (
                <tr key={row.pos} className="border-b border-border/10 hover:bg-primary/5">
                  <td className="p-2 text-center">{row.pos <= 3 ? <span className="text-sm">{medals[row.pos - 1]}</span> : <span className="text-muted-foreground">{row.pos}</span>}</td>
                  <td className="p-2 font-medium whitespace-nowrap">{row.name}</td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.leads > 20 ? "bg-blue-500/30 text-blue-300" : row.leads > 0 ? "bg-amber-500/30 text-amber-300" : "bg-red-500/20 text-red-300")}>{row.leads}</span></td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.vendas > 0 ? "bg-blue-500/30 text-blue-300" : "bg-red-500/20 text-red-300")}>{row.vendas}</span></td>
                  <td className="p-2 text-right"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300">{row.agd}</span></td>
                  <td className="p-2 text-right"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-300">{row.neg}</span></td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.qtdVendas > 0 ? "bg-blue-500/30 text-blue-300" : "bg-red-500/20 text-red-300")}>{row.qtdVendas}</span></td>
                  <td className="p-2 text-right"><span className={cn("text-[10px] font-semibold", row.vgv !== "R$0,00" ? "text-primary" : "text-red-400")}>{row.vgv}</span></td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.cm > 0 ? "bg-blue-500/30 text-blue-300" : "bg-red-500/20 text-red-300")}>{row.cm}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── PIPELINE ALERTS + SOURCE METRICS ─────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="bg-card border-amber-500/20">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Radio className="h-4 w-4 text-amber-400 animate-pulse" />
            <CardTitle className="text-xs font-semibold text-amber-400">Alertas do Pipeline</CardTitle>
            <Badge variant="secondary" className="ml-auto text-[10px]">{pipelineAlerts.filter(a => !a.read).length}</Badge>
          </CardHeader>
          <CardContent className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
            {pipelineAlerts.slice(0, 8).map((alert) => (
              <div key={alert.id} className={cn("p-2 rounded text-xs border flex items-start gap-2",
                alert.severity === "danger" ? "border-red-500/20 bg-red-500/5" :
                alert.severity === "warning" ? "border-amber-500/20 bg-amber-500/5" : "border-primary/20 bg-primary/5"
              )}>
                <span className="text-[10px] font-bold uppercase tracking-wider flex-shrink-0 mt-0.5">{alert.type === "new_lead" ? "🆕" : alert.type === "visit_today" ? "📅" : alert.type === "deal_inactive" ? "⚠️" : "📋"}</span>
                <div><p className="font-medium">{alert.title}</p><p className="text-muted-foreground">{alert.message}</p></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border-primary/20">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <CardTitle className="text-xs font-semibold text-primary">Conversão por Origem</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-left">Origem</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Conv.</th><th className="p-2 text-right">%</th></tr></thead>
              <tbody>{sourceMetrics.map(s => (
                <tr key={s.source} className="border-b border-border/10 hover:bg-primary/5">
                  <td className="p-2">{s.source}</td>
                  <td className="p-2 text-right">{s.totalLeads}</td>
                  <td className="p-2 text-right">{s.converted}</td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", s.conversionRate > 20 ? "bg-blue-500/20 text-blue-400" : s.conversionRate > 0 ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground")}>{s.conversionRate}%</span></td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── JARVIS AI ASSISTANT ─────────────────────────────── */}
      <Card className="border-primary/30 bg-card">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <CardTitle className="text-xs font-semibold text-primary">Jarvis — Assistente AI</CardTitle>
          <Zap className="h-3 w-3 text-primary ml-auto" />
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
            <AnimatePresence>
              {assistantMessages.map((msg, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                  className={cn("p-2 rounded-lg text-xs", msg.role === "user" ? "bg-primary/10 ml-8" : "bg-secondary/50 mr-8 whitespace-pre-line")}>
                  {msg.role === "ai" && <span className="text-primary font-semibold text-[10px] block mb-1">🤖 JARVIS</span>}
                  {msg.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Pergunte ao Jarvis..." className="text-xs bg-secondary/30 border-border/30" value={assistantInput} onChange={(e) => setAssistantInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAssistantSend()} />
            <Button size="sm" onClick={handleAssistantSend}><Send className="h-3 w-3" /></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
