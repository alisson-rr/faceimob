import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { mockDeals as initialDeals, mockBrokers, mockManagers, mockDevelopers, mockProjects } from "@/data/mockData";
import { DEAL_STAGES, type PipelineDeal, type DealStage } from "@/types/crm";
import {
  Plus, Download, Search, Filter, Calendar as CalendarIcon,
  TrendingUp, CheckCircle, Clock, FileText, Eye, BarChart3,
  X, Pencil, GripVertical, Building2, User, DollarSign,
  CalendarCheck, StickyNote, AlertCircle, ChevronRight
} from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const stageColors: Record<DealStage, { bg: string; border: string; header: string; dot: string; badge: string }> = {
  lead:             { bg: 'bg-muted/30', border: 'border-muted-foreground/20', header: 'bg-muted/50',        dot: 'bg-muted-foreground', badge: 'bg-muted text-muted-foreground' },
  proposal:         { bg: 'bg-primary/5', border: 'border-primary/20',         header: 'bg-primary/10',      dot: 'bg-primary',          badge: 'bg-primary/15 text-primary' },
  visit_scheduled:  { bg: 'bg-warning/5', border: 'border-warning/20',         header: 'bg-warning/10',      dot: 'bg-warning',          badge: 'bg-warning/15 text-warning' },
  under_analysis:   { bg: 'bg-cyan-500/5', border: 'border-cyan-500/20',       header: 'bg-cyan-500/10',     dot: 'bg-cyan-500',         badge: 'bg-cyan-500/15 text-cyan-400' },
  approved:         { bg: 'bg-success/5', border: 'border-success/20',         header: 'bg-success/10',      dot: 'bg-success',          badge: 'bg-success/15 text-success' },
  contract:         { bg: 'bg-purple-500/5', border: 'border-purple-500/20',   header: 'bg-purple-500/10',   dot: 'bg-purple-500',       badge: 'bg-purple-500/15 text-purple-400' },
  closed:           { bg: 'bg-muted/20', border: 'border-muted/30',           header: 'bg-muted/30',        dot: 'bg-muted-foreground', badge: 'bg-muted text-muted-foreground' },
};

const emptyDeal: Omit<PipelineDeal, 'id' | 'days_in_pipeline'> = {
  client: '', developer: '', project: '', unit: '', status: 'Ativo', stage: 'lead',
  broker1: '', broker2: '', manager1: '', manager2: '', deal_value: 0,
  active: true, created_at: new Date().toISOString().slice(0, 10), notes: '',
};

export default function Pipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>(initialDeals);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [developerFilter, setDeveloperFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Modals
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<PipelineDeal | null>(null);
  const [visitDeal, setVisitDeal] = useState<PipelineDeal | null>(null);
  const [visitDate, setVisitDate] = useState<Date | undefined>();
  const [formData, setFormData] = useState(emptyDeal);

  // Drag state
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);

  const filtered = useMemo(() => {
    return deals.filter(d => {
      if (!d.active) return false;
      const s = search.toLowerCase();
      const matchSearch = !s || d.client.toLowerCase().includes(s) || d.project.toLowerCase().includes(s) || d.broker1.toLowerCase().includes(s);
      const matchDev = developerFilter === 'all' || d.developer === developerFilter;
      const matchBroker = brokerFilter === 'all' || d.broker1 === brokerFilter;
      return matchSearch && matchDev && matchBroker;
    });
  }, [deals, search, developerFilter, brokerFilter]);

  const dealsByStage = useMemo(() => {
    const map: Record<DealStage, PipelineDeal[]> = { lead: [], proposal: [], visit_scheduled: [], under_analysis: [], approved: [], contract: [], closed: [] };
    filtered.forEach(d => map[d.stage]?.push(d));
    return map;
  }, [filtered]);

  // Metrics
  const activeDeals = deals.filter(d => d.active).length;
  const underAnalysis = deals.filter(d => ['under_analysis', 'visit_scheduled'].includes(d.stage) && d.active).length;
  const approvedDeals = deals.filter(d => d.stage === 'approved' && d.active).length;
  const pendingDeals = deals.filter(d => d.stage === 'lead' && d.active).length;
  const closedDeals = deals.filter(d => d.stage === 'closed').length;
  const totalVGV = deals.filter(d => d.active).reduce((a, d) => a + d.deal_value, 0);

  // Analytics
  const avgDealValue = activeDeals ? totalVGV / activeDeals : 0;
  const avgDaysInPipeline = activeDeals ? deals.filter(d => d.active).reduce((a, d) => a + d.days_in_pipeline, 0) / activeDeals : 0;
  const brokerDeals = mockBrokers.map(b => ({
    name: b.name,
    count: deals.filter(d => d.broker1 === b.name && d.active).length,
  })).sort((a, b) => b.count - a.count);

  // Drag handlers
  const onDragStart = (dealId: string) => setDraggedDeal(dealId);
  const onDragEnd = () => { setDraggedDeal(null); setDragOverStage(null); };
  const onDragOver = (e: React.DragEvent, stage: DealStage) => { e.preventDefault(); setDragOverStage(stage); };
  const onDrop = (stage: DealStage) => {
    if (draggedDeal) {
      setDeals(prev => prev.map(d => d.id === draggedDeal ? { ...d, stage } : d));
      toast({ title: `Deal movido para ${DEAL_STAGES.find(s => s.value === stage)?.label}` });
    }
    setDraggedDeal(null);
    setDragOverStage(null);
  };

  const openNewDeal = () => { setEditingDeal(null); setFormData(emptyDeal); setDealFormOpen(true); };
  const openEditDeal = (deal: PipelineDeal) => { setEditingDeal(deal); setFormData(deal); setDealFormOpen(true); };

  const saveDeal = () => {
    if (editingDeal) {
      setDeals(prev => prev.map(d => d.id === editingDeal.id ? { ...d, ...formData, days_in_pipeline: differenceInDays(new Date(), parseISO(formData.created_at)) } : d));
    } else {
      setDeals(prev => [{ ...formData as PipelineDeal, id: String(Date.now()), days_in_pipeline: 0 }, ...prev]);
    }
    setDealFormOpen(false);
    toast({ title: editingDeal ? "Deal atualizado" : "Deal criado" });
  };

  const scheduleVisit = () => {
    if (!visitDeal || !visitDate) return;
    setDeals(prev => prev.map(d => d.id === visitDeal.id ? { ...d, visit_date: format(visitDate, 'yyyy-MM-dd'), visit_result: 'pending', stage: 'visit_scheduled' as DealStage } : d));
    setVisitDeal(null); setVisitDate(undefined);
    toast({ title: "Visita agendada" });
  };

  const exportCSV = () => {
    const headers = ['Cliente', 'Incorporadora', 'Empreendimento', 'Unidade', 'Etapa', 'Valor', 'Dias', 'Corretor 1', 'Gerente'];
    const rows = filtered.map(d => [d.client, d.developer, d.project, d.unit, d.stage, d.deal_value, d.days_in_pipeline, d.broker1, d.manager1]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pipeline_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const metrics = [
    { title: 'Ativos', value: activeDeals, icon: TrendingUp, color: 'text-primary', glow: 'glow-primary' },
    { title: 'Em Análise', value: underAnalysis, icon: BarChart3, color: 'text-cyan-400', glow: '' },
    { title: 'Aprovados', value: approvedDeals, icon: CheckCircle, color: 'text-success', glow: 'glow-success' },
    { title: 'Pendentes', value: pendingDeals, icon: Clock, color: 'text-muted-foreground', glow: '' },
    { title: 'Fechados', value: closedDeals, icon: FileText, color: 'text-purple-400', glow: '' },
    { title: 'VGV Total', value: `R$ ${(totalVGV / 1000000).toFixed(1)}M`, icon: DollarSign, color: 'text-success', glow: 'glow-success' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pipeline de Vendas</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} negócios ativos</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}><Filter className="h-4 w-4 mr-1" /> Filtros</Button>
          <Button variant="outline" size="sm" onClick={() => setShowAnalytics(!showAnalytics)}><BarChart3 className="h-4 w-4 mr-1" /> Analytics</Button>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-1" /> Exportar</Button>
          <Button size="sm" onClick={openNewDeal}><Plus className="h-4 w-4 mr-1" /> Novo Deal</Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map(m => (
          <Card key={m.title} className={cn("glass", m.glow)}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <m.icon className={cn("h-4 w-4", m.color)} />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.title}</span>
              </div>
              <p className="text-xl font-bold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="glass">
          <CardContent className="p-3 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar cliente, projeto, corretor..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={developerFilter} onValueChange={setDeveloperFilter}>
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
                {mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        {/* Kanban Board */}
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-3 min-w-max pb-4">
            {DEAL_STAGES.map(stage => {
              const sc = stageColors[stage.value];
              const stageDeals = dealsByStage[stage.value] || [];
              const isOver = dragOverStage === stage.value;
              return (
                <div
                  key={stage.value}
                  className={cn(
                    "w-64 flex-shrink-0 rounded-xl border transition-all",
                    sc.border,
                    isOver && "ring-2 ring-primary/50 scale-[1.01]"
                  )}
                  onDragOver={(e) => onDragOver(e, stage.value)}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={() => onDrop(stage.value)}
                >
                  {/* Column Header */}
                  <div className={cn("p-3 rounded-t-xl flex items-center justify-between", sc.header)}>
                    <div className="flex items-center gap-2">
                      <span className={cn("w-2.5 h-2.5 rounded-full", sc.dot)} />
                      <span className="text-sm font-semibold">{stage.label}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs h-5 px-1.5">{stageDeals.length}</Badge>
                  </div>

                  {/* Cards */}
                  <div className={cn("p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-380px)] overflow-y-auto", sc.bg)}>
                    {stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        draggable
                        onDragStart={() => onDragStart(deal.id)}
                        onDragEnd={onDragEnd}
                        onClick={() => setDetailDeal(deal)}
                        className={cn(
                          "p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg",
                          "bg-card border-border/50 hover:border-primary/30",
                          draggedDeal === deal.id && "opacity-40 scale-95"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="font-medium text-sm leading-tight">{deal.client}</p>
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">{deal.project} • {deal.unit}</p>
                        <p className="text-xs text-muted-foreground/70 mb-2">{deal.developer}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-primary">
                            R$ {deal.deal_value >= 1000000 ? `${(deal.deal_value / 1000000).toFixed(1)}M` : `${(deal.deal_value / 1000).toFixed(0)}k`}
                          </span>
                          <span className={cn("text-[10px] font-mono", deal.days_in_pipeline > 30 ? "text-destructive" : "text-muted-foreground")}>{deal.days_in_pipeline}d</span>
                        </div>
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/30">
                          <div className="flex items-center gap-1 flex-1">
                            <User className="h-3 w-3 text-muted-foreground/60" />
                            <span className="text-[10px] text-muted-foreground truncate">{deal.broker1}</span>
                          </div>
                          <div className="flex gap-1">
                            {deal.visit_date && <CalendarCheck className="h-3 w-3 text-warning" />}
                            {deal.notes && <StickyNote className="h-3 w-3 text-muted-foreground/50" />}
                            {deal.days_in_pipeline > 30 && <AlertCircle className="h-3 w-3 text-destructive/60" />}
                          </div>
                        </div>
                      </div>
                    ))}
                    {stageDeals.length === 0 && (
                      <div className="flex items-center justify-center h-24 text-xs text-muted-foreground/50 border border-dashed border-border/30 rounded-lg">
                        Arraste um deal aqui
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Analytics Panel */}
        {showAnalytics && (
          <div className="w-72 flex-shrink-0 space-y-3">
            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversão por Etapa</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {DEAL_STAGES.slice(0, -1).map((stage, i) => {
                  const current = dealsByStage[stage.value]?.length || 0;
                  const next = dealsByStage[DEAL_STAGES[i + 1]?.value]?.length || 0;
                  const rate = current > 0 ? Math.round((next / current) * 100) : 0;
                  return (
                    <div key={stage.value} className="flex items-center gap-2">
                      <span className={cn("w-2 h-2 rounded-full", stageColors[stage.value].dot)} />
                      <span className="text-xs flex-1">{stage.label}</span>
                      <div className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-xs font-mono text-muted-foreground">{rate}%</span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deals por Corretor</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {brokerDeals.slice(0, 5).map(b => (
                  <div key={b.name} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold">{b.name.charAt(0)}</div>
                    <span className="text-xs flex-1 truncate">{b.name}</span>
                    <span className="text-xs font-bold text-primary">{b.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="glass">
              <CardHeader className="pb-2"><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Indicadores</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Ticket Médio</p>
                  <p className="text-sm font-bold">R$ {(avgDealValue / 1000).toFixed(0)}k</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tempo Médio no Pipeline</p>
                  <p className="text-sm font-bold">{avgDaysInPipeline.toFixed(0)} dias</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Taxa de Fechamento</p>
                  <p className="text-sm font-bold">{activeDeals > 0 ? ((closedDeals / (activeDeals + closedDeals)) * 100).toFixed(1) : 0}%</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Deal Detail Modal */}
      <Dialog open={!!detailDeal} onOpenChange={(o) => !o && setDetailDeal(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Detalhes do Deal</DialogTitle></DialogHeader>
          {detailDeal && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={stageColors[detailDeal.stage].badge}>
                  <span className={cn("w-1.5 h-1.5 rounded-full mr-1.5", stageColors[detailDeal.stage].dot)} />
                  {DEAL_STAGES.find(s => s.value === detailDeal.stage)?.label}
                </Badge>
                <span className="text-sm text-muted-foreground">{detailDeal.days_in_pipeline} dias</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium ml-1">{detailDeal.client}</span></div>
                <div><span className="text-muted-foreground">Valor:</span> <span className="font-medium ml-1 text-primary">R$ {detailDeal.deal_value.toLocaleString('pt-BR')}</span></div>
                <div><span className="text-muted-foreground">Incorporadora:</span> <span className="ml-1">{detailDeal.developer}</span></div>
                <div><span className="text-muted-foreground">Empreendimento:</span> <span className="ml-1">{detailDeal.project}</span></div>
                <div><span className="text-muted-foreground">Unidade:</span> <span className="ml-1">{detailDeal.unit}</span></div>
                <div><span className="text-muted-foreground">Visita:</span> <span className="ml-1">{detailDeal.visit_date || '—'}</span></div>
                <div><span className="text-muted-foreground">Corretor 1:</span> <span className="ml-1">{detailDeal.broker1}</span></div>
                <div><span className="text-muted-foreground">Corretor 2:</span> <span className="ml-1">{detailDeal.broker2 || '—'}</span></div>
                <div><span className="text-muted-foreground">Gerente:</span> <span className="ml-1">{detailDeal.manager1}</span></div>
                <div><span className="text-muted-foreground">Gerente 2:</span> <span className="ml-1">{detailDeal.manager2 || '—'}</span></div>
              </div>
              {detailDeal.notes && <div className="p-3 rounded-lg bg-secondary/50 text-sm"><span className="text-muted-foreground">Notas:</span> {detailDeal.notes}</div>}
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => { openEditDeal(detailDeal); setDetailDeal(null); }}><Pencil className="h-4 w-4 mr-1" /> Editar</Button>
                <Button size="sm" variant="outline" onClick={() => { setVisitDeal(detailDeal); setDetailDeal(null); }}><CalendarIcon className="h-4 w-4 mr-1" /> Visita</Button>
                <DialogClose asChild><Button variant="ghost" size="sm">Fechar</Button></DialogClose>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deal Form Modal */}
      <Dialog open={dealFormOpen} onOpenChange={setDealFormOpen}>
        <DialogContent className="glass-strong max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingDeal ? 'Editar Deal' : 'Novo Deal'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Cliente *</label><Input value={formData.client} onChange={e => setFormData(p => ({ ...p, client: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Incorporadora</label>
              <Select value={formData.developer} onValueChange={v => setFormData(p => ({ ...p, developer: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockDevelopers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Empreendimento</label>
              <Select value={formData.project} onValueChange={v => setFormData(p => ({ ...p, project: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockProjects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Unidade</label><Input value={formData.unit} onChange={e => setFormData(p => ({ ...p, unit: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 1</label>
              <Select value={formData.broker1} onValueChange={v => setFormData(p => ({ ...p, broker1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 2</label>
              <Select value={formData.broker2 || ''} onValueChange={v => setFormData(p => ({ ...p, broker2: v || undefined }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="">Nenhum</SelectItem>{mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 1</label>
              <Select value={formData.manager1} onValueChange={v => setFormData(p => ({ ...p, manager1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockManagers.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 2</label>
              <Select value={formData.manager2 || ''} onValueChange={v => setFormData(p => ({ ...p, manager2: v || undefined }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="">Nenhum</SelectItem>{mockManagers.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Valor</label><Input type="number" value={formData.deal_value} onChange={e => setFormData(p => ({ ...p, deal_value: Number(e.target.value) }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Etapa</label>
              <Select value={formData.stage} onValueChange={v => setFormData(p => ({ ...p, stage: v as DealStage }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DEAL_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><label className="text-sm text-muted-foreground mb-1 block">Observações</label><Textarea value={formData.notes || ''} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveDeal} disabled={!formData.client}>{editingDeal ? 'Salvar' : 'Criar Deal'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visit Modal */}
      <Dialog open={!!visitDeal} onOpenChange={(o) => { if (!o) { setVisitDeal(null); setVisitDate(undefined); } }}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarIcon className="h-5 w-5 text-warning" /> Agendar Visita</DialogTitle></DialogHeader>
          {visitDeal && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Cliente: <span className="text-foreground font-medium">{visitDeal.client}</span></p>
              <p className="text-sm text-muted-foreground">{visitDeal.project} — {visitDeal.unit}</p>
              <Calendar mode="single" selected={visitDate} onSelect={setVisitDate} className="p-3 pointer-events-auto rounded-lg border border-border/50" />
              <DialogFooter>
                <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
                <Button size="sm" onClick={scheduleVisit} disabled={!visitDate}>Agendar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
