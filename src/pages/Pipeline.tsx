import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { mockDeals as initialDeals, mockBrokers, mockManagers, mockDevelopers, mockProjects } from "@/data/mockData";
import { DEAL_STAGES, type PipelineDeal, type DealStage } from "@/types/crm";
import {
  Plus, Download, Search, Filter, Calendar as CalendarIcon,
  TrendingUp, CheckCircle, Clock, FileText, Eye, BarChart3,
  Info, X, ChevronDown, CalendarCheck, CalendarX, Pencil
} from "lucide-react";
import { format, differenceInDays, isWithinInterval, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

const stageBadge: Record<DealStage, { bg: string; dot: string }> = {
  lead: { bg: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  proposal: { bg: 'bg-primary/15 text-primary', dot: 'bg-primary' },
  visit_scheduled: { bg: 'bg-warning/15 text-warning', dot: 'bg-warning' },
  approved: { bg: 'bg-success/15 text-success', dot: 'bg-success' },
  contract: { bg: 'bg-purple-500/15 text-purple-400', dot: 'bg-purple-400' },
  closed: { bg: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
};

const emptyDeal: Omit<PipelineDeal, 'id' | 'days_in_pipeline'> = {
  client: '', developer: '', project: '', unit: '', status: 'Ativo', stage: 'lead',
  broker1: '', broker2: '', manager1: '', manager2: '', deal_value: 0,
  active: true, created_at: new Date().toISOString().slice(0, 10), notes: '',
};

export default function Pipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>(initialDeals);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [developerFilter, setDeveloperFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>({});

  // Modals
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<PipelineDeal | null>(null);
  const [visitDeal, setVisitDeal] = useState<PipelineDeal | null>(null);
  const [visitDate, setVisitDate] = useState<Date | undefined>();

  // Form state
  const [formData, setFormData] = useState(emptyDeal);

  const allBrokers = [...new Set(deals.flatMap(d => [d.broker1, d.broker2].filter(Boolean)))];
  const allManagers = [...new Set(deals.flatMap(d => [d.manager1, d.manager2].filter(Boolean)))];

  const filtered = useMemo(() => {
    return deals.filter(d => {
      const s = search.toLowerCase();
      const matchSearch = !s || d.client.toLowerCase().includes(s) || d.project.toLowerCase().includes(s) || d.broker1.toLowerCase().includes(s);
      const matchStage = stageFilter === 'all' || d.stage === stageFilter;
      const matchDev = developerFilter === 'all' || d.developer === developerFilter;
      const matchProj = projectFilter === 'all' || d.project === projectFilter;
      const matchBroker = brokerFilter === 'all' || d.broker1 === brokerFilter || d.broker2 === brokerFilter;
      const matchManager = managerFilter === 'all' || d.manager1 === managerFilter || d.manager2 === managerFilter;
      return matchSearch && matchStage && matchDev && matchProj && matchBroker && matchManager;
    });
  }, [deals, search, stageFilter, developerFilter, projectFilter, brokerFilter, managerFilter]);

  // Metrics
  const activeDeals = deals.filter(d => d.active).length;
  const underAnalysis = deals.filter(d => ['proposal', 'visit_scheduled'].includes(d.stage) && d.active).length;
  const approvedDeals = deals.filter(d => d.stage === 'approved' && d.active).length;
  const pendingDeals = deals.filter(d => d.stage === 'lead' && d.active).length;
  const proposalsToday = deals.filter(d => d.stage === 'proposal' && d.created_at === format(new Date(), 'yyyy-MM-dd')).length;
  const proposalsInRange = dateRange.from && dateRange.to
    ? deals.filter(d => {
        try {
          return d.stage === 'proposal' && isWithinInterval(parseISO(d.created_at), { start: dateRange.from!, end: dateRange.to! });
        } catch { return false; }
      }).length
    : 0;

  const metrics = [
    { title: 'Deals Ativos', value: activeDeals, icon: TrendingUp, color: 'text-primary', glow: 'glow-primary' },
    { title: 'Em Análise', value: underAnalysis, icon: BarChart3, color: 'text-warning', glow: 'glow-warning' },
    { title: 'Aprovados', value: approvedDeals, icon: CheckCircle, color: 'text-success', glow: 'glow-success' },
    { title: 'Pendentes', value: pendingDeals, icon: Clock, color: 'text-muted-foreground', glow: '' },
    { title: 'Propostas Hoje', value: proposalsToday, icon: FileText, color: 'text-primary', glow: 'glow-primary' },
    { title: 'Propostas no Período', value: proposalsInRange, icon: CalendarIcon, color: 'text-accent', glow: '' },
  ];

  const toggleActive = (id: string) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, active: !d.active, status: d.active ? 'Inativo' : 'Ativo' } : d));
  };

  const changeStage = (id: string, stage: DealStage) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stage } : d));
  };

  const openNewDeal = () => {
    setEditingDeal(null);
    setFormData(emptyDeal);
    setDealFormOpen(true);
  };

  const openEditDeal = (deal: PipelineDeal) => {
    setEditingDeal(deal);
    setFormData(deal);
    setDealFormOpen(true);
  };

  const saveDeal = () => {
    if (editingDeal) {
      setDeals(prev => prev.map(d => d.id === editingDeal.id ? {
        ...d, ...formData,
        days_in_pipeline: differenceInDays(new Date(), parseISO(formData.created_at)),
      } : d));
    } else {
      const newDeal: PipelineDeal = {
        ...formData as PipelineDeal,
        id: String(Date.now()),
        days_in_pipeline: 0,
      };
      setDeals(prev => [newDeal, ...prev]);
    }
    setDealFormOpen(false);
  };

  const scheduleVisit = () => {
    if (!visitDeal || !visitDate) return;
    setDeals(prev => prev.map(d => d.id === visitDeal.id ? {
      ...d,
      visit_date: format(visitDate, 'yyyy-MM-dd'),
      visit_result: 'pending',
      stage: 'visit_scheduled' as DealStage,
    } : d));
    setVisitDeal(null);
    setVisitDate(undefined);
  };

  const markVisitCompleted = (id: string) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, visit_result: 'completed' } : d));
  };

  const exportCSV = () => {
    const headers = ['Cliente', 'Incorporadora', 'Empreendimento', 'Unidade', 'Etapa', 'Valor', 'Dias Pipeline', 'Corretor 1', 'Corretor 2', 'Gerente 1', 'Gerente 2', 'Ativo', 'Criado em'];
    const rows = filtered.map(d => [d.client, d.developer, d.project, d.unit, d.stage, d.deal_value, d.days_in_pipeline, d.broker1, d.broker2 || '', d.manager1, d.manager2 || '', d.active ? 'Sim' : 'Não', d.created_at]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pipeline_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pipeline de Vendas</h1>
          <p className="text-muted-foreground">{filtered.length} negócios encontrados</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-2" /> Filtros
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-2" /> Exportar
          </Button>
          <Button size="sm" onClick={openNewDeal}>
            <Plus className="h-4 w-4 mr-2" /> Novo Deal
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map(m => (
          <Card key={m.title} className={`glass ${m.glow}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <m.icon className={`h-4 w-4 ${m.color}`} />
                <span className="text-xs text-muted-foreground truncate">{m.title}</span>
              </div>
              <p className="text-2xl font-bold">{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Date Range for proposals metric */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-muted-foreground">Período de propostas:</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs">
              <CalendarIcon className="h-3 w-3 mr-1" />
              {dateRange.from ? format(dateRange.from, 'dd/MM/yyyy') : 'De'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateRange.from} onSelect={(d) => setDateRange(prev => ({ ...prev, from: d }))} className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
        <span className="text-muted-foreground">—</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="text-xs">
              <CalendarIcon className="h-3 w-3 mr-1" />
              {dateRange.to ? format(dateRange.to, 'dd/MM/yyyy') : 'Até'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateRange.to} onSelect={(d) => setDateRange(prev => ({ ...prev, to: d }))} className="p-3 pointer-events-auto" />
          </PopoverContent>
        </Popover>
        {(dateRange.from || dateRange.to) && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setDateRange({})}>
            <X className="h-3 w-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      {/* Search + Filters */}
      <Card className="glass">
        <CardContent className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por cliente, projeto ou corretor..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {showFilters && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 pt-2 border-t border-border/50">
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger><SelectValue placeholder="Etapa" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas Etapas</SelectItem>
                  {DEAL_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={developerFilter} onValueChange={setDeveloperFilter}>
                <SelectTrigger><SelectValue placeholder="Incorporadora" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {mockDevelopers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger><SelectValue placeholder="Empreendimento" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {mockProjects.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={brokerFilter} onValueChange={setBrokerFilter}>
                <SelectTrigger><SelectValue placeholder="Corretor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {allBrokers.map(b => <SelectItem key={b} value={b!}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={managerFilter} onValueChange={setManagerFilter}>
                <SelectTrigger><SelectValue placeholder="Gerente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {allManagers.map(m => <SelectItem key={m} value={m!}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Table */}
      <Card className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/30">
                <th className="p-3 text-left font-medium text-muted-foreground w-10">Info</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Incorporadora</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Empreendimento</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Unid.</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Dias</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Etapa</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Visita</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Cliente</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Corretor 1</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Corretor 2</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Gerente</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Gerente 2</th>
                <th className="p-3 text-left font-medium text-muted-foreground">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal) => {
                const sb = stageBadge[deal.stage];
                return (
                  <tr key={deal.id} className={cn(
                    "border-b border-border/20 hover:bg-secondary/40 transition-colors group",
                    !deal.active && "opacity-40"
                  )}>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button onClick={() => setDetailDeal(deal)} className="text-muted-foreground hover:text-primary transition-colors" title="Detalhes">
                          <Info className="h-4 w-4" />
                        </button>
                        <button onClick={() => openEditDeal(deal)} className="text-muted-foreground hover:text-primary transition-colors opacity-0 group-hover:opacity-100" title="Editar">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className={cn("text-xs font-medium", deal.active ? "text-success" : "text-destructive")}>
                        {deal.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="p-3 text-muted-foreground">{deal.developer}</td>
                    <td className="p-3 font-medium">{deal.project}</td>
                    <td className="p-3">{deal.unit}</td>
                    <td className="p-3">
                      <span className={cn("text-xs font-mono", deal.days_in_pipeline > 30 ? "text-destructive" : deal.days_in_pipeline > 14 ? "text-warning" : "text-muted-foreground")}>
                        {deal.days_in_pipeline}d
                      </span>
                    </td>
                    <td className="p-3">
                      <Select value={deal.stage} onValueChange={(v) => changeStage(deal.id, v as DealStage)}>
                        <SelectTrigger className="h-7 w-36 border-0 bg-transparent p-0">
                          <Badge className={cn(sb.bg, "gap-1.5 cursor-pointer")}>
                            <span className={cn("w-1.5 h-1.5 rounded-full", sb.dot)} />
                            {DEAL_STAGES.find(s => s.value === deal.stage)?.label}
                          </Badge>
                        </SelectTrigger>
                        <SelectContent>
                          {DEAL_STAGES.map(s => (
                            <SelectItem key={s.value} value={s.value}>
                              <span className="flex items-center gap-2">
                                <span className={cn("w-2 h-2 rounded-full", stageBadge[s.value].dot)} />
                                {s.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-3">
                      {deal.visit_date ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setVisitDeal(deal); setVisitDate(parseISO(deal.visit_date!)); }}
                            className={cn("flex items-center gap-1 text-xs", deal.visit_result === 'completed' ? 'text-success' : 'text-warning hover:text-primary')}
                            title={deal.visit_result === 'completed' ? 'Visita concluída' : 'Editar visita'}
                          >
                            {deal.visit_result === 'completed' ? <CalendarCheck className="h-3.5 w-3.5" /> : <CalendarIcon className="h-3.5 w-3.5" />}
                            {format(parseISO(deal.visit_date), 'dd/MM')}
                          </button>
                          {deal.visit_result === 'pending' && (
                            <button onClick={() => markVisitCompleted(deal.id)} className="text-muted-foreground hover:text-success ml-1" title="Marcar concluída">
                              <CheckCircle className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <button onClick={() => { setVisitDeal(deal); setVisitDate(undefined); }} className="text-muted-foreground hover:text-primary transition-colors" title="Agendar visita">
                          <CalendarIcon className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                    <td className="p-3 font-medium">{deal.client}</td>
                    <td className="p-3">{deal.broker1}</td>
                    <td className="p-3 text-muted-foreground">{deal.broker2 || '—'}</td>
                    <td className="p-3">{deal.manager1}</td>
                    <td className="p-3 text-muted-foreground">{deal.manager2 || '—'}</td>
                    <td className="p-3">
                      <Switch checked={deal.active} onCheckedChange={() => toggleActive(deal.id)} />
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={14} className="p-8 text-center text-muted-foreground">
                    Nenhum deal encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Deal Detail Modal */}
      <Dialog open={!!detailDeal} onOpenChange={(o) => !o && setDetailDeal(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" /> Detalhes do Deal
            </DialogTitle>
          </DialogHeader>
          {detailDeal && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium ml-1">{detailDeal.client}</span></div>
                <div><span className="text-muted-foreground">Valor:</span> <span className="font-medium ml-1">R$ {detailDeal.deal_value.toLocaleString('pt-BR')}</span></div>
                <div><span className="text-muted-foreground">Incorporadora:</span> <span className="ml-1">{detailDeal.developer}</span></div>
                <div><span className="text-muted-foreground">Empreendimento:</span> <span className="ml-1">{detailDeal.project}</span></div>
                <div><span className="text-muted-foreground">Unidade:</span> <span className="ml-1">{detailDeal.unit}</span></div>
                <div><span className="text-muted-foreground">Dias no Pipeline:</span> <span className="ml-1">{detailDeal.days_in_pipeline}d</span></div>
                <div><span className="text-muted-foreground">Corretor 1:</span> <span className="ml-1">{detailDeal.broker1}</span></div>
                <div><span className="text-muted-foreground">Corretor 2:</span> <span className="ml-1">{detailDeal.broker2 || '—'}</span></div>
                <div><span className="text-muted-foreground">Gerente 1:</span> <span className="ml-1">{detailDeal.manager1}</span></div>
                <div><span className="text-muted-foreground">Gerente 2:</span> <span className="ml-1">{detailDeal.manager2 || '—'}</span></div>
                <div><span className="text-muted-foreground">Visita:</span> <span className="ml-1">{detailDeal.visit_date || '—'}</span></div>
                <div><span className="text-muted-foreground">Criado em:</span> <span className="ml-1">{detailDeal.created_at}</span></div>
              </div>
              <div>
                <Badge className={stageBadge[detailDeal.stage].bg}>
                  <span className={cn("w-1.5 h-1.5 rounded-full mr-1.5", stageBadge[detailDeal.stage].dot)} />
                  {DEAL_STAGES.find(s => s.value === detailDeal.stage)?.label}
                </Badge>
              </div>
              {detailDeal.notes && (
                <div className="p-3 rounded-lg bg-secondary/50 text-sm">
                  <span className="text-muted-foreground">Notas:</span> {detailDeal.notes}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={() => { openEditDeal(detailDeal); setDetailDeal(null); }}>
                  <Pencil className="h-4 w-4 mr-1" /> Editar
                </Button>
                <DialogClose asChild>
                  <Button variant="outline" size="sm">Fechar</Button>
                </DialogClose>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Deal Form Modal */}
      <Dialog open={dealFormOpen} onOpenChange={setDealFormOpen}>
        <DialogContent className="glass-strong max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingDeal ? 'Editar Deal' : 'Novo Deal'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Cliente *</label>
              <Input value={formData.client} onChange={e => setFormData(p => ({ ...p, client: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Incorporadora</label>
              <Select value={formData.developer} onValueChange={v => setFormData(p => ({ ...p, developer: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockDevelopers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Empreendimento</label>
              <Select value={formData.project} onValueChange={v => setFormData(p => ({ ...p, project: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockProjects.map(pr => <SelectItem key={pr} value={pr}>{pr}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Unidade</label>
              <Input value={formData.unit} onChange={e => setFormData(p => ({ ...p, unit: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Corretor 1</label>
              <Select value={formData.broker1} onValueChange={v => setFormData(p => ({ ...p, broker1: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Corretor 2</label>
              <Select value={formData.broker2 || ''} onValueChange={v => setFormData(p => ({ ...p, broker2: v || undefined }))}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  {mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Gerente 1</label>
              <Select value={formData.manager1} onValueChange={v => setFormData(p => ({ ...p, manager1: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockManagers.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Gerente 2</label>
              <Select value={formData.manager2 || ''} onValueChange={v => setFormData(p => ({ ...p, manager2: v || undefined }))}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Nenhum</SelectItem>
                  {mockManagers.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Valor do Negócio</label>
              <Input type="number" value={formData.deal_value} onChange={e => setFormData(p => ({ ...p, deal_value: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Etapa</label>
              <Select value={formData.stage} onValueChange={v => setFormData(p => ({ ...p, stage: v as DealStage }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEAL_STAGES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm text-muted-foreground mb-1 block">Observações</label>
              <Textarea value={formData.notes || ''} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} />
            </div>
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
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-warning" /> Agendar Visita
            </DialogTitle>
          </DialogHeader>
          {visitDeal && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Cliente: <span className="text-foreground font-medium">{visitDeal.client}</span></p>
              <p className="text-sm text-muted-foreground">Empreendimento: <span className="text-foreground">{visitDeal.project} - {visitDeal.unit}</span></p>
              <Calendar
                mode="single"
                selected={visitDate}
                onSelect={setVisitDate}
                className="p-3 pointer-events-auto rounded-lg border border-border/50"
              />
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
