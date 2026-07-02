import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import DealDetailModal from "@/components/DealDetailModal";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { mockDeals as initialDeals, mockDevelopers, mockProjects, mockGamification, mockLeads as initialLeads, mockSources } from "@/data/mockData";
import { DEAL_STAGES, type PipelineDeal, type DealStage, LEAD_STATUSES, type Lead, type LeadStatus, type Broker } from "@/types/crm";
import { calcDealProbability } from "@/lib/aiAnalytics";
import {
  Plus, Download, Search, Filter, Calendar as CalendarIcon,
  TrendingUp, CheckCircle, Clock, FileText, Eye, BarChart3,
  X, Pencil, GripVertical, User, DollarSign,
  CalendarCheck, StickyNote, AlertCircle, ChevronRight,
  ChevronLeft, Trophy, LayoutGrid, List, LogIn, Users,
  ArrowRightCircle, Upload, Paperclip, Phone, Mail, MessageCircle, UserPlus,
  Lock, AlertTriangle, Target, RefreshCw
} from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

const ccaDevelopers = ['MRV', 'Tenda', 'Direcional', 'TENDA'];

// ── Developer color map (distinct colors per developer) ──
const developerColors: Record<string, string> = {
  Cyrela: "bg-teal-600",
  MRV: "bg-amber-600",
  Tenda: "bg-rose-600",
  Eztec: "bg-violet-600",
  Direcional: "bg-sky-600",
  Even: "bg-lime-600",
};
const getDeveloperColor = (dev: string) => developerColors[dev] || "bg-muted";

// ── Stage visual config ──
const stageColors: Record<DealStage, { bg: string; border: string; header: string; dot: string; badge: string }> = {
  incomplete:      { bg: "bg-destructive/5", border: "border-destructive/25", header: "bg-destructive/15", dot: "bg-destructive", badge: "bg-destructive/20 text-destructive" },
  lead:            { bg: "bg-muted/20", border: "border-muted-foreground/20", header: "bg-muted/40", dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground" },
  proposal:        { bg: "bg-primary/5", border: "border-primary/25", header: "bg-primary/15", dot: "bg-primary", badge: "bg-primary/20 text-primary" },
  visit_scheduled: { bg: "bg-warning/5", border: "border-warning/25", header: "bg-warning/15", dot: "bg-warning", badge: "bg-warning/20 text-warning" },
  under_analysis:  { bg: "bg-cyan-500/5", border: "border-cyan-500/25", header: "bg-cyan-500/15", dot: "bg-cyan-500", badge: "bg-cyan-500/20 text-cyan-400" },
  approved:        { bg: "bg-success/5", border: "border-success/25", header: "bg-success/15", dot: "bg-success", badge: "bg-success/20 text-success" },
  contract:        { bg: "bg-purple-500/5", border: "border-purple-500/25", header: "bg-purple-500/15", dot: "bg-purple-500", badge: "bg-purple-500/20 text-purple-400" },
  closed:          { bg: "bg-emerald-600/5", border: "border-emerald-600/25", header: "bg-emerald-600/15", dot: "bg-emerald-600", badge: "bg-emerald-600/20 text-emerald-400" },
};

const tableStageLabels: Record<string, { label: string; color: string }> = {
  incomplete: { label: "INCOMPLETO", color: "bg-destructive text-destructive-foreground" },
  lead: { label: "01. LEAD", color: "bg-muted text-muted-foreground" },
  proposal: { label: "PROPOSTA", color: "bg-primary text-primary-foreground" },
  visit_scheduled: { label: "05. VISITA AGD", color: "bg-cyan-600 text-white" },
  under_analysis: { label: "06. EM ANÁLISE", color: "bg-yellow-600 text-white" },
  approved: { label: "09. APROV. TOTAL", color: "bg-blue-700 text-white" },
  contract: { label: "10. APROV. COND.", color: "bg-red-600 text-white" },
  closed: { label: "08. VIROU NEGOCIO", color: "bg-slate-700 text-white" },
};

// ── Faceimob status list (Status 2 column) ──
const FACEIMOB_STATUSES: { label: string; color: string }[] = [
  { label: "01. RC EMITIDA", color: "bg-orange-500 text-white" },
  { label: "02. ASS. BANCO", color: "bg-blue-600 text-white" },
  { label: "03. ASSINADO", color: "bg-emerald-600 text-white" },
  { label: "04. EM CONTRATO", color: "bg-red-500 text-white" },
  { label: "05. RP APROVADO", color: "bg-emerald-700 text-white" },
  { label: "06. ENVIO DE RP", color: "bg-cyan-600 text-white" },
  { label: "07. APROV. AG. CONT.", color: "bg-amber-600 text-white" },
  { label: "08. VIROU NEGÓCIO", color: "bg-slate-700 text-white" },
  { label: "09. APROV. TOTAL", color: "bg-blue-700 text-white" },
  { label: "10. APROV. COND.", color: "bg-red-600 text-white" },
  { label: "11. AG. RET. AGENCIA", color: "bg-orange-600 text-white" },
  { label: "12. EM PROCESSAMENTO", color: "bg-purple-600 text-white" },
  { label: "13. ESTEIRA AGIL", color: "bg-teal-600 text-white" },
  { label: "14. PENDENTE P/ VIRAR NEGÓCIO", color: "bg-yellow-600 text-white" },
  { label: "15. ANÁLISE P/ VIRAR NEGÓCIO", color: "bg-amber-700 text-white" },
  { label: "15. INTERNALIZADO", color: "bg-indigo-600 text-white" },
  { label: "16. PENDENTE", color: "bg-yellow-700 text-white" },
  { label: "17. DISTRATO", color: "bg-rose-700 text-white" },
  { label: "18. QUEDA", color: "bg-red-700 text-white" },
  { label: "19. REPROVADO", color: "bg-red-800 text-white" },
  { label: "20. BACEN", color: "bg-fuchsia-700 text-white" },
  { label: "21. RESTRIÇÃO", color: "bg-pink-700 text-white" },
  { label: "ANÁLISE P/ POTENCIAL", color: "bg-cyan-700 text-white" },
  { label: "ANÁLISE EXTERNA", color: "bg-sky-700 text-white" },
  { label: "MUDAR CONSTRUTORA P/ NEGÓCIO", color: "bg-violet-700 text-white" },
  { label: "APROV. TOT. RESTRIÇÃO", color: "bg-rose-600 text-white" },
  { label: "RET. ESTEIRA AGIL", color: "bg-teal-700 text-white" },
  { label: "PENDENTE C/ RESTRIÇÃO", color: "bg-amber-800 text-white" },
  { label: "INCOMPLETO", color: "bg-destructive text-destructive-foreground" },
  { label: "COMPRA ASSISTIDA", color: "bg-emerald-800 text-white" },
  { label: "PROPOSTA", color: "bg-primary text-primary-foreground" },
];
const faceimobStatusColor = (label: string) =>
  FACEIMOB_STATUSES.find(s => s.label === label)?.color || "bg-muted text-muted-foreground";

const leadStatusColor: Record<LeadStatus, string> = {
  new: 'bg-primary/20 text-primary',
  contacted: 'bg-warning/20 text-warning',
  qualified: 'bg-success/20 text-success',
  converted: 'bg-purple-500/20 text-purple-400',
  lost: 'bg-destructive/20 text-destructive',
};

const emptyDeal: Omit<PipelineDeal, "id" | "days_in_pipeline"> = {
  client: "", developer: "", project: "", unit: "", status: "Ativo", stage: "lead",
  broker1: "", broker2: "", manager1: "", manager2: "", deal_value: 0,
  active: true, created_at: new Date().toISOString().slice(0, 10), notes: "",
  history: [],
};

// ── Allowed IPs for check-in (loaded from localStorage, configurable in Dados) ──
const getStoredIPs = (): string[] => {
  try {
    const stored = localStorage.getItem("allowed_ips");
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
};

interface QueueBroker {
  id: string;
  name: string;
  checkedInAt: string;
}

function CcaStatusBadge({ dealId }: { dealId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [stages, setStages] = useState<any[]>([]);

  useEffect(() => {
    async function getStatus() {
      const { data: ccaData } = await supabase
        .from('cca_deals' as any)
        .select('status')
        .eq('deal_id', dealId)
        .maybeSingle();
      
      if (ccaData) setStatus((ccaData as any).status);

      const { data: stagesData } = await supabase
        .from('cca_stages' as any)
        .select('*');
      
      if (stagesData) setStages(stagesData);
    }
    getStatus();
  }, [dealId]);

  if (!status) return null;

  const stage = stages.find(s => s.name === status);
  const colorClass = stage?.color || "text-primary";

  return (
    <div className="flex items-center gap-1 mt-0.5 border-t border-border/10 pt-0.5">
      <div className={cn("h-1.5 w-1.5 rounded-full", colorClass.replace('text-', 'bg-'))} />
      <span className={cn("text-[8px] font-bold uppercase", colorClass)}>{status}</span>
    </div>
  );
}

export default function Pipeline() {
  const { role } = useAuth();
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<"deals" | "leads">("deals");

  // ── Brokers state ──
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loadingBrokers, setLoadingBrokers] = useState(true);

  const fetchBrokers = useCallback(async () => {
    setLoadingBrokers(true);
    try {
      const { data, error } = await supabase.from('brokers').select('*').order('name');
      if (error) throw error;
      
      const mappedBrokers: Broker[] = (data || []).map(b => ({
        id: b.id,
        name: b.name,
        active: true,
        monthly_sales: 0,
        monthly_vgv: 0,
        team: 'Default'
      }));
      
      setBrokers(mappedBrokers);
    } catch (error) {
      console.error('Error fetching brokers:', error);
    } finally {
      setLoadingBrokers(false);
    }
  }, []);

  // ── Deals state ──
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(true);

  const fetchDeals = useCallback(async () => {
    setLoadingDeals(true);
    try {
      const { data, error } = await supabase
        .from('deals')
        .select(`
          *,
          broker1:brokers!deals_broker1_id_fkey(name),
          broker2:brokers!deals_broker2_id_fkey(name),
          manager1:brokers!deals_manager1_id_fkey(name),
          manager2:brokers!deals_manager2_id_fkey(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mappedDeals: PipelineDeal[] = (data || []).map(d => ({
        ...d,
        broker1: (d.broker1 as any)?.name || '',
        broker2: (d.broker2 as any)?.name || undefined,
        manager1: (d.manager1 as any)?.name || '',
        manager2: (d.manager2 as any)?.name || undefined,
        visit_result: d.visit_result as "pending" | "completed" | "cancelled" | undefined,
        days_in_pipeline: differenceInDays(new Date(), parseISO(d.created_at || new Date().toISOString())),
        history: d.history ? (d.history as any) : []
      })) as PipelineDeal[];

      setDeals(mappedDeals);
    } catch (error) {
      console.error('Error fetching deals:', error);
      toast({ title: "Erro ao carregar negócios", variant: "destructive" });
    } finally {
      setLoadingDeals(false);
    }
  }, []);

  useEffect(() => {
    fetchBrokers();
    fetchDeals();
  }, [fetchBrokers, fetchDeals]);

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [developerFilter, setDeveloperFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [status2Filter, setStatus2Filter] = useState("all");
  const [managerFilter, setManagerFilter] = useState("all");
  const [clientNameFilter, setClientNameFilter] = useState("");
  const [clientName2Filter, setClientName2Filter] = useState("");
  const [cpfFilter, setCpfFilter] = useState("");
  const [cpf2Filter, setCpf2Filter] = useState("");
  const [monthFilter, setMonthFilter] = useState("all");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [viewMode, setViewMode] = useState<"kanban" | "table">("table");
  const [page, setPage] = useState(1);
  const perPage = 15;

  // ── Leads state ──
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [leadViewMode, setLeadViewMode] = useState<"list" | "grid">("list");

  // ── New Lead modal ──
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadData, setNewLeadData] = useState({ name: "", phone: "", whatsapp: "", email: "", source: "", broker_name: "", notes: "" });

  // ── Queue state ──
  const [queue, setQueue] = useState<QueueBroker[]>([]);
  const [checkingIn, setCheckingIn] = useState(false);
  const [userIp, setUserIp] = useState<string | null>(null);

  // ── Convert lead modal ──
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [convertDoc, setConvertDoc] = useState<File | null>(null);
  const convertFileRef = useRef<HTMLInputElement>(null);

  // ── Deal modals ──
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<PipelineDeal | null>(null);
  const [detailDeal, setDetailDeal] = useState<PipelineDeal | null>(null);
  const [visitDeal, setVisitDeal] = useState<PipelineDeal | null>(null);
  const [visitDate, setVisitDate] = useState<Date | undefined>();
  const [formData, setFormData] = useState(emptyDeal);

  // Drag state
  const [draggedDeal, setDraggedDeal] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<DealStage | null>(null);

  // ── Close Month state ──
  const [closeMonthOpen, setCloseMonthOpen] = useState(false);
  const isAdmin = role === 'admin';

  const handleCloseMonth = () => {
    const currentMonth = monthFilter;
    // Stages that stay locked in this month: vendas, offs, distratos (closed + !active)
    const lockedStages: DealStage[] = ['closed'];
    
    setDeals(prev => prev.map(deal => {
      const dealMonth = deal.month_base || format(parseISO(deal.created_at), "MM/yyyy");
      if (dealMonth !== currentMonth) return deal;
      
      // Vendas, offs, distratos stay in this month
      if (lockedStages.includes(deal.stage) || !deal.active) {
        return deal; // stays locked
      }
      
      // All other proposals move to next month with day 05 as base date
      const [mm, yyyy] = currentMonth.split("/").map(Number);
      const nextMonth = mm === 12 ? 1 : mm + 1;
      const nextYear = mm === 12 ? yyyy + 1 : yyyy;
      const newMonthBase = `${String(nextMonth).padStart(2, "0")}/${nextYear}`;
      
      return { ...deal, month_base: newMonthBase };
    }));
    
    // Move filter to next month
    const [mm, yyyy] = currentMonth.split("/").map(Number);
    const nextMonth = mm === 12 ? 1 : mm + 1;
    const nextYear = mm === 12 ? yyyy + 1 : yyyy;
    setMonthFilter(`${String(nextMonth).padStart(2, "0")}/${nextYear}`);
    
    setCloseMonthOpen(false);
    toast({ title: "✅ Mês fechado com sucesso!", description: `Vendas, offs e distratos ficaram em ${currentMonth}. Propostas movidas para o próximo mês (data base dia 05).` });
  };

  // ── IP Check-in / Checkout ──
  const brokerName = "Dianho Silva"; // TODO: use real auth user
  const isInQueue = queue.some(q => q.name === brokerName);

  const handleCheckIn = useCallback(async () => {
    setCheckingIn(true);
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const data = await res.json();
      const ip = data.ip;
      setUserIp(ip);

      const allowedIPs = getStoredIPs();
      const hasConfiguredIPs = allowedIPs.some(aip => aip.trim() !== "");
      const isAllowed = !hasConfiguredIPs || allowedIPs.some(allowed => allowed.trim() && ip.startsWith(allowed.trim()));

      if (!isAllowed) {
        toast({ title: "❌ Check-in bloqueado", description: `Seu IP (${ip}) não está autorizado. Conecte-se à rede da empresa.`, variant: "destructive" });
        return;
      }

      if (queue.some(q => q.name === brokerName)) {
        toast({ title: "Já está na fila", description: "Você já fez check-in hoje." });
        return;
      }

      setQueue(prev => [...prev, { id: String(Date.now()), name: brokerName, checkedInAt: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) }]);
      toast({ title: "✅ Check-in realizado!", description: `IP ${ip} verificado. Você está na fila de atendimento.` });
    } catch {
      toast({ title: "Erro ao verificar IP", description: "Não foi possível validar seu IP. Tente novamente.", variant: "destructive" });
    } finally {
      setCheckingIn(false);
    }
  }, [queue]);

  const handleCheckOut = useCallback(() => {
    setQueue(prev => prev.filter(q => q.name !== brokerName));
    toast({ title: "👋 Check-out realizado!", description: "Você saiu da fila de atendimento." });
  }, []);

  // ── Convert Lead to Deal ──
  const openConvertLead = (lead: Lead) => {
    setConvertingLead(lead);
    setConvertDoc(null);
    setConvertOpen(true);
  };

  const confirmConvert = () => {
    if (!convertingLead) return;
    if (!convertDoc) {
      toast({ title: "📎 Documento obrigatório", description: "Anexe pelo menos 1 documento para converter o lead em negócio.", variant: "destructive" });
      return;
    }

    // Create deal at "incomplete" stage
    const newDeal: PipelineDeal = {
      id: String(Date.now()),
      client: convertingLead.name,
      developer: "",
      project: "",
      unit: "",
      status: "Ativo",
      stage: "incomplete",
      broker1: convertingLead.broker_name || "",
      manager1: "",
      deal_value: 0,
      days_in_pipeline: 0,
      active: true,
      created_at: new Date().toISOString().slice(0, 10),
      notes: `Convertido do lead. Doc: ${convertDoc.name}`,
    };

    setDeals(prev => [newDeal, ...prev]);
    setLeads(prev => prev.map(l => l.id === convertingLead.id ? { ...l, status: "converted" as LeadStatus } : l));
    setConvertOpen(false);
    setConvertingLead(null);
    setConvertDoc(null);
    setActiveTab("deals");
    toast({ title: "🎉 Lead convertido em negócio!", description: `"${convertingLead.name}" inserido no pipeline como Incompleto.` });
  };

  // ── Deal filters ──
  const filtered = useMemo(() => {
    return deals.filter((d) => {
      const s = search.toLowerCase();
      const matchSearch = !s || d.client.toLowerCase().includes(s) || (d.project?.toLowerCase() || "").includes(s) || (d.broker1?.toLowerCase() || "").includes(s);
      const matchDev = developerFilter === "all" || d.developer === developerFilter;
      const matchBroker = brokerFilter === "all" || d.broker1 === brokerFilter;
      const matchStage = stageFilter === "all" || d.stage === stageFilter;
      const matchStatus2 = status2Filter === "all" || d.stage === status2Filter;
      const matchManager = managerFilter === "all" || d.manager1 === managerFilter;
      const matchClient = !clientNameFilter || d.client.toLowerCase().includes(clientNameFilter.toLowerCase());
      const dealMonth = d.month_base || (d.created_at ? format(parseISO(d.created_at), "MM/yyyy") : "");
      const matchMonth = monthFilter === "all" || dealMonth === monthFilter;
      return matchSearch && matchDev && matchBroker && matchStage && matchStatus2 && matchManager && matchClient && matchMonth;
    }).sort((a, b) => {
      // Sort by status (Status 2) first, then by developer
      const statusOrder = FACEIMOB_STATUSES.map(s => s.label);
      const aStatus = (a.status && a.status !== "Ativo" && a.status !== "OFF") ? a.status : (tableStageLabels[a.stage]?.label || "PROPOSTA");
      const bStatus = (b.status && b.status !== "Ativo" && b.status !== "OFF") ? b.status : (tableStageLabels[b.stage]?.label || "PROPOSTA");
      const aIdx = statusOrder.indexOf(aStatus); const bIdx = statusOrder.indexOf(bStatus);
      const sCmp = (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      if (sCmp !== 0) return sCmp;
      return (a.developer || "").localeCompare(b.developer || "");
    });
  }, [deals, search, developerFilter, brokerFilter, stageFilter, status2Filter, managerFilter, clientNameFilter]);

  const dealsByStage = useMemo(() => {
    const map: Record<DealStage, PipelineDeal[]> = { incomplete: [], lead: [], proposal: [], visit_scheduled: [], under_analysis: [], approved: [], contract: [], closed: [] };
    filtered.filter((d) => d.active).forEach((d) => map[d.stage]?.push(d));
    return map;
  }, [filtered]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Lead filters ──
  const filteredLeads = useMemo(() => {
    return leads.filter(l => {
      const s = leadSearch.toLowerCase();
      const matchSearch = !s || l.name.toLowerCase().includes(s) || l.email.toLowerCase().includes(s) || l.phone.includes(s);
      const matchStatus = leadStatusFilter === "all" || l.status === leadStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [leads, leadSearch, leadStatusFilter]);

  // ── Deal metrics ──
  const activeDeals = deals.filter((d) => d.active).length;
  const totalVGV = deals.filter((d) => d.active).reduce((a, d) => a + (d.deal_value || 0), 0);

  // ── Lead metrics ──
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === "new").length;
  const inContactLeads = leads.filter(l => l.status === "contacted").length;
  const qualifiedLeads = leads.filter(l => l.status === "qualified").length;

  // Drag handlers
  const onDragStart = useCallback((dealId: string) => setDraggedDeal(dealId), []);
  const onDragEnd = useCallback(() => { setDraggedDeal(null); setDragOverStage(null); }, []);
  const onDragOver = useCallback((e: React.DragEvent, stage: DealStage) => { e.preventDefault(); setDragOverStage(stage); }, []);
  const onDrop = useCallback(async (stage: DealStage) => {
    if (draggedDeal) {
      const deal = deals.find(d => d.id === draggedDeal);
      if (!deal) return;

      const oldStage = deal.stage;
      
      // Update local state
      setDeals((prev) => prev.map((d) => d.id === draggedDeal ? { ...d, stage } : d));
      
      // Update Supabase
      try {
        const { error } = await supabase
          .from('deals')
          .update({ stage })
          .eq('id', draggedDeal);
        
        if (error) throw error;

        // Auto-duplicate to CCA if moved to under_analysis and is a CCA developer
        if (stage === 'under_analysis' && oldStage !== 'under_analysis' && ccaDevelopers.includes(deal.developer || '')) {
          const { error: ccaError } = await supabase
            .from('cca_deals' as any)
            .insert({
              deal_id: draggedDeal,
              status: 'credit_analysis',
              notes: 'Movido automaticamente do pipeline principal'
            } as any);
          
          if (!ccaError) {
            toast({ title: "Enviado para o Pipeline CCA" });
          }
        }

        toast({ title: `Deal movido para ${DEAL_STAGES.find((s) => s.value === stage)?.label}` });
      } catch (err) {
        console.error("Error updating deal stage:", err);
        toast({ variant: "destructive", title: "Erro ao salvar", description: "O status não foi atualizado no servidor." });
      }
    }
    setDraggedDeal(null);
    setDragOverStage(null);
  }, [draggedDeal, deals]);

  const openNewDeal = () => { setEditingDeal(null); setFormData(emptyDeal); setDealFormOpen(true); };
  const openEditDeal = (deal: PipelineDeal) => { setEditingDeal(deal); setFormData(deal); setDealFormOpen(true); };

  const saveNewLead = () => {
    if (!newLeadData.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    const newLead: Lead = {
      id: String(Date.now()),
      name: newLeadData.name,
      phone: newLeadData.phone,
      whatsapp: newLeadData.whatsapp || newLeadData.phone,
      email: newLeadData.email,
      source: newLeadData.source,
      broker_id: "",
      broker_name: newLeadData.broker_name,
      status: "new" as LeadStatus,
      notes: newLeadData.notes,
      created_at: new Date().toISOString(),
    };
    setLeads(prev => [newLead, ...prev]);
    setNewLeadOpen(false);
    setNewLeadData({ name: "", phone: "", whatsapp: "", email: "", source: "", broker_name: "", notes: "" });
    toast({ title: "✅ Lead criado com sucesso!" });
  };

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

  const updateDealStatus = async (dealId: string, newStatus: string) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, status: newStatus } : d));
    try {
      const { error } = await supabase.from('deals').update({ status: newStatus }).eq('id', dealId);
      if (error) throw error;
    } catch (err) {
      console.error("Error updating status:", err);
      toast({ variant: "destructive", title: "Erro ao salvar status" });
    }
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

  // Analytics data
  const underAnalysis = deals.filter((d) => ["under_analysis", "visit_scheduled"].includes(d.stage) && d.active).length;
  const approvedDeals = deals.filter((d) => d.stage === "approved" && d.active).length;
  const approvedCond = deals.filter((d) => d.stage === "contract" && d.active).length;
  const pendingDeals = deals.filter((d) => d.stage === "lead" && d.active).length;
  const closedDeals = deals.filter((d) => d.stage === "closed").length;
  const agileDeals = deals.filter((d) => d.stage === "visit_scheduled" && d.active).length;
  const proposalsToday = deals.filter((d) => d.stage === "proposal" && d.created_at === format(new Date(), "yyyy-MM-dd")).length;
  const proposalsPeriod = deals.filter((d) => d.stage === "proposal" && d.active).length;
  const avgDealValue = activeDeals ? totalVGV / activeDeals : 0;
  const avgDaysInPipeline = activeDeals ? deals.filter((d) => d.active).reduce((a, d) => a + d.days_in_pipeline, 0) / activeDeals : 0;
  const brokerDeals = brokers.map((b) => ({
    name: b.name,
    count: deals.filter((d) => d.broker1 === b.name && d.active).length,
  })).sort((a, b) => b.count - a.count);
  const leaderboard = brokers.slice(0, 3).map((b, i) => ({
    id: b.id,
    user_name: b.name,
    points: 1000 - (i * 100), // Placeholder logic
  }));
  const medals = ["🥇", "🥈", "🥉"];
  const medalBgs = [
    "border-amber-500/40 bg-gradient-to-r from-amber-900/20 to-transparent",
    "border-gray-400/40 bg-gradient-to-r from-gray-700/20 to-transparent",
    "border-orange-600/40 bg-gradient-to-r from-orange-900/20 to-transparent",
  ];

  return (
    <div className="space-y-4">
      {/* ── HEADER with TABS ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-primary">Pipeline</h1>
          <div className="flex border border-border rounded-full overflow-hidden">
            <button
              onClick={() => setActiveTab("deals")}
              className={cn("px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === "deals" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Negócios
            </button>
            <button
              onClick={() => setActiveTab("leads")}
              className={cn("px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === "leads" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Leads
            </button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {activeTab === "deals" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
                <Filter className="h-4 w-4 mr-1" /> Filtrar Negócio
              </Button>
              <Button size="sm" onClick={openNewDeal}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar Negócio
              </Button>
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="h-4 w-4 mr-1" /> Extrair Negócio
              </Button>
              {isAdmin && (
                <Button variant="destructive" size="sm" onClick={() => setCloseMonthOpen(true)}>
                  <Target className="h-4 w-4 mr-1" /> Fechar Mês
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" onClick={() => setNewLeadOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Novo Lead
            </Button>
          )}
        </div>
      </div>

      {/* ── ATTENDANCE QUEUE (Fila de Atendimento) ────────── */}
      <Card className="glass border-border/50">
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-sm">Fila de Atendimento</p>
              <p className="text-xs text-muted-foreground">{queue.length} corretor(es) na fila</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {queue.length > 0 && (
              <div className="flex -space-x-2">
                {queue.slice(0, 5).map((q) => (
                  <div key={q.id} className="w-7 h-7 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-[10px] font-bold text-primary" title={`${q.name} - ${q.checkedInAt}`}>
                    {q.name.charAt(0)}
                  </div>
                ))}
                {queue.length > 5 && <div className="w-7 h-7 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] text-muted-foreground">+{queue.length - 5}</div>}
              </div>
            )}
            {isInQueue ? (
              <Button
                size="sm"
                onClick={handleCheckOut}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <LogIn className="h-4 w-4 mr-1" />
                Check-out
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleCheckIn}
                disabled={checkingIn}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <LogIn className="h-4 w-4 mr-1" />
                {checkingIn ? "Verificando..." : "Check-in"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {activeTab === "deals" ? (
        <>
          {/* ── FILTER PANEL + METRICS ────────────────────── */}
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Filter Panel */}
            {showFilters && (
              <Card className="glass border-primary/30 flex-shrink-0 lg:w-[520px]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold">Filtrar Negócio</span>
                    <button onClick={() => setShowFilters(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={stageFilter} onValueChange={setStageFilter}>
                      <SelectTrigger><SelectValue placeholder="PROPOSTA" /></SelectTrigger>
                      <SelectContent>{[{ value: "all", label: "Todos Status" }, ...DEAL_STAGES].map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={status2Filter} onValueChange={setStatus2Filter}>
                      <SelectTrigger><SelectValue placeholder="Escolher Status 2" /></SelectTrigger>
                      <SelectContent>{[{ value: "all", label: "Todos Status 2" }, ...DEAL_STAGES].map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} placeholder="03/2026" />
                    <Select value={developerFilter} onValueChange={setDeveloperFilter}>
                      <SelectTrigger><SelectValue placeholder="Escolher uma Construtora" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Todas Construtoras</SelectItem>{mockDevelopers.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={managerFilter} onValueChange={setManagerFilter}>
                      <SelectTrigger><SelectValue placeholder="Escolher Gerente 1" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Todos Gerentes</SelectItem>{brokers.filter(m => m.active).map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={brokerFilter} onValueChange={setBrokerFilter}>
                      <SelectTrigger><SelectValue placeholder="Escolher Corretor 1" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Todos Corretores</SelectItem>{brokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input placeholder="Filtrar por nome cliente" value={clientNameFilter} onChange={(e) => setClientNameFilter(e.target.value)} />
                    <Input placeholder="Filtrar por nome 2º cliente" value={clientName2Filter} onChange={(e) => setClientName2Filter(e.target.value)} />
                    <Input placeholder="Filtrar por CPF Cliente" value={cpfFilter} onChange={(e) => setCpfFilter(e.target.value)} />
                    <Input placeholder="Filtrar por CPF 2º Cliente" value={cpf2Filter} onChange={(e) => setCpf2Filter(e.target.value)} />
                  </div>
                  <div className="flex justify-end mt-3">
                    <Button variant="ghost" size="sm" onClick={() => { setStageFilter("all"); setStatus2Filter("all"); setDeveloperFilter("all"); setBrokerFilter("all"); setManagerFilter("all"); setClientNameFilter(""); setClientName2Filter(""); setCpfFilter(""); setCpf2Filter(""); setSearch(""); }}>
                      <X className="h-3 w-3 mr-1" /> Limpar Filtros
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Right side: Actions + Metrics summary */}
            <div className="flex-1 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={openNewDeal}><Plus className="h-4 w-4 mr-1" /> Adicionar Negócio</Button>
                  <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4 mr-1" /> Extrair Negócio</Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex border border-border rounded-lg overflow-hidden">
                    <button onClick={() => setViewMode("table")} className={cn("p-1.5 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                      <List className="h-4 w-4" />
                    </button>
                    <button onClick={() => setViewMode("kanban")} className={cn("p-1.5 transition-colors", viewMode === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Inline Metrics */}
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-1 rounded border border-primary/50 text-primary font-bold">Negócios Ativos: {activeDeals}</span>
                <span className="px-2 py-1 rounded border border-border text-muted-foreground">Aprovado Total: {approvedDeals}</span>
                <span className="px-2 py-1 rounded border border-border text-muted-foreground">Aprovado Cond.: {approvedCond}</span>
                <span className="px-2 py-1 rounded border border-border text-muted-foreground">Em análise: {underAnalysis}</span>
                <span className="px-2 py-1 rounded border border-border text-muted-foreground">Esteira Ágil: {agileDeals}</span>
                <span className="px-2 py-1 rounded border border-warning/50 text-warning font-bold">Pendentes: {pendingDeals}</span>
                <span className="px-2 py-1 rounded border border-border text-muted-foreground">Propostas Hoje: {proposalsToday}</span>
                <span className="px-2 py-1 rounded border border-border text-muted-foreground">Propostas período: {proposalsPeriod}</span>
              </div>
            </div>
          </div>

          {/* Quick search bar */}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar cliente, projeto, corretor..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {/* ── LEADERBOARD ──────────────────────────────── */}
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

          {/* ── PIPELINE CONTENT ─────────────────────────── */}
          <div className="flex gap-4">
            <div className="flex-1 overflow-hidden">
              {viewMode === "kanban" ? (
                <div className="overflow-x-auto">
                  <div className="flex gap-3 min-w-max pb-4">
                    {DEAL_STAGES.map((stage) => {
                      const sc = stageColors[stage.value];
                      const stageDeals = dealsByStage[stage.value] || [];
                      const isOver = dragOverStage === stage.value;
                      return (
                        <div
                          key={stage.value}
                          className={cn("w-60 flex-shrink-0 rounded-xl border transition-all", sc.border, isOver && "ring-2 ring-primary/50 scale-[1.01]")}
                          onDragOver={(e) => onDragOver(e, stage.value)}
                          onDragLeave={() => setDragOverStage(null)}
                          onDrop={() => onDrop(stage.value)}
                        >
                          <div className={cn("p-3 rounded-t-xl flex items-center justify-between", sc.header)}>
                            <div className="flex items-center gap-2">
                              <span className={cn("w-2.5 h-2.5 rounded-full", sc.dot)} />
                              <span className="text-xs font-semibold">{stage.label}</span>
                            </div>
                            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">{stageDeals.length}</Badge>
                          </div>
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
                <>
                  <Card className="border-2 border-primary/40 bg-card/60 overflow-hidden rounded-lg">
                    {/* Header bar */}
                    <div className="bg-primary/10 border-b-2 border-primary/40 text-center py-2">
                      <h2 className="text-sm font-bold text-foreground tracking-wide">Pipeline Faceimob</h2>
                    </div>
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
                            const statusDate = deal.created_at ? format(parseISO(deal.created_at), "MM/yy") : "";
                            const status2Label = (deal.status && deal.status !== "Ativo" && deal.status !== "OFF")
                              ? deal.status
                              : (tableStageLabels[deal.stage]?.label || "PROPOSTA");
                            const status2Color = faceimobStatusColor(status2Label);
                            const stripeColor =
                              deal.days_in_pipeline > 60 ? "bg-red-600" :
                              deal.days_in_pipeline > 30 ? "bg-orange-500" :
                              deal.days_in_pipeline > 14 ? "bg-yellow-500" : "bg-emerald-500";
                            return (
                              <tr key={deal.id} className="border-b border-border/10 hover:bg-secondary/20 transition-colors cursor-pointer" onClick={() => setDetailDeal(deal)}>
                                <td className="p-0 text-center relative w-10">
                                  <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", stripeColor)} />
                                  <button onClick={(e) => { e.stopPropagation(); openEditDeal(deal); }} className="text-primary hover:text-primary/80 ml-1.5 p-2">
                                    <ArrowRightCircle className="h-4 w-4" />
                                  </button>
                                </td>
                                <td className="p-2"><span className="text-[10px] font-semibold whitespace-nowrap">PROPOSTA {statusDate}</span></td>
                                <td className="p-2"><span className={cn("px-2 py-0.5 rounded text-[10px] font-bold text-white", getDeveloperColor(deal.developer))}>{deal.developer.toUpperCase().slice(0, 10)}</span></td>
                                <td className="p-2 whitespace-nowrap max-w-[120px] truncate">{deal.project.toUpperCase()}</td>
                                <td className="p-2 text-center">{deal.unit}</td>
                                <td className="p-2 text-center">
                                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold",
                                    deal.days_in_pipeline > 60 ? "bg-red-600 text-white" :
                                    deal.days_in_pipeline > 30 ? "bg-red-500/70 text-white" :
                                    deal.days_in_pipeline > 14 ? "bg-yellow-600/70 text-white" : "text-foreground"
                                  )}>{deal.days_in_pipeline}</span>
                                </td>
                                <td className="p-2" onClick={(e) => e.stopPropagation()}>
                                  <Select value={status2Label} onValueChange={(v) => updateDealStatus(deal.id, v)}>
                                    <SelectTrigger className={cn("h-6 px-2 py-0 text-[10px] font-bold border-0 rounded gap-1 whitespace-nowrap min-w-[140px]", status2Color)}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-80">
                                      {FACEIMOB_STATUSES.map(s => (
                                        <SelectItem key={s.label} value={s.label} className="text-[11px]">
                                          <span className={cn("inline-block px-2 py-0.5 rounded text-[10px] font-bold", s.color)}>{s.label}</span>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}><button onClick={() => setVisitDeal(deal)} className={cn("hover:text-primary", deal.visit_date ? "text-destructive" : "text-muted-foreground")}><CalendarIcon className="h-3.5 w-3.5" /></button></td>
                                <td className="p-2 whitespace-nowrap max-w-[130px] truncate font-medium">{deal.client.toUpperCase()}</td>
                                <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.broker1?.toUpperCase() || "—"}</td>
                                <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.broker2?.toUpperCase() || "—"}</td>
                                <td className="p-2 whitespace-nowrap max-w-[100px] truncate">• {deal.manager1?.toUpperCase() || "—"}</td>
                                <td className="p-2 whitespace-nowrap max-w-[100px] truncate">{deal.manager2?.toUpperCase() || ""}</td>
                                <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}><Switch checked={deal.active} onCheckedChange={() => toggleDealActive(deal.id)} className="scale-75" /></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                  <div className="flex items-center justify-center gap-3 mt-3 text-xs text-muted-foreground">
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="hover:text-foreground disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                    <span>{(page - 1) * perPage + 1} a {Math.min(page * perPage, filtered.length)}</span>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="hover:text-foreground disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </>
              )}
            </div>

            {/* Analytics Panel */}
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
                    <div><p className="text-[10px] text-muted-foreground">Ticket Médio</p><p className="text-sm font-bold">R$ {(avgDealValue / 1000).toFixed(0)}k</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Tempo Médio</p><p className="text-sm font-bold">{avgDaysInPipeline.toFixed(0)} dias</p></div>
                    <div><p className="text-[10px] text-muted-foreground">Taxa de Fechamento</p><p className="text-sm font-bold">{activeDeals > 0 ? ((closedDeals / (activeDeals + closedDeals)) * 100).toFixed(1) : 0}%</p></div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>

          {/* Analytics toggle */}
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowAnalytics(!showAnalytics)}>
              <BarChart3 className="h-4 w-4 mr-1" /> Analytics
            </Button>
          </div>
        </>
      ) : (
        /* ═══ LEADS TAB ═══ */
        <>
          {/* Lead Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total", value: totalLeads, icon: Users, color: "text-muted-foreground" },
              { label: "Novos", value: newLeads, icon: AlertCircle, color: "text-warning" },
              { label: "Em Atendimento", value: inContactLeads, icon: Clock, color: "text-muted-foreground" },
              { label: "Qualificados", value: qualifiedLeads, icon: CheckCircle, color: "text-muted-foreground" },
            ].map(m => (
              <Card key={m.label} className="glass border-border/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <m.icon className={cn("h-5 w-5", m.color)} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{m.value}</p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Lead Search */}
          <Card className="glass border-border/50">
            <CardContent className="p-3 flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar leads..." className="pl-10" value={leadSearch} onChange={(e) => setLeadSearch(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={leadStatusFilter} onValueChange={setLeadStatusFilter}>
                  <SelectTrigger className="w-28"><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {LEAD_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex border border-border rounded-lg overflow-hidden">
                  <button onClick={() => setLeadViewMode("list")} className={cn("p-1.5 transition-colors", leadViewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                    <List className="h-4 w-4" />
                  </button>
                  <button onClick={() => setLeadViewMode("grid")} className={cn("p-1.5 transition-colors", leadViewMode === "grid" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Lead List */}
          <div className="space-y-2">
            {filteredLeads.map((lead) => (
              <Card key={lead.id} className="glass hover:bg-secondary/30 transition-colors group">
                <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-1 h-10 rounded-full bg-primary" />
                    <div>
                      <p className="font-semibold text-sm">{lead.name}</p>
                      <p className="text-xs text-muted-foreground">{lead.source} • {lead.broker_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={cn("text-[10px]", leadStatusColor[lead.status])}>
                      {LEAD_STATUSES.find(s => s.value === lead.status)?.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{lead.created_at?.slice(11, 16) || lead.created_at}</span>
                    <span className="text-xs text-muted-foreground">{lead.broker_name}</span>
                    {lead.status !== "converted" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openConvertLead(lead)}
                        className="text-success hover:text-success opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Converter em negócio"
                      >
                        <ArrowRightCircle className="h-4 w-4 mr-1" /> Converter
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredLeads.length === 0 && <div className="text-center p-8 text-muted-foreground">Nenhum lead encontrado.</div>}
          </div>
        </>
      )}

      {/* ── CONVERT LEAD MODAL ─────────────────────────────── */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightCircle className="h-5 w-5 text-success" />
              Converter Lead em Negócio
            </DialogTitle>
          </DialogHeader>
          {convertingLead && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-secondary/50">
                <p className="text-sm font-medium">{convertingLead.name}</p>
                <p className="text-xs text-muted-foreground">{convertingLead.email} • {convertingLead.phone}</p>
                <p className="text-xs text-muted-foreground">Origem: {convertingLead.source} • Corretor: {convertingLead.broker_name}</p>
              </div>

              <div className="p-3 rounded-lg border border-warning/30 bg-warning/5">
                <p className="text-xs text-warning font-medium flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  O negócio será inserido no status "Incompleto"
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">É necessário anexar pelo menos 1 documento para converter.</p>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Documento obrigatório *</label>
                <input
                  ref={convertFileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setConvertDoc(e.target.files?.[0] || null)}
                />
                <div
                  onClick={() => convertFileRef.current?.click()}
                  className={cn(
                    "border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors",
                    convertDoc ? "border-success/50 bg-success/5" : "border-border hover:border-primary/50"
                  )}
                >
                  {convertDoc ? (
                    <div className="flex items-center justify-center gap-2">
                      <Paperclip className="h-4 w-4 text-success" />
                      <span className="text-sm text-success font-medium">{convertDoc.name}</span>
                      <button onClick={(e) => { e.stopPropagation(); setConvertDoc(null); }} className="text-muted-foreground hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <Paperclip className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
                      <p className="text-xs text-muted-foreground">Clique para anexar documento</p>
                      <p className="text-[10px] text-muted-foreground">PDF, imagem, ou qualquer arquivo</p>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={confirmConvert} disabled={!convertDoc} className="bg-success hover:bg-success/90 text-success-foreground">
                  <ArrowRightCircle className="h-4 w-4 mr-1" /> Converter em Negócio
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── DEAL DETAIL MODAL ──────────────────────────────── */}
      {detailDeal && (
        <DealDetailModal
          deal={detailDeal}
          open={!!detailDeal}
          onClose={() => setDetailDeal(null)}
          onSave={(updated) => {
            setDeals(prev => prev.map(d => d.id === updated.id ? updated : d));
            setDetailDeal(null);
          }}
        />
      )}

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
              <Select value={formData.broker1} onValueChange={(v) => setFormData((p) => ({ ...p, broker1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{brokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 2</label>
              <Select value={formData.broker2 || "none"} onValueChange={(v) => setFormData((p) => ({ ...p, broker2: v === "none" ? undefined : v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{brokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 1</label>
              <Select value={formData.manager1} onValueChange={(v) => setFormData((p) => ({ ...p, manager1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{brokers.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 2</label>
              <Select value={formData.manager2 || "none"} onValueChange={(v) => setFormData((p) => ({ ...p, manager2: v === "none" ? undefined : v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{brokers.filter((m) => m.active).map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
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

      {/* ── NEW LEAD MODAL ─────────────────────────────────── */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Novo Lead</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label><Input value={newLeadData.name} onChange={(e) => setNewLeadData(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Email</label><Input type="email" value={newLeadData.email} onChange={(e) => setNewLeadData(p => ({ ...p, email: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Telefone</label><Input value={newLeadData.phone} onChange={(e) => setNewLeadData(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">WhatsApp</label><Input value={newLeadData.whatsapp} onChange={(e) => setNewLeadData(p => ({ ...p, whatsapp: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Fonte</label>
              <Select value={newLeadData.source} onValueChange={(v) => setNewLeadData(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione a fonte" /></SelectTrigger>
                <SelectContent>{mockSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor</label>
              <Select value={newLeadData.broker_name} onValueChange={(v) => setNewLeadData(p => ({ ...p, broker_name: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{brokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2"><label className="text-sm text-muted-foreground mb-1 block">Observações</label><Textarea value={newLeadData.notes} onChange={(e) => setNewLeadData(p => ({ ...p, notes: e.target.value }))} rows={2} /></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveNewLead} disabled={!newLeadData.name.trim()}>Criar Lead</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CLOSE MONTH CONFIRMATION DIALOG ─── */}
      <Dialog open={closeMonthOpen} onOpenChange={setCloseMonthOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-destructive" />
              Fechar Mês do Pipeline
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ao fechar o mês, as <strong className="text-foreground">vendas, offs e distratos</strong> de{' '}
              <strong className="text-foreground">{monthFilter}</strong>{' '}
              ficarão congelados neste mês.
            </p>
            <p className="text-sm text-muted-foreground">
              Todas as outras propostas (Status 1 — Proposta) serão movidas para o{' '}
              <strong className="text-foreground">mês seguinte</strong> com data base no dia <strong className="text-foreground">05</strong>.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Esta ação não pode ser desfeita. Verifique se todos os negócios estão com o status correto antes de fechar.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleCloseMonth}>
              Confirmar Fechamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
