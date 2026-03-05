import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { mockDeals as initialDeals, mockBrokers, mockManagers, mockDevelopers, mockProjects, mockGamification } from "@/data/mockData";
import { DEAL_STAGES, type PipelineDeal, type DealStage } from "@/types/crm";
import { calcDealProbability } from "@/lib/aiAnalytics";
import {
  Plus, Download, Search, Filter, Calendar as CalendarIcon,
  TrendingUp, CheckCircle, Clock, FileText, Eye, BarChart3,
  X, Pencil, GripVertical, User, DollarSign,
  CalendarCheck, StickyNote, AlertCircle, ChevronRight,
  ChevronLeft, Trophy, LayoutGrid, List
} from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// ── Stage visual config ──
const stageColors: Record<DealStage, { bg: string; border: string; header: string; dot: string; badge: string }> = {
  lead:            { bg: "bg-muted/20", border: "border-muted-foreground/20", header: "bg-muted/40", dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground" },
  proposal:        { bg: "bg-primary/5", border: "border-primary/25", header: "bg-primary/15", dot: "bg-primary", badge: "bg-primary/20 text-primary" },
  visit_scheduled: { bg: "bg-warning/5", border: "border-warning/25", header: "bg-warning/15", dot: "bg-warning", badge: "bg-warning/20 text-warning" },
  under_analysis:  { bg: "bg-cyan-500/5", border: "border-cyan-500/25", header: "bg-cyan-500/15", dot: "bg-cyan-500", badge: "bg-cyan-500/20 text-cyan-400" },
  approved:        { bg: "bg-success/5", border: "border-success/25", header: "bg-success/15", dot: "bg-success", badge: "bg-success/20 text-success" },
  contract:        { bg: "bg-purple-500/5", border: "border-purple-500/25", header: "bg-purple-500/15", dot: "bg-purple-500", badge: "bg-purple-500/20 text-purple-400" },
  closed:          { bg: "bg-emerald-600/5", border: "border-emerald-600/25", header: "bg-emerald-600/15", dot: "bg-emerald-600", badge: "bg-emerald-600/20 text-emerald-400" },
};

const tableStageLabels: Record<string, { label: string; color: string }> = {
  lead: { label: "01. LEAD", color: "bg-muted text-muted-foreground" },
  proposal: { label: "PROPOSTA", color: "bg-primary text-primary-foreground" },
  visit_scheduled: { label: "05. VISITA AGD", color: "bg-cyan-600 text-white" },
  under_analysis: { label: "06. EM ANÁLISE", color: "bg-yellow-600 text-white" },
  approved: { label: "09. APROV. TOTAL", color: "bg-blue-700 text-white" },
  contract: { label: "10. APROV. COND.", color: "bg-red-600 text-white" },
  closed: { label: "08. VIROU NEGOCIO", color: "bg-slate-700 text-white" },
};

const emptyDeal: Omit<PipelineDeal, "id" | "days_in_pipeline"> = {
  client: "", developer: "", project: "", unit: "", status: "Ativo", stage: "lead",
  broker1: "", broker2: "", manager1: "", manager2: "", deal_value: 0,
  active: true, created_at: new Date().toISOString().slice(0, 10), notes: "",
};

export default function Pipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>(initialDeals);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [developerFilter, setDeveloperFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [page, setPage] = useState(1);
  const perPage = 15;

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
    return deals.filter((d) => {
      const s = search.toLowerCase();
      const matchSearch = !s || d.client.toLowerCase().includes(s) || d.project.toLowerCase().includes(s) || d.broker1.toLowerCase().includes(s);
      const matchDev = developerFilter === "all" || d.developer === developerFilter;
      const matchBroker = brokerFilter === "all" || d.broker1 === brokerFilter;
      return matchSearch && matchDev && matchBroker;
    });
  }, [deals, search, developerFilter, brokerFilter]);

  const dealsByStage = useMemo(() => {
    const map: Record<DealStage, PipelineDeal[]> = { lead: [], proposal: [], visit_scheduled: [], under_analysis: [], approved: [], contract: [], closed: [] };
    filtered.filter((d) => d.active).forEach((d) => map[d.stage]?.push(d));
    return map;
  }, [filtered]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // Metrics
  const activeDeals = deals.filter((d) => d.active).length;
  const underAnalysis = deals.filter((d) => ["under_analysis", "visit_scheduled"].includes(d.stage) && d.active).length;
  const approvedDeals = deals.filter((d) => d.stage === "approved" && d.active).length;
  const pendingDeals = deals.filter((d) => d.stage === "lead" && d.active).length;
  const closedDeals = deals.filter((d) => d.stage === "closed").length;
  const totalVGV = deals.filter((d) => d.active).reduce((a, d) => a + d.deal_value, 0);

  // Analytics
  const avgDealValue = activeDeals ? totalVGV / activeDeals : 0;
  const avgDaysInPipeline = activeDeals ? deals.filter((d) => d.active).reduce((a, d) => a + d.days_in_pipeline, 0) / activeDeals : 0;
  const brokerDeals = mockBrokers.map((b) => ({
    name: b.name,
    count: deals.filter((d) => d.broker1 === b.name && d.active).length,
  })).sort((a, b) => b.count - a.count);

  // Leaderboard
  const leaderboard = [...mockGamification].sort((a, b) => b.points - a.points).slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const medalBgs = [
    "border-amber-500/40 bg-gradient-to-r from-amber-900/20 to-transparent",
    "border-gray-400/40 bg-gradient-to-r from-gray-700/20 to-transparent",
    "border-orange-600/40 bg-gradient-to-r from-orange-900/20 to-transparent",
  ];

  // Drag handlers
  const onDragStart = useCallback((dealId: string) => setDraggedDeal(dealId), []);
  const onDragEnd = useCallback(() => { setDraggedDeal(null); setDragOverStage(null); }, []);
  const onDragOver = useCallback((e: React.DragEvent, stage: DealStage) => { e.preventDefault(); setDragOverStage(stage); }, []);
  const onDrop = useCallback((stage: DealStage) => {
    if (draggedDeal) {
      setDeals((prev) => prev.map((d) => d.id === draggedDeal ? { ...d, stage } : d));
      toast({ title: `Deal movido para ${DEAL_STAGES.find((s) => s.value === stage)?.label}` });
    }
    setDraggedDeal(null);
    setDragOverStage(null);
  }, [draggedDeal]);

  const openNewDeal = () => { setEditingDeal(null); setFormData(emptyDeal); setDealFormOpen(true); };
  const openEditDeal = (deal: PipelineDeal) => { setEditingDeal(deal); setFormData(deal); setDealFormOpen(true); };

  const saveDeal = () => {
    if (editingDeal) {
      setDeals((prev) => prev.map((d) => d.id === editingDeal.id ? { ...d, ...formData, days_in_pipeline: differenceInDays(new Date(), parseISO(formData.created_at)) } : d));
    } else {
      setDeals((prev) => [{ ...(formData as PipelineDeal), id: String(Date.now()), days_in_pipeline: 0 }, ...prev]);
    }
    setDealFormOpen(false);
    toast({ title: editingDeal ? "Deal atualizado" : "Deal criado" });
  };

  const toggleDealActive = (dealId: string) => {
    setDeals((prev) => prev.map((d) => d.id === dealId ? { ...d, active: !d.active } : d));
  };

  const scheduleVisit = () => {
    if (!visitDeal || !visitDate) return;
    setDeals((prev) => prev.map((d) => d.id === visitDeal.id ? { ...d, visit_date: format(visitDate, "yyyy-MM-dd"), visit_result: "pending", stage: "visit_scheduled" as DealStage } : d));
    setVisitDeal(null); setVisitDate(undefined);
    toast({ title: "Visita agendada" });
  };

  const exportCSV = () => {
    const headers = ["Cliente", "Incorporadora", "Empreendimento", "Unidade", "Etapa", "Valor", "Dias", "Corretor 1", "Gerente"];
    const rows = filtered.map((d) => [d.client, d.developer, d.project, d.unit, d.stage, d.deal_value, d.days_in_pipeline, d.broker1, d.manager1]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `pipeline_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
  };

  const metrics = [
    { title: "Negócios Ativos", value: activeDeals, icon: TrendingUp, color: "text-primary" },
    { title: "Em Análise", value: underAnalysis, icon: BarChart3, color: "text-cyan-400" },
    { title: "Aprovados", value: approvedDeals, icon: CheckCircle, color: "text-success" },
    { title: "Pendentes", value: pendingDeals, icon: Clock, color: "text-muted-foreground" },
    { title: "Fechados", value: closedDeals, icon: FileText, color: "text-purple-400" },
    { title: "VGV Total", value: `R$ ${(totalVGV / 1000000).toFixed(1)}M`, icon: DollarSign, color: "text-success" },
  ];

  return (
    <div className="space-y-4">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-1" /> Filtrar Negócio
          </Button>
          <Button size="sm" onClick={openNewDeal}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar Negócio
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" /> Extrair Negócio
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("kanban")}
              className={cn("p-1.5 transition-colors", viewMode === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={cn("p-1.5 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAnalytics(!showAnalytics)}>
            <BarChart3 className="h-4 w-4 mr-1" /> Analytics
          </Button>
        </div>
      </div>

      {/* ── METRICS ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {metrics.map((m) => (
          <Card key={m.title} className="border-border/50 bg-card/70">
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

      {/* ── LEADERBOARD ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {leaderboard.map((entry, i) => (
          <div key={entry.id} className={cn("flex items-center gap-4 p-4 rounded-xl border", medalBgs[i])}>
            <span className="text-3xl">{medals[i]}</span>
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground">
              {entry.user_name.charAt(0)}
            </div>
            <div>
              <p className="font-semibold text-sm">{entry.user_name}</p>
              <p className="text-xs text-amber-400 font-semibold">{entry.points} pontos</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── FILTERS ────────────────────────────────────────── */}
      {showFilters && (
        <Card className="bg-card/70 border-border/50">
          <CardContent className="p-3 flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar cliente, projeto, corretor..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={developerFilter} onValueChange={setDeveloperFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Incorporadora" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {mockDevelopers.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={brokerFilter} onValueChange={setBrokerFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Corretor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {mockBrokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => { setDeveloperFilter("all"); setBrokerFilter("all"); setSearch(""); }}>
              <X className="h-3 w-3 mr-1" /> Limpar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── MAIN CONTENT ───────────────────────────────────── */}
      <div className="flex gap-4">
        <div className="flex-1 overflow-hidden">
          <h2 className="text-center font-semibold text-base mb-3">Pipeline Faceimob</h2>

          {viewMode === "kanban" ? (
            /* ═══ KANBAN VIEW ═══ */
            <div className="overflow-x-auto">
              <div className="flex gap-3 min-w-max pb-4">
                {DEAL_STAGES.map((stage) => {
                  const sc = stageColors[stage.value];
                  const stageDeals = dealsByStage[stage.value] || [];
                  const isOver = dragOverStage === stage.value;
                  return (
                    <div
                      key={stage.value}
                      className={cn(
                        "w-60 flex-shrink-0 rounded-xl border transition-all",
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
                          <span className="text-xs font-semibold">{stage.label}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{stageDeals.length}</Badge>
                      </div>

                      {/* Cards */}
                      <div className={cn("p-2 space-y-2 min-h-[180px] max-h-[calc(100vh-420px)] overflow-y-auto", sc.bg)}>
                        {stageDeals.map((deal) => (
                          <div
                            key={deal.id}
                            draggable
                            onDragStart={() => onDragStart(deal.id)}
                            onDragEnd={onDragEnd}
                            onClick={() => setDetailDeal(deal)}
                            className={cn(
                              "p-3 rounded-lg border cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg",
                              "bg-card border-border/40 hover:border-primary/30",
                              draggedDeal === deal.id && "opacity-40 scale-95"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <p className="font-medium text-xs leading-tight">{deal.client}</p>
                              <GripVertical className="h-3 w-3 text-muted-foreground/40 flex-shrink-0" />
                            </div>
                            <p className="text-[10px] text-muted-foreground mb-0.5">{deal.project} • {deal.unit}</p>
                            <p className="text-[10px] text-muted-foreground/60 mb-2">{deal.developer}</p>
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-primary">
                                R$ {deal.deal_value >= 1000000 ? `${(deal.deal_value / 1000000).toFixed(1)}M` : `${(deal.deal_value / 1000).toFixed(0)}k`}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className={cn("text-[9px] font-bold px-1 py-0.5 rounded",
                                  calcDealProbability(deal) >= 60 ? "bg-emerald-600/20 text-emerald-400" :
                                  calcDealProbability(deal) >= 35 ? "bg-warning/20 text-warning" : "bg-destructive/20 text-destructive"
                                )}>{calcDealProbability(deal)}%</span>
                                <span className={cn("text-[10px] font-mono", deal.days_in_pipeline > 30 ? "text-destructive" : "text-muted-foreground")}>{deal.days_in_pipeline}d</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-border/20">
                              <div className="flex items-center gap-1 flex-1">
                                <User className="h-3 w-3 text-muted-foreground/50" />
                                <span className="text-[10px] text-muted-foreground truncate">{deal.broker1}</span>
                              </div>
                              <div className="flex gap-1">
                                {deal.visit_date && <CalendarCheck className="h-3 w-3 text-warning" />}
                                {deal.notes && <StickyNote className="h-3 w-3 text-muted-foreground/40" />}
                                {deal.days_in_pipeline > 30 && <AlertCircle className="h-3 w-3 text-destructive/50" />}
                              </div>
                            </div>
                          </div>
                        ))}
                        {stageDeals.length === 0 && (
                          <div className="flex items-center justify-center h-20 text-[10px] text-muted-foreground/40 border border-dashed border-border/30 rounded-lg">
                            Arraste um deal aqui
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ═══ TABLE VIEW ═══ */
            <>
              <Card className="border-border/50 bg-card/60 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/40 text-muted-foreground">
                        <th className="p-2 font-medium">Info.</th>
                        <th className="p-2 font-medium text-left">Status</th>
                        <th className="p-2 font-medium text-left">Construtora</th>
                        <th className="p-2 font-medium text-left">Empreendimento</th>
                        <th className="p-2 font-medium">Unidade</th>
                        <th className="p-2 font-medium">Dias</th>
                        <th className="p-2 font-medium text-left">Status 2</th>
                        <th className="p-2 font-medium">Visita</th>
                        <th className="p-2 font-medium text-left">Cliente</th>
                        <th className="p-2 font-medium text-left">Corretor 1</th>
                        <th className="p-2 font-medium text-left">Corretor 2</th>
                        <th className="p-2 font-medium text-left">Gerente 1</th>
                        <th className="p-2 font-medium text-left">Gerente 2</th>
                        <th className="p-2 font-medium">Off</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((deal) => {
                        const sl = tableStageLabels[deal.stage] || tableStageLabels.lead;
                        const statusDate = deal.created_at ? format(parseISO(deal.created_at), "MM/yy") : "";
                        return (
                          <tr key={deal.id} className="border-b border-border/10 hover:bg-secondary/20 transition-colors">
                            <td className="p-2 text-center">
                              <button onClick={() => openEditDeal(deal)} className="text-muted-foreground hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                            </td>
                            <td className="p-2"><span className="text-[10px] font-semibold whitespace-nowrap">PROPOSTA {statusDate}</span></td>
                            <td className="p-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold text-white bg-teal-600">{deal.developer.toUpperCase().slice(0, 8)}</span>
                            </td>
                            <td className="p-2 whitespace-nowrap max-w-[120px] truncate">{deal.project.toUpperCase()}</td>
                            <td className="p-2 text-center">{deal.unit}</td>
                            <td className="p-2 text-center">
                              <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] font-bold",
                                deal.days_in_pipeline > 60 ? "bg-red-600 text-white" :
                                deal.days_in_pipeline > 30 ? "bg-red-500/70 text-white" :
                                deal.days_in_pipeline > 14 ? "bg-yellow-600/70 text-white" : "text-foreground"
                              )}>{deal.days_in_pipeline}</span>
                            </td>
                            <td className="p-2">
                              <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap", sl.color)}>{sl.label}</span>
                            </td>
                            <td className="p-2 text-center">
                              <button onClick={() => setVisitDeal(deal)} className="text-muted-foreground hover:text-primary"><CalendarIcon className="h-3.5 w-3.5" /></button>
                            </td>
                            <td className="p-2 whitespace-nowrap max-w-[130px] truncate font-medium">{deal.client.toUpperCase()}</td>
                            <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.broker1?.toUpperCase() || "—"}</td>
                            <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.broker2?.toUpperCase() || "—"}</td>
                            <td className="p-2 whitespace-nowrap max-w-[100px] truncate">• {deal.manager1?.toUpperCase() || "—"}</td>
                            <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.manager2?.toUpperCase() || ""}</td>
                            <td className="p-2 text-center">
                              <Switch checked={deal.active} onCheckedChange={() => toggleDealActive(deal.id)} className="scale-75" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              {/* Pagination */}
              <div className="flex items-center justify-center gap-3 mt-3 text-xs text-muted-foreground">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="hover:text-foreground disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span>{(page - 1) * perPage + 1} a {Math.min(page * perPage, filtered.length)}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="hover:text-foreground disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── ANALYTICS PANEL ────────────────────────────────── */}
        {showAnalytics && (
          <div className="w-64 flex-shrink-0 space-y-3">
            <Card className="bg-card/70 border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Conversão por Etapa</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {DEAL_STAGES.slice(0, -1).map((stage, i) => {
                  const current = dealsByStage[stage.value]?.length || 0;
                  const next = dealsByStage[DEAL_STAGES[i + 1]?.value]?.length || 0;
                  const rate = current > 0 ? Math.round((next / current) * 100) : 0;
                  return (
                    <div key={stage.value} className="flex items-center gap-2">
                      <span className={cn("w-2 h-2 rounded-full", stageColors[stage.value].dot)} />
                      <span className="text-[10px] flex-1">{stage.label}</span>
                      <div className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                        <span className="text-[10px] font-mono text-muted-foreground">{rate}%</span>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="bg-card/70 border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Deals por Corretor</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {brokerDeals.slice(0, 5).map((b) => (
                  <div key={b.name} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold">{b.name.charAt(0)}</div>
                    <span className="text-[10px] flex-1 truncate">{b.name}</span>
                    <span className="text-[10px] font-bold text-primary">{b.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-card/70 border-border/50">
              <CardHeader className="pb-2"><CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Indicadores</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Ticket Médio</p>
                  <p className="text-sm font-bold">R$ {(avgDealValue / 1000).toFixed(0)}k</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Tempo Médio</p>
                  <p className="text-sm font-bold">{avgDaysInPipeline.toFixed(0)} dias</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Taxa de Fechamento</p>
                  <p className="text-sm font-bold">{activeDeals > 0 ? ((closedDeals / (activeDeals + closedDeals)) * 100).toFixed(1) : 0}%</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── DEAL DETAIL MODAL ──────────────────────────────── */}
      <Dialog open={!!detailDeal} onOpenChange={(o) => !o && setDetailDeal(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Detalhes do Deal</DialogTitle></DialogHeader>
          {detailDeal && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={stageColors[detailDeal.stage].badge}>
                  <span className={cn("w-1.5 h-1.5 rounded-full mr-1.5", stageColors[detailDeal.stage].dot)} />
                  {DEAL_STAGES.find((s) => s.value === detailDeal.stage)?.label}
                </Badge>
                <span className="text-sm text-muted-foreground">{detailDeal.days_in_pipeline} dias</span>
                <span className={cn("text-xs font-bold px-2 py-0.5 rounded",
                  calcDealProbability(detailDeal) >= 60 ? "bg-emerald-600/20 text-emerald-400" :
                  calcDealProbability(detailDeal) >= 35 ? "bg-warning/20 text-warning" : "bg-destructive/20 text-destructive"
                )}>Probabilidade: {calcDealProbability(detailDeal)}%</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium ml-1">{detailDeal.client}</span></div>
                <div><span className="text-muted-foreground">Valor:</span> <span className="font-medium ml-1 text-primary">R$ {detailDeal.deal_value.toLocaleString("pt-BR")}</span></div>
                <div><span className="text-muted-foreground">Incorporadora:</span> <span className="ml-1">{detailDeal.developer}</span></div>
                <div><span className="text-muted-foreground">Empreendimento:</span> <span className="ml-1">{detailDeal.project}</span></div>
                <div><span className="text-muted-foreground">Unidade:</span> <span className="ml-1">{detailDeal.unit}</span></div>
                <div><span className="text-muted-foreground">Visita:</span> <span className="ml-1">{detailDeal.visit_date || "—"}</span></div>
                <div><span className="text-muted-foreground">Corretor 1:</span> <span className="ml-1">{detailDeal.broker1}</span></div>
                <div><span className="text-muted-foreground">Corretor 2:</span> <span className="ml-1">{detailDeal.broker2 || "—"}</span></div>
                <div><span className="text-muted-foreground">Gerente:</span> <span className="ml-1">{detailDeal.manager1}</span></div>
                <div><span className="text-muted-foreground">Gerente 2:</span> <span className="ml-1">{detailDeal.manager2 || "—"}</span></div>
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

      {/* ── DEAL FORM MODAL ────────────────────────────────── */}
      <Dialog open={dealFormOpen} onOpenChange={setDealFormOpen}>
        <DialogContent className="glass-strong max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingDeal ? "Editar Deal" : "Novo Deal"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Cliente *</label><Input value={formData.client} onChange={(e) => setFormData((p) => ({ ...p, client: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Incorporadora</label>
              <Select value={formData.developer} onValueChange={(v) => setFormData((p) => ({ ...p, developer: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockDevelopers.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Empreendimento</label>
              <Select value={formData.project} onValueChange={(v) => setFormData((p) => ({ ...p, project: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockProjects.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Unidade</label><Input value={formData.unit} onChange={(e) => setFormData((p) => ({ ...p, unit: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 1</label>
              <Select value={formData.broker1} onValueChange={(v) => setFormData((p) => ({ ...p, broker1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockBrokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 2</label>
              <Select value={formData.broker2 || "none"} onValueChange={(v) => setFormData((p) => ({ ...p, broker2: v === "none" ? undefined : v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{mockBrokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 1</label>
              <Select value={formData.manager1} onValueChange={(v) => setFormData((p) => ({ ...p, manager1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockManagers.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 2</label>
              <Select value={formData.manager2 || "none"} onValueChange={(v) => setFormData((p) => ({ ...p, manager2: v === "none" ? undefined : v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{mockManagers.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Valor</label><Input type="number" value={formData.deal_value} onChange={(e) => setFormData((p) => ({ ...p, deal_value: Number(e.target.value) }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Etapa</label>
              <Select value={formData.stage} onValueChange={(v) => setFormData((p) => ({ ...p, stage: v as DealStage }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DEAL_STAGES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><label className="text-sm text-muted-foreground mb-1 block">Observações</label><Textarea value={formData.notes || ""} onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))} rows={3} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveDeal} disabled={!formData.client}>{editingDeal ? "Salvar" : "Criar Deal"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── VISIT MODAL ────────────────────────────────────── */}
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
