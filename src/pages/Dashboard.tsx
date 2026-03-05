import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Trophy, Filter, RefreshCw, Brain, TrendingUp, AlertTriangle, MessageSquare, Send, Lightbulb, Target, Zap, Bell } from "lucide-react";
import { mockDeals } from "@/data/mockData";
import { generateInsights, generateForecast, generateFollowUps, generateAlerts, analyzeBrokers, askAssistant } from "@/lib/aiAnalytics";
import { motion, AnimatePresence } from "framer-motion";

// ── Data ──────────────────────────────────────────────────────
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
    borderColor: "border-amber-600",
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
  { label: "Aprovado Total", value: 0, color: "text-emerald-400" },
  { label: "Aprovado Condicional", value: 0, color: "text-yellow-400" },
  { label: "Análise em Incorporação", value: 0, color: "text-blue-400" },
  { label: "Assinado no Banco", value: 0, color: "text-cyan-400" },
  { label: "Pendencia em Geração", value: 0, color: "text-orange-400" },
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

function heatCell(value: number, max: number) {
  if (value === 0) return "bg-red-600/60";
  const ratio = value / max;
  if (ratio >= 0.7) return "bg-emerald-600/60";
  if (ratio >= 0.4) return "bg-yellow-600/60";
  return "bg-red-500/60";
}

const insightTypeStyles = {
  info: "border-primary/30 bg-primary/5",
  warning: "border-warning/30 bg-warning/5",
  success: "border-emerald-500/30 bg-emerald-500/5",
  tip: "border-purple-500/30 bg-purple-500/5",
};

export default function Dashboard() {
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);

  const insights = useMemo(() => generateInsights(mockDeals), []);
  const forecast = useMemo(() => generateForecast(mockDeals), []);
  const followUps = useMemo(() => generateFollowUps(mockDeals), []);
  const alerts = useMemo(() => generateAlerts(mockDeals), []);
  const brokerAnalysis = useMemo(() => analyzeBrokers(mockDeals), []);

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
      {/* ── TOP METRICS BAR ────────────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-1">
        {topMetrics.map((m) => (
          <div key={m.label} className="flex flex-col items-center justify-center px-3 py-2 rounded border border-border/50 glass-subtle min-w-[100px]">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider whitespace-nowrap">{m.label}</span>
            <span className={cn("text-lg font-bold", m.label === "VGV" ? "text-emerald-400 text-sm" : "text-foreground")}>{m.value}</span>
          </div>
        ))}
        <div className="flex flex-col items-center justify-center px-3 py-2 rounded border border-amber-600/50 bg-amber-900/20 min-w-[100px]">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Meta Atingida %</span>
          <span className="text-lg font-bold text-amber-400">85%</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {subMetrics.map((s) => (
          <span key={s.label}>{s.label}: <span className="font-semibold text-foreground">{s.value}</span></span>
        ))}
      </div>

      {/* ── AI SECTION: Insights + Forecast + Alerts ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* AI Insights */}
        <Card className="border-primary/30 glass">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <CardTitle className="text-xs font-semibold text-primary">AI Insights</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {insights.map((insight, i) => (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 }}
                className={cn("p-2 rounded-lg border text-xs flex items-start gap-2", insightTypeStyles[insight.type])}
              >
                <span className="text-sm flex-shrink-0">{insight.icon}</span>
                <span>{insight.text}</span>
              </motion.div>
            ))}
          </CardContent>
        </Card>

        {/* Sales Forecast */}
        <Card className="border-emerald-500/30 glass">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <CardTitle className="text-xs font-semibold text-emerald-400">Previsão de Vendas</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-4">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase">Fechamentos Esperados</p>
              <p className="text-3xl font-bold text-emerald-400">{forecast.expectedClosings}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground uppercase">VGV Projetado</p>
              <p className="text-xl font-bold text-primary">R$ {(forecast.projectedVGV / 1000000).toFixed(2)}M</p>
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

        {/* Smart Alerts */}
        <Card className="border-destructive/30 glass">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Bell className="h-4 w-4 text-destructive" />
            <CardTitle className="text-xs font-semibold text-destructive">Alertas Inteligentes</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {alerts.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum alerta no momento 🎉</p>}
            {alerts.map((alert, i) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className={cn("p-2 rounded-lg border text-xs", alert.type === "danger" ? "border-destructive/30 bg-destructive/5" : "border-warning/30 bg-warning/5")}
              >
                <p className="font-semibold text-[10px] uppercase tracking-wider mb-0.5">{alert.title}</p>
                <p className="text-muted-foreground">{alert.text}</p>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* ── FOLLOW-UP RECOMMENDATIONS ──────────────────────── */}
      <Card className="border-purple-500/30 glass">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <Lightbulb className="h-4 w-4 text-purple-400" />
          <CardTitle className="text-xs font-semibold text-purple-400">Recomendações de Follow-up</CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {followUps.map((rec, i) => (
              <motion.div
                key={rec.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className={cn("p-2 rounded-lg border text-xs flex items-start gap-2",
                  rec.priority === "high" ? "border-destructive/20 bg-destructive/5" :
                  rec.priority === "medium" ? "border-warning/20 bg-warning/5" : "border-border/30 bg-card/40"
                )}
              >
                <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                  rec.priority === "high" ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"
                )}>{rec.priority === "high" ? "URGENTE" : "MÉDIO"}</span>
                <span className="flex-1">{rec.text}</span>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── AI BROKER PERFORMANCE ──────────────────────────── */}
      <Card className="border-cyan-500/30 glass">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <Target className="h-4 w-4 text-cyan-400" />
          <CardTitle className="text-xs font-semibold text-cyan-400">Performance dos Corretores (AI)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30 text-muted-foreground">
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
                <tr key={b.name} className="border-b border-border/10 hover:bg-secondary/20">
                  <td className="p-2 font-medium">{b.name}</td>
                  <td className="p-2 text-right">{b.dealsActive}</td>
                  <td className="p-2 text-right">{b.dealsClosed}</td>
                  <td className="p-2 text-right text-emerald-400">R$ {(b.totalVGV / 1000).toFixed(0)}k</td>
                  <td className="p-2 text-right">{b.conversionRate}%</td>
                  <td className="p-2">
                    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold",
                      b.status === "top" ? "bg-emerald-600/20 text-emerald-400" :
                      b.status === "underperforming" ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"
                    )}>{b.status === "top" ? "⭐ TOP" : b.status === "underperforming" ? "⚠ ATENÇÃO" : "🔄 REGULAR"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── THREE CARDS: Vendas, Propostas, Metas ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="border-emerald-600/50 glass">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-emerald-400">Vendas</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2 font-medium">Construtora</th><th className="text-right p-2 font-medium">Unidades</th><th className="text-right p-2 font-medium">VGV</th></tr></thead>
              <tbody>{vendasConstrutora.map((row) => (<tr key={row.construtora} className="border-b border-border/10 hover:bg-secondary/30"><td className="p-2">{row.construtora}</td><td className="p-2 text-right font-semibold">{row.unidades}</td><td className="p-2 text-right text-muted-foreground">{row.vgv}</td></tr>))}</tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-blue-600/50 glass">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-blue-400">Propostas</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2 font-medium">Const.</th><th className="text-right p-2 font-medium">Prop.</th><th className="text-right p-2 font-medium">Neg.</th><th className="text-right p-2 font-medium">VGV</th></tr></thead>
              <tbody>{propostasConstrutora.map((row) => (<tr key={row.construtora} className="border-b border-border/10 hover:bg-secondary/30"><td className="p-2">{row.construtora}</td><td className="p-2 text-right">{row.prop}</td><td className="p-2 text-right">{row.neg}</td><td className="p-2 text-right text-muted-foreground">—</td></tr>))}</tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="border-amber-600/50 glass">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-amber-400">Metas</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="text-left p-2 font-medium">Construtora</th><th className="text-right p-2 font-medium">Meta</th><th className="p-2 font-medium">%</th><th className="text-right p-2 font-medium">Obtido</th></tr></thead>
              <tbody>{metasConstrutora.map((row) => (<tr key={row.construtora} className="border-b border-border/10 hover:bg-secondary/30"><td className="p-2">{row.construtora}</td><td className="p-2 text-right">{row.meta}</td><td className="p-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold", row.pct >= 80 ? "bg-emerald-600 text-white" : row.pct >= 50 ? "bg-yellow-600 text-white" : "bg-red-600 text-white")}>{row.pct}%</span></td><td className="p-2 text-right font-semibold">{row.obtido}</td></tr>))}</tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* ── MANAGER TEAM TABLES ────────────────────────────── */}
      {managerTeams.map((team, ti) => (
        <Card key={ti} className={cn("glass", team.borderColor)}>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-right font-medium">Meta</th><th className="p-2 text-right font-medium">Mede</th><th className="p-2 font-medium">% Imóble</th><th className="p-2 font-medium">Gerente</th><th className="p-2 text-right font-medium">Leads</th><th className="p-2 text-right font-medium">Agd</th><th className="p-2 text-right font-medium">Neg.</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">VGV</th><th className="p-2 text-right font-medium">CM</th></tr></thead>
              <tbody>{team.managers.map((m, mi) => (<tr key={mi} className="border-b border-border/10"><td className="p-2 text-right">{m.rank}</td><td className="p-2 text-right">{m.meta}</td><td className="p-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold text-white", m.pctColor)}>{m.pct}</span></td><td className="p-2 font-medium">{m.construtora}</td><td className={cn("p-2 text-right font-semibold", m.leads > 1000 ? "text-emerald-400" : "text-amber-400")}>{m.leads}</td><td className="p-2 text-right text-red-400">{m.agd}</td><td className="p-2 text-right text-red-400">{m.neg}</td><td className="p-2 text-right font-semibold text-emerald-400">{m.vendas}</td><td className="p-2 text-right text-emerald-300 text-[11px]">{m.vgv}</td><td className="p-2 text-right">{m.cm}</td></tr>))}</tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {/* ── ORIGEM LEADS + STATUS CCA ──────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="glass border-border/50">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold">Origem dos Leads</CardTitle></CardHeader>
          <CardContent className="p-3">
            <table className="w-full text-xs"><tbody>{leadOrigins.map((o) => (<tr key={o.source} className="border-b border-border/10"><td className="py-1.5">{o.source}</td><td className="py-1.5 text-right font-semibold">{o.count}</td></tr>))}</tbody></table>
          </CardContent>
        </Card>
        <Card className="glass border-border/50">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold">Status CCA</CardTitle></CardHeader>
          <CardContent className="p-3">
            <table className="w-full text-xs"><tbody>{ccaStatusList.map((s) => (<tr key={s.label} className="border-b border-border/10"><td className={cn("py-1.5", s.color)}>{s.label}</td><td className="py-1.5 text-right font-semibold">{s.value}</td></tr>))}</tbody></table>
          </CardContent>
        </Card>
      </div>

      {/* ── ESCOLHER PERÍODO ───────────────────────────────── */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Escolher Período</span>
        <div className="flex gap-2">
          <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="text-xs"><CalendarIcon className="h-3 w-3 mr-1" />{dateRange.from ? format(dateRange.from, "dd/MM/yyyy") : "07/12/2025"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="center"><Calendar mode="single" selected={dateRange.from} onSelect={(d) => setDateRange((prev) => ({ ...prev, from: d }))} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
          <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" className="text-xs"><CalendarIcon className="h-3 w-3 mr-1" />{dateRange.to ? format(dateRange.to, "dd/MM/yyyy") : "07/12/2026"}</Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="center"><Calendar mode="single" selected={dateRange.to} onSelect={(d) => setDateRange((prev) => ({ ...prev, to: d }))} className="p-3 pointer-events-auto" /></PopoverContent></Popover>
        </div>
      </div>

      {/* ── STAFF ──────────────────────────────────────────── */}
      <Card className="glass border-border/50 max-w-md mx-auto">
        <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-emerald-400 text-center">Staff</CardTitle></CardHeader>
        <CardContent className="p-3">
          <table className="w-full text-xs"><tbody>{staffData.map((s) => (<tr key={s.label} className={cn("border-b border-border/10", s.bold && "font-bold")}><td className={cn("py-1", s.highlight && "text-amber-400")}>{s.label}</td><td className="py-1 text-right font-semibold">{s.value}</td></tr>))}</tbody></table>
          <div className="mt-2 pt-2 border-t border-border/20 space-y-1">{staffMetrics.map((s) => (<div key={s.label} className="flex justify-between text-[10px]"><span className="text-emerald-400">{s.label}</span><span className="font-semibold">{s.value}</span></div>))}</div>
        </CardContent>
      </Card>

      {/* ── RANKING GERAL ──────────────────────────────────── */}
      <Card className="border-cyan-700/50 glass">
        <CardHeader className="py-2 px-3 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-semibold flex items-center gap-2"><Trophy className="h-4 w-4 text-cyan-400" /><span className="text-cyan-400">Ranking Geral</span></CardTitle>
          <div className="flex gap-1"><Button variant="ghost" size="icon" className="h-6 w-6"><Filter className="h-3 w-3" /></Button><Button variant="ghost" size="icon" className="h-6 w-6"><RefreshCw className="h-3 w-3" /></Button></div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-border/40 text-muted-foreground"><th className="p-2 text-center font-medium w-10">#</th><th className="p-2 text-left font-medium">Corretor</th><th className="p-2 text-right font-medium">Leads</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">Agd</th><th className="p-2 text-right font-medium">Neg.</th><th className="p-2 text-right font-medium">Vendas</th><th className="p-2 text-right font-medium">VGV</th><th className="p-2 text-right font-medium">CM</th></tr></thead>
            <tbody>{brokerRanking.map((row) => {
              const medals = ["🥇", "🥈", "🥉"];
              return (
                <tr key={row.pos} className="border-b border-border/10 hover:bg-secondary/20">
                  <td className="p-2 text-center">{row.pos <= 3 ? <span className="text-sm">{medals[row.pos - 1]}</span> : <span className="text-muted-foreground">{row.pos}</span>}</td>
                  <td className="p-2 font-medium whitespace-nowrap">{row.name}</td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.leads > 20 ? "bg-emerald-600/60 text-white" : row.leads > 0 ? "bg-yellow-600/60 text-white" : "bg-red-600/40 text-red-300")}>{row.leads}</span></td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.vendas > 0 ? "bg-emerald-600/60 text-white" : "bg-red-600/40 text-red-300")}>{row.vendas}</span></td>
                  <td className="p-2 text-right"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600/40 text-red-300">{row.agd}</span></td>
                  <td className="p-2 text-right"><span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-600/40 text-red-300">{row.neg}</span></td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.qtdVendas > 0 ? "bg-emerald-600/60 text-white" : "bg-red-600/40 text-red-300")}>{row.qtdVendas}</span></td>
                  <td className="p-2 text-right"><span className={cn("text-[10px] font-semibold", row.vgv !== "R$0,00" ? "text-emerald-400" : "text-red-400")}>{row.vgv}</span></td>
                  <td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", row.cm > 0 ? "bg-emerald-600/60 text-white" : "bg-red-600/40 text-red-300")}>{row.cm}</span></td>
                </tr>
              );
            })}</tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── AI ASSISTANT PANEL ─────────────────────────────── */}
      <Card className="border-primary/30 glass glow-primary">
        <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <CardTitle className="text-xs font-semibold text-primary">Assistente AI</CardTitle>
          <Zap className="h-3 w-3 text-amber-400 ml-auto" />
        </CardHeader>
        <CardContent className="p-3">
          <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
            {assistantMessages.length === 0 && (
              <div className="text-center py-4">
                <Brain className="h-8 w-8 text-primary/30 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Pergunte sobre VGV, top corretores, deals prováveis...</p>
              </div>
            )}
            <AnimatePresence>
              {assistantMessages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("p-2 rounded-lg text-xs", msg.role === "user" ? "bg-primary/10 ml-8" : "bg-secondary/50 mr-8 whitespace-pre-line")}
                >
                  {msg.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Ex: Qual o VGV total? Quem fechou mais?"
              className="text-xs glass-subtle"
              value={assistantInput}
              onChange={(e) => setAssistantInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAssistantSend()}
            />
            <Button size="sm" onClick={handleAssistantSend} className="glow-primary">
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
