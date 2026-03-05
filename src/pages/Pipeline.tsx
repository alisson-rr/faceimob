import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Plus, Download, Filter, Calendar as CalendarIcon,
  Pencil, Eye, ChevronLeft, ChevronRight, Trophy
} from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const stageLabels: Record<string, { label: string; color: string }> = {
  lead: { label: "01. LEAD", color: "bg-muted text-muted-foreground" },
  proposal: { label: "PROPOSTA", color: "bg-blue-600 text-white" },
  visit_scheduled: { label: "05. VISITA AGD", color: "bg-cyan-600 text-white" },
  under_analysis: { label: "06. EM ANÁLISE", color: "bg-yellow-600 text-white" },
  approved: { label: "09. APROV. TOTAL", color: "bg-blue-700 text-white" },
  contract: { label: "10. APROV. COND.", color: "bg-red-600 text-white" },
  closed: { label: "08. VIROU NEGOCIO", color: "bg-slate-700 text-white" },
};

const construtoraColors: Record<string, string> = {
  Cyrela: "bg-teal-600",
  MRV: "bg-teal-600",
  Tenda: "bg-teal-600",
  Eztec: "bg-teal-600",
  Direcional: "bg-teal-600",
  Even: "bg-teal-600",
  VASCO: "bg-teal-600",
};

const emptyDeal: Omit<PipelineDeal, "id" | "days_in_pipeline"> = {
  client: "", developer: "", project: "", unit: "", status: "Ativo", stage: "lead",
  broker1: "", broker2: "", manager1: "", manager2: "", deal_value: 0,
  active: true, created_at: new Date().toISOString().slice(0, 10), notes: "",
};

export default function Pipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>(initialDeals);
  const [search, setSearch] = useState("");
  const [developerFilter, setDeveloperFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 15;

  // Modals
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<PipelineDeal | null>(null);
  const [visitDeal, setVisitDeal] = useState<PipelineDeal | null>(null);
  const [visitDate, setVisitDate] = useState<Date | undefined>();
  const [formData, setFormData] = useState(emptyDeal);

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      const s = search.toLowerCase();
      const matchSearch = !s || d.client.toLowerCase().includes(s) || d.project.toLowerCase().includes(s) || d.broker1.toLowerCase().includes(s);
      const matchDev = developerFilter === "all" || d.developer === developerFilter;
      const matchBroker = brokerFilter === "all" || d.broker1 === brokerFilter;
      return matchSearch && matchDev && matchBroker;
    });
  }, [deals, search, developerFilter, brokerFilter]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // Metrics
  const activeDeals = deals.filter((d) => d.active).length;
  const underAnalysis = deals.filter((d) => ["under_analysis", "visit_scheduled"].includes(d.stage) && d.active).length;
  const approvedTotal = deals.filter((d) => d.stage === "approved" && d.active).length;
  const approvedCond = deals.filter((d) => d.stage === "contract" && d.active).length;
  const pendingDeals = deals.filter((d) => d.stage === "lead" && d.active).length;
  const estadoAgd = deals.filter((d) => d.stage === "visit_scheduled" && d.active).length;

  // Leaderboard
  const leaderboard = mockGamification.sort((a, b) => b.points - a.points).slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const medalBgs = [
    "border-amber-500/50 bg-gradient-to-r from-amber-900/20 to-transparent",
    "border-gray-400/50 bg-gradient-to-r from-gray-700/20 to-transparent",
    "border-orange-600/50 bg-gradient-to-r from-orange-900/20 to-transparent",
  ];

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

  return (
    <div className="space-y-4 text-sm">
      {/* ── TOP: Buttons + Metrics ─────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
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

        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="border border-red-500/50 text-red-400 px-2 py-1 rounded font-semibold">Negócios Ativos: {activeDeals}</span>
          <span className="text-muted-foreground">Em análise: <span className="font-bold text-foreground">{underAnalysis}</span></span>
          <span className="text-muted-foreground">Estado Agd: <span className="font-bold text-foreground">{estadoAgd}</span></span>
          <span className="text-muted-foreground">Aprovado Total: <span className="font-bold text-foreground">{approvedTotal}</span></span>
          <span className="text-muted-foreground">Aprovado Cond.: <span className="font-bold text-foreground">{approvedCond}</span></span>
          <span className="bg-emerald-600 text-white px-2 py-1 rounded font-semibold">Pendentes: {pendingDeals}</span>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="bg-card/70 border-border/50">
          <CardContent className="p-3 flex flex-wrap gap-3">
            <Input placeholder="Buscar cliente, projeto, corretor..." className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
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
          </CardContent>
        </Card>
      )}

      {/* ── LEADERBOARD ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {leaderboard.map((entry, i) => (
          <div
            key={entry.id}
            className={cn("flex items-center gap-4 p-4 rounded-xl border", medalBgs[i])}
          >
            <span className="text-3xl">{medals[i]}</span>
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground">
              {entry.user_name.charAt(0)}
            </div>
            <div>
              <p className="font-semibold">{entry.user_name}</p>
              <p className="text-xs text-amber-400 font-semibold">{entry.points} pontos</p>
            </div>
          </div>
        ))}
      </div>
      <div className="text-right">
        <Button variant="link" size="sm" className="text-xs text-muted-foreground">Ver mais</Button>
      </div>

      {/* ── PIPELINE TABLE ─────────────────────────────────── */}
      <div>
        <h2 className="text-center font-semibold text-base mb-3">Pipeline Faceimob</h2>
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
                  const sl = stageLabels[deal.stage] || stageLabels.lead;
                  const statusDate = deal.created_at ? format(parseISO(deal.created_at), "MM/yy") : "";
                  return (
                    <tr key={deal.id} className="border-b border-border/10 hover:bg-secondary/20 transition-colors">
                      {/* Info - edit icon */}
                      <td className="p-2 text-center">
                        <button onClick={() => openEditDeal(deal)} className="text-muted-foreground hover:text-primary transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      {/* Status */}
                      <td className="p-2">
                        <span className="text-[10px] font-semibold whitespace-nowrap">
                          PROPOSTA {statusDate}
                        </span>
                      </td>
                      {/* Construtora */}
                      <td className="p-2">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold text-white", construtoraColors[deal.developer] || "bg-teal-600")}>
                          {deal.developer.toUpperCase().slice(0, 8)}
                        </span>
                      </td>
                      {/* Empreendimento */}
                      <td className="p-2 whitespace-nowrap max-w-[120px] truncate">{deal.project.toUpperCase()}</td>
                      {/* Unidade */}
                      <td className="p-2 text-center">{deal.unit}</td>
                      {/* Dias */}
                      <td className="p-2 text-center">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold",
                          deal.days_in_pipeline > 60 ? "bg-red-600 text-white" :
                          deal.days_in_pipeline > 30 ? "bg-red-500/70 text-white" :
                          deal.days_in_pipeline > 14 ? "bg-yellow-600/70 text-white" :
                          "text-foreground"
                        )}>
                          {deal.days_in_pipeline}
                        </span>
                      </td>
                      {/* Status 2 */}
                      <td className="p-2">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap", sl.color)}>
                          {sl.label}
                        </span>
                      </td>
                      {/* Visita */}
                      <td className="p-2 text-center">
                        <button
                          onClick={() => { setVisitDeal(deal); }}
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          <CalendarIcon className="h-3.5 w-3.5" />
                        </button>
                      </td>
                      {/* Cliente */}
                      <td className="p-2 whitespace-nowrap max-w-[130px] truncate font-medium">{deal.client.toUpperCase()}</td>
                      {/* Corretor 1 */}
                      <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.broker1?.toUpperCase() || "—"}</td>
                      {/* Corretor 2 */}
                      <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.broker2?.toUpperCase() || "—"}</td>
                      {/* Gerente 1 */}
                      <td className="p-2 whitespace-nowrap max-w-[100px] truncate">• {deal.manager1?.toUpperCase() || "—"}</td>
                      {/* Gerente 2 */}
                      <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.manager2?.toUpperCase() || ""}</td>
                      {/* Off toggle */}
                      <td className="p-2 text-center">
                        <Switch
                          checked={deal.active}
                          onCheckedChange={() => toggleDealActive(deal.id)}
                          className="scale-75"
                        />
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
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="hover:text-foreground disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── DEAL DETAIL MODAL ──────────────────────────────── */}
      <Dialog open={!!detailDeal} onOpenChange={(o) => !o && setDetailDeal(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" /> Detalhes do Deal</DialogTitle></DialogHeader>
          {detailDeal && (
            <div className="space-y-4">
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
              <Select value={formData.broker2 || ""} onValueChange={(v) => setFormData((p) => ({ ...p, broker2: v || undefined }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="">Nenhum</SelectItem>{mockBrokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 1</label>
              <Select value={formData.manager1} onValueChange={(v) => setFormData((p) => ({ ...p, manager1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockManagers.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 2</label>
              <Select value={formData.manager2 || ""} onValueChange={(v) => setFormData((p) => ({ ...p, manager2: v || undefined }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="">Nenhum</SelectItem>{mockManagers.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
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
