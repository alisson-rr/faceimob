import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Progress } from "@/components/ui/progress";
import { mockDeals, mockBrokers, mockManagers, mockLeads, mockGamification, mockDevelopers } from "@/data/mockData";
import { DEAL_STAGES } from "@/types/crm";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Users, FileText, Handshake, CreditCard, TrendingUp, DollarSign,
  Target, Trophy, Medal, Calendar as CalendarIcon, Filter, X,
  ArrowDown, ArrowUp, BarChart3, Eye, ShieldCheck, Clock,
  CheckCircle, AlertCircle
} from "lucide-react";

// Mock extended data for richer dashboard
const salesByDeveloper = [
  { developer: 'TENDA', sales: 18, vgv: 5580000 },
  { developer: 'MRV', sales: 14, vgv: 3220000 },
  { developer: 'DIRECIONAL', sales: 9, vgv: 1890000 },
  { developer: 'SOUFLAR', sales: 7, vgv: 1250000 },
  { developer: 'MELNICK', sales: 4, vgv: 549637 },
];

const proposals = [
  { count: 12, type: 'Nova', stage: 'Análise', vgv: 3200000 },
  { count: 8, type: 'Revisão', stage: 'Pendente', vgv: 2100000 },
  { count: 5, type: 'Contra-proposta', stage: 'Aprovada', vgv: 1800000 },
];

const goals = [
  { developer: 'TENDA', meta: 20, sales: 18, remaining: 2 },
  { developer: 'MRV', meta: 18, sales: 14, remaining: 4 },
  { developer: 'DIRECIONAL', meta: 12, sales: 9, remaining: 3 },
  { developer: 'SOUFLAR', meta: 10, sales: 7, remaining: 3 },
  { developer: 'MELNICK', meta: 8, sales: 4, remaining: 4 },
];

const conversionData = [
  { month: 'Jan', meta: 15, conversion: 78, attended: 320, leads: 410, approved: 28, sales: 12, vgv: 3200000 },
  { month: 'Fev', meta: 18, conversion: 82, attended: 380, leads: 450, approved: 35, sales: 15, vgv: 4100000 },
  { month: 'Mar', meta: 20, conversion: 65, attended: 290, leads: 520, approved: 22, sales: 13, vgv: 3600000 },
];

const brokerPerformance = [
  { name: 'Ana Martins', meta: 10, leads: 45, approved: 12, sales: 8, vgv: 4200000, conversion: 17.8 },
  { name: 'Fernando Lima', meta: 8, leads: 38, approved: 9, sales: 6, vgv: 3100000, conversion: 15.8 },
  { name: 'Carlos Silva', meta: 8, leads: 32, approved: 7, sales: 5, vgv: 2500000, conversion: 15.6 },
  { name: 'Roberto Souza', meta: 6, leads: 20, approved: 4, sales: 3, vgv: 1800000, conversion: 15.0 },
  { name: 'Juliana Costa', meta: 5, leads: 12, approved: 2, sales: 1, vgv: 350000, conversion: 8.3 },
];

const leadOrigins = [
  { source: 'Leadfy', count: 1250, color: 'bg-primary' },
  { source: 'Lead Próprio', count: 820, color: 'bg-success' },
  { source: 'Lead Loja', count: 540, color: 'bg-warning' },
  { source: 'Lead Físico', count: 420, color: 'bg-purple-500' },
  { source: 'Lead Indicação', count: 274, color: 'bg-pink-500' },
];

const ccaStatus = [
  { label: 'Aprovado Total', value: 42, icon: CheckCircle, color: 'text-success' },
  { label: 'Aprovado Condicional', value: 15, icon: AlertCircle, color: 'text-warning' },
  { label: 'Em Análise', value: 28, icon: Eye, color: 'text-primary' },
  { label: 'Pendente', value: 12, icon: Clock, color: 'text-muted-foreground' },
];

const funnelStages = [
  { label: 'Leads', value: 3304, pct: 100 },
  { label: 'Atendimento', value: 1850, pct: 56 },
  { label: 'Análise', value: 420, pct: 12.7 },
  { label: 'Contrato', value: 155, pct: 4.7 },
  { label: 'Vendas', value: 52, pct: 1.6 },
];

export default function Dashboard() {
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [devFilter, setDevFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);

  const topMetrics = [
    { title: 'Leads Captados', value: '3.304', icon: Users, bg: 'from-blue-600/20 to-blue-600/5', border: 'border-blue-500/30', iconColor: 'text-blue-400' },
    { title: 'Propostas', value: '25', icon: FileText, bg: 'from-cyan-600/20 to-cyan-600/5', border: 'border-cyan-500/30', iconColor: 'text-cyan-400' },
    { title: 'Negócios', value: '97', icon: Handshake, bg: 'from-violet-600/20 to-violet-600/5', border: 'border-violet-500/30', iconColor: 'text-violet-400' },
    { title: 'CPF', value: '155', icon: CreditCard, bg: 'from-amber-600/20 to-amber-600/5', border: 'border-amber-500/30', iconColor: 'text-amber-400' },
    { title: 'Vendas', value: '52', icon: TrendingUp, bg: 'from-emerald-600/20 to-emerald-600/5', border: 'border-emerald-500/30', iconColor: 'text-emerald-400' },
    { title: 'VGV', value: 'R$ 12,49M', icon: DollarSign, bg: 'from-green-600/20 to-green-600/5', border: 'border-green-500/30', iconColor: 'text-green-400' },
    { title: 'Meta', value: '81%', icon: Target, bg: 'from-rose-600/20 to-rose-600/5', border: 'border-rose-500/30', iconColor: 'text-rose-400' },
  ];

  return (
    <div className="space-y-5">
      {/* Header + Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral da operação comercial</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-2" /> Filtros
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <CalendarIcon className="h-4 w-4 mr-2" />
                {dateRange.from ? format(dateRange.from, 'dd/MM') : 'De'} — {dateRange.to ? format(dateRange.to, 'dd/MM') : 'Até'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar mode="single" selected={dateRange.from} onSelect={d => setDateRange(prev => ({ ...prev, from: d }))} className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {showFilters && (
        <Card className="glass">
          <CardContent className="p-3 flex flex-wrap gap-3">
            <Select value={devFilter} onValueChange={setDevFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Incorporadora" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {mockDevelopers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={brokerFilter} onValueChange={setBrokerFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Corretor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {mockBrokers.map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => { setDevFilter("all"); setBrokerFilter("all"); }}>
              <X className="h-3 w-3 mr-1" /> Limpar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* TOP METRICS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {topMetrics.map(m => (
          <Card key={m.title} className={cn("border bg-gradient-to-br", m.bg, m.border)}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <m.icon className={cn("h-4 w-4", m.iconColor)} />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{m.title}</span>
              </div>
              <p className="text-xl font-bold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* SECOND SECTION: Sales by Dev, Proposals, Goals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sales by Developer */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Vendas por Incorporadora
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/50 text-muted-foreground text-xs">
                <th className="text-left p-3 font-medium">Incorporadora</th>
                <th className="text-right p-3 font-medium">Vendas</th>
                <th className="text-right p-3 font-medium">VGV</th>
              </tr></thead>
              <tbody>
                {salesByDeveloper.map(row => (
                  <tr key={row.developer} className="border-b border-border/20 hover:bg-secondary/30">
                    <td className="p-3 font-medium">{row.developer}</td>
                    <td className="p-3 text-right text-primary font-semibold">{row.sales}</td>
                    <td className="p-3 text-right text-muted-foreground">R$ {(row.vgv / 1000000).toFixed(2)}M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Proposals */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-cyan-400" /> Propostas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/50 text-muted-foreground text-xs">
                <th className="text-left p-3 font-medium">Qtd</th>
                <th className="text-left p-3 font-medium">Tipo</th>
                <th className="text-left p-3 font-medium">Etapa</th>
                <th className="text-right p-3 font-medium">VGV</th>
              </tr></thead>
              <tbody>
                {proposals.map((row, i) => (
                  <tr key={i} className="border-b border-border/20 hover:bg-secondary/30">
                    <td className="p-3 font-semibold text-primary">{row.count}</td>
                    <td className="p-3">{row.type}</td>
                    <td className="p-3 text-muted-foreground">{row.stage}</td>
                    <td className="p-3 text-right text-muted-foreground">R$ {(row.vgv / 1000000).toFixed(1)}M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Goals */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-rose-400" /> Metas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/50 text-muted-foreground text-xs">
                <th className="text-left p-3 font-medium">Incorporadora</th>
                <th className="text-right p-3 font-medium">Meta</th>
                <th className="text-right p-3 font-medium">Vendas</th>
                <th className="text-right p-3 font-medium">Falta</th>
              </tr></thead>
              <tbody>
                {goals.map(row => (
                  <tr key={row.developer} className="border-b border-border/20 hover:bg-secondary/30">
                    <td className="p-3 font-medium">{row.developer}</td>
                    <td className="p-3 text-right">{row.meta}</td>
                    <td className="p-3 text-right text-success font-semibold">{row.sales}</td>
                    <td className={cn("p-3 text-right font-semibold", row.remaining <= 2 ? "text-success" : "text-destructive")}>{row.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* CONVERSION METRICS */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Métricas de Conversão</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border/50 text-muted-foreground text-xs">
              <th className="text-left p-3 font-medium">Mês</th>
              <th className="text-right p-3 font-medium">Meta</th>
              <th className="p-3 font-medium">Conversão</th>
              <th className="text-right p-3 font-medium">Atendidos</th>
              <th className="text-right p-3 font-medium">Leads</th>
              <th className="text-right p-3 font-medium">Aprovados</th>
              <th className="text-right p-3 font-medium">Vendas</th>
              <th className="text-right p-3 font-medium">VGV</th>
            </tr></thead>
            <tbody>
              {conversionData.map(row => (
                <tr key={row.month} className="border-b border-border/20 hover:bg-secondary/30">
                  <td className="p-3 font-medium">{row.month}</td>
                  <td className="p-3 text-right">{row.meta}</td>
                  <td className="p-3 w-40">
                    <div className="flex items-center gap-2">
                      <Progress value={row.conversion} className={cn("h-2 flex-1", row.conversion >= 75 ? "[&>div]:bg-success" : "[&>div]:bg-destructive")} />
                      <span className={cn("text-xs font-semibold w-10 text-right", row.conversion >= 75 ? "text-success" : "text-destructive")}>{row.conversion}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-right">{row.attended}</td>
                  <td className="p-3 text-right text-primary">{row.leads}</td>
                  <td className="p-3 text-right text-success">{row.approved}</td>
                  <td className="p-3 text-right font-semibold">{row.sales}</td>
                  <td className="p-3 text-right text-muted-foreground">R$ {(row.vgv / 1000000).toFixed(1)}M</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* BROKER PERFORMANCE + LEAD ORIGIN + CCA */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Broker Performance */}
        <Card className="glass lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Performance dos Corretores</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border/50 text-muted-foreground text-xs">
                <th className="text-left p-3 font-medium">Corretor</th>
                <th className="text-right p-3 font-medium">Meta</th>
                <th className="text-right p-3 font-medium">Leads</th>
                <th className="text-right p-3 font-medium">Aprovados</th>
                <th className="text-right p-3 font-medium">Vendas</th>
                <th className="text-right p-3 font-medium">VGV</th>
                <th className="p-3 font-medium">Conv.</th>
              </tr></thead>
              <tbody>
                {brokerPerformance.map(row => {
                  const aboveTarget = row.sales >= row.meta;
                  return (
                    <tr key={row.name} className="border-b border-border/20 hover:bg-secondary/30">
                      <td className="p-3 font-medium">{row.name}</td>
                      <td className="p-3 text-right">{row.meta}</td>
                      <td className="p-3 text-right text-primary">{row.leads}</td>
                      <td className="p-3 text-right text-success">{row.approved}</td>
                      <td className={cn("p-3 text-right font-bold", aboveTarget ? "text-success" : "text-destructive")}>{row.sales}</td>
                      <td className="p-3 text-right text-muted-foreground">R$ {(row.vgv / 1000000).toFixed(1)}M</td>
                      <td className="p-3 w-28">
                        <div className="flex items-center gap-2">
                          <Progress value={row.conversion} className={cn("h-1.5 flex-1", aboveTarget ? "[&>div]:bg-success" : "[&>div]:bg-destructive")} />
                          <span className="text-xs font-mono">{row.conversion}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Lead Origin */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Origem dos Leads</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {leadOrigins.map(origin => {
              const totalLeads = leadOrigins.reduce((a, o) => a + o.count, 0);
              const pct = (origin.count / totalLeads) * 100;
              return (
                <div key={origin.source}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{origin.source}</span>
                    <span className="font-semibold">{origin.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", origin.color)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* CCA + FUNNEL + RANKING */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* CCA Status */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-success" /> Status CCA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ccaStatus.map(item => (
              <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-secondary/40">
                <div className="flex items-center gap-3">
                  <item.icon className={cn("h-5 w-5", item.color)} />
                  <span className="text-sm">{item.label}</span>
                </div>
                <span className="text-lg font-bold">{item.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Funnel */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Funil de Vendas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {funnelStages.map((stage, i) => {
              const colors = ['bg-primary', 'bg-blue-500', 'bg-cyan-500', 'bg-violet-500', 'bg-emerald-500'];
              return (
                <div key={stage.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{stage.label}</span>
                    <span className="font-semibold">{stage.value.toLocaleString()}</span>
                  </div>
                  <div className="h-8 rounded-md bg-secondary/50 overflow-hidden relative flex items-center">
                    <div className={cn("h-full rounded-md transition-all", colors[i])} style={{ width: `${stage.pct}%`, minWidth: '20px' }} />
                    <span className="absolute right-2 text-[10px] font-mono text-muted-foreground">{stage.pct}%</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Gamification Top 3 */}
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" /> Top Corretores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {mockGamification.sort((a, b) => b.points - a.points).slice(0, 3).map((entry, i) => {
              const medals = ['🥇', '🥈', '🥉'];
              const bgColors = ['bg-amber-500/10 border-amber-500/30', 'bg-gray-400/10 border-gray-400/30', 'bg-orange-600/10 border-orange-600/30'];
              return (
                <div key={entry.id} className={cn("p-3 rounded-lg border", bgColors[i])}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{medals[i]}</span>
                    <div className="flex-1">
                      <p className="font-semibold">{entry.user_name}</p>
                      <p className="text-xs text-muted-foreground">{entry.deals_closed} deals • {entry.calls} ligações</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary">{entry.points}</p>
                      <p className="text-[10px] text-muted-foreground">pontos</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* RANKING GERAL */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" /> Ranking Geral
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border/50 text-muted-foreground text-xs">
              <th className="text-center p-3 font-medium w-12">#</th>
              <th className="text-left p-3 font-medium">Corretor</th>
              <th className="text-right p-3 font-medium">Leads</th>
              <th className="text-right p-3 font-medium">Aprovados</th>
              <th className="text-right p-3 font-medium">Vendas</th>
              <th className="text-right p-3 font-medium">VGV</th>
              <th className="p-3 font-medium">Conv.</th>
            </tr></thead>
            <tbody>
              {brokerPerformance.sort((a, b) => b.sales - a.sales).map((row, i) => {
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <tr key={row.name} className={cn(
                    "border-b border-border/20 hover:bg-secondary/30 transition-colors",
                    i < 3 && "bg-secondary/20"
                  )}>
                    <td className="p-3 text-center">
                      {i < 3 ? <span className="text-lg">{medals[i]}</span> : <span className="text-muted-foreground">{i + 1}</span>}
                    </td>
                    <td className="p-3 font-medium">{row.name}</td>
                    <td className="p-3 text-right text-primary">{row.leads}</td>
                    <td className="p-3 text-right text-success">{row.approved}</td>
                    <td className="p-3 text-right font-bold">{row.sales}</td>
                    <td className="p-3 text-right text-muted-foreground">R$ {(row.vgv / 1000000).toFixed(1)}M</td>
                    <td className="p-3 w-28">
                      <div className="flex items-center gap-2">
                        <Progress value={row.conversion} className={cn("h-1.5 flex-1", row.conversion >= 15 ? "[&>div]:bg-success" : "[&>div]:bg-destructive")} />
                        <span className="text-xs font-mono">{row.conversion}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
