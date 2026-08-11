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
import { DEAL_STAGES, type PipelineDeal, type DealStage, type Broker, type DocumentReviewStatus } from "@/types/crm";
import { calcDealProbability } from "@/lib/aiAnalytics";
import {
  Plus, Download, Search, Filter, Calendar as CalendarIcon,
  BarChart3, X, GripVertical, User,
  CalendarCheck, StickyNote, AlertCircle, ChevronRight,
  ChevronLeft, LayoutGrid, List, LogIn, Users,
  ArrowRightCircle, Paperclip, UserPlus,
  AlertTriangle, Target, FileCheck2
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { normalizeStatus, nextMonthBase } from "@/lib/dealStatus";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import LeadFunnel from "@/components/LeadFunnel";
import PipelineTopRanking from "@/components/PipelineTopRanking";
import { scheduleVisit as scheduleVisitRecord } from "@/integrations/supabase/activities";
import {
  convertLeadToDeal,
  listDevelopers,
  listDeveloperProjects,
  listLeadSources,
  uploadLeadAttachment,
  type LeadRecord,
} from "@/integrations/supabase/leads";
import {
  displayMonthToIso,
  getStageIdByCode,
  listLegacyDeals,
  listOpenCheckins,
  listPeople,
  saveLegacyDeal,
  toDisplayMonth,
  type PersonRecord,
} from "@/integrations/supabase/newSchema";
import { submitDealForManagerReview } from "@/integrations/supabase/documents";
import { functionErrorMessage } from "@/lib/functionError";

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
  { label: "02. ASS. BANCO", color: "bg-blue-600 text-white" },
  { label: "03. ASSINADO", color: "bg-emerald-600 text-white" },
  { label: "04. EM CONTRATO", color: "bg-red-500 text-white" },
  { label: "05. RP APROVADO", color: "bg-emerald-700 text-white" },
  { label: "06. ENVIO DE RP", color: "bg-cyan-600 text-white" },
  { label: "08. VIROU NEGÓCIO", color: "bg-slate-700 text-white" },
  { label: "14. PENDENTE P/ VIRAR NEGÓCIO", color: "bg-yellow-600 text-white" },
  { label: "15. ANÁLISE P/ VIRAR NEGÓCIO", color: "bg-amber-700 text-white" },
  { label: "ANÁLISE P/ POTENCIAL", color: "bg-cyan-700 text-white" },
  { label: "ANÁLISE EXTERNA", color: "bg-sky-700 text-white" },
  { label: "MUDAR CONSTRUTORA P/ NEGÓCIO", color: "bg-violet-700 text-white" },
  { label: "09. APROV. TOTAL", color: "bg-blue-700 text-white" },
  { label: "10. APROV. COND.", color: "bg-red-600 text-white" },
  { label: "07. APROV. AG. CONT.", color: "bg-amber-600 text-white" },
  { label: "APROV. TOT. RESTRIÇÃO", color: "bg-rose-600 text-white" },
  { label: "APROV. COND. RESTRIÇÃO", color: "bg-rose-500 text-white" },
  { label: "APROVADO POTENCIAL", color: "bg-emerald-500 text-white" },
  { label: "11. AG. RET. AGENCIA", color: "bg-orange-600 text-white" },
  { label: "12. EM PROCESSAMENTO", color: "bg-purple-600 text-white" },
  { label: "13. ESTEIRA AGIL", color: "bg-teal-600 text-white" },
  { label: "RET. ESTEIRA AGIL", color: "bg-teal-700 text-white" },
  { label: "15. INTERNALIZADO", color: "bg-indigo-600 text-white" },
  { label: "PENDENTE C/ RESTRIÇÃO", color: "bg-amber-800 text-white" },
  { label: "16. PENDENTE", color: "bg-yellow-700 text-white" },
  { label: "17. DISTRATO", color: "bg-rose-700 text-white" },
  { label: "18. QUEDA", color: "bg-red-700 text-white" },
  { label: "19. REPROVADO", color: "bg-red-800 text-white" },
  { label: "20. BACEN", color: "bg-fuchsia-700 text-white" },
  { label: "21. RESTRIÇÃO", color: "bg-pink-700 text-white" },
  { label: "INCOMPLETO", color: "bg-destructive text-destructive-foreground" },
  { label: "COMPRA ASSISTIDA", color: "bg-emerald-800 text-white" },
  { label: "PROPOSTA", color: "bg-primary text-primary-foreground" },
];
const faceimobStatusColor = (label: string) =>
  FACEIMOB_STATUSES.find(s => s.label === label)?.color || "bg-muted text-muted-foreground";

const documentReviewMeta: Record<DocumentReviewStatus, { label: string; className: string }> = {
  draft: { label: "Em preparação", className: "border-muted-foreground/40 text-muted-foreground" },
  pending: { label: "Aguardando gerente", className: "border-warning/50 text-warning" },
  returned: { label: "Devolvido", className: "border-destructive/50 text-destructive" },
  approved: { label: "Conferido", className: "border-success/50 text-success" },
};

const emptyDeal: Omit<PipelineDeal, "id" | "days_in_pipeline"> = {
  client: "", developer: "", project: "", unit: "", status: "Ativo", stage: "lead",
  broker1: "", broker2: "", manager1: "", manager2: "", deal_value: 0,
  active: true, created_at: new Date().toISOString().slice(0, 10), notes: "",
  history: [],
};

interface QueueBroker {
  id: string;
  broker_id: string;
  name: string;
  checkedInAt: string;
}

export default function Pipeline() {
  const { role, user, canEnterStage } = useAuth();
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<"deals" | "leads">("deals");

  // ── People & catalog state (dados reais; antes vinham de mockData) ──
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [developers, setDevelopers] = useState<{ id: string; name: string }[]>([]);
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]);
  const fetchCatalogs = useCallback(async () => {
    try {
      const [persons, devs, srcs] = await Promise.all([
        listPeople(),
        listDevelopers(),
        listLeadSources(),
      ]);
      setPeople(persons);
      setDevelopers(devs);
      setSources(srcs.map((s) => ({ id: s.id, label: s.label })));
    } catch (error) {
      console.error("Error fetching catalogs:", error);
      toast({ title: "Erro ao carregar catálogos", description: "Corretores e construtoras podem aparecer vazios.", variant: "destructive" });
    }
  }, []);

  const brokers: Broker[] = useMemo(
    () =>
      people
        .filter((person) => person.roles.includes("broker"))
        .map((person) => ({
          id: person.id,
          name: person.name,
          active: person.active,
          monthly_sales: 0,
          monthly_vgv: 0,
          team: person.team,
        })),
    [people],
  );
  const managers = useMemo(
    () =>
      people.filter(
        (person) =>
          person.active &&
          (person.roles.includes("manager") || person.roles.includes("director")),
      ),
    [people],
  );

  // ── Deals state ──
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const fetchDeals = useCallback(async () => {
    try {
      setDeals(await listLegacyDeals());
    } catch (error) {
      console.error('Error fetching deals:', error);
      toast({ title: "Erro ao carregar negócios", variant: "destructive" });
    } finally {
      setDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalogs();
    fetchDeals();
  }, [fetchCatalogs, fetchDeals]);

  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [developerFilter, setDeveloperFilter] = useState("all");
  const [brokerFilter, setBrokerFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [status2Filter, setStatus2Filter] = useState("all");
  const [documentReviewFilter, setDocumentReviewFilter] = useState("all");
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

  // ── New Lead modal ──
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadData, setNewLeadData] = useState({ name: "", phone: "", whatsapp: "", email: "", source: "", broker_name: "", notes: "" });

  // ── Queue state ──
  const [queue, setQueue] = useState<QueueBroker[]>([]);
  const [checkingIn, setCheckingIn] = useState(false);
  // ── Convert lead modal ──
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertingLead, setConvertingLead] = useState<LeadRecord | null>(null);
  const [convertDoc, setConvertDoc] = useState<File | null>(null);
  const [convertForm, setConvertForm] = useState({ developerId: "", projectId: "", unit: "", vgv: "" });
  const [convertProjects, setConvertProjects] = useState<{ id: string; name: string }[]>([]);
  const [converting, setConverting] = useState(false);
  const convertFileRef = useRef<HTMLInputElement>(null);

  // ── Deal modals ──
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [formProjects, setFormProjects] = useState<{ id: string; name: string }[]>([]);
  const loadFormProjects = useCallback(async (developerName: string) => {
    const dev = developers.find((d) => d.name === developerName);
    if (!dev) return setFormProjects([]);
    try {
      setFormProjects(await listDeveloperProjects(dev.id));
    } catch {
      setFormProjects([]);
    }
  }, [developers]);
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
  const queryClient = useQueryClient();

  const { data: closedMonths = [] } = useQuery({
    queryKey: ["closed_months"],
    queryFn: async () => {
      const { data, error } = await supabase.from("closed_months").select("period");
      if (error) throw error;
      return (data ?? [])
        .map((row) => toDisplayMonth(row.period))
        .filter(Boolean) as string[];
    },
    staleTime: 60_000,
  });
  const isMonthClosed = closedMonths.includes(monthFilter);

  const handleCloseMonth = async () => {
    const currentMonth = monthFilter;
    const nextBase = nextMonthBase(currentMonth);
    try {
      // Ata 14/07: fechar o mês zera jogo e sistema JUNTOS, numa transação só.
      // A RPC migra as propostas abertas, congela o mês e encerra a temporada.
      const { data, error } = await supabase.rpc("close_month_and_season", {
        p_period: displayMonthToIso(currentMonth),
      });
      if (error) throw error;

      await fetchDeals();
      await queryClient.invalidateQueries({ queryKey: ["closed_months"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "new-schema"] });
      setMonthFilter(nextBase);
      setCloseMonthOpen(false);
      const moved = (data as { moved_deals?: number } | null)?.moved_deals ?? 0;
      toast({
        title: "✅ Mês fechado com sucesso!",
        description: `${currentMonth} congelado, temporada do jogo encerrada e ${moved} proposta(s) movida(s) para ${nextBase}.`,
      });
    } catch (e) {
      toast({
        title: "Erro ao fechar mês",
        description: e instanceof Error ? e.message : "Tente novamente.",
        variant: "destructive",
      });
    }
  };


  // ── Check-in / Checkout (compartilhado com a página /checkin) ──
  const [myBrokerId, setMyBrokerId] = useState<string | null>(null);
  useEffect(() => {
    setMyBrokerId(user?.id || null);
  }, [user?.id]);
  const isInQueue = !!myBrokerId && queue.some((row) => row.broker_id === myBrokerId);

  const loadQueue = useCallback(async () => {
    try {
      setQueue(await listOpenCheckins());
    } catch (error) {
      console.error("Erro ao carregar fila de check-in:", error);
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    const ch = supabase
      .channel("pipeline-checkins")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins" }, () => loadQueue())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadQueue]);

  const invokeCheckin = useCallback(async (action: "checkin" | "checkout") => {
    setCheckingIn(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) throw new Error("Você precisa estar logado.");
      const { data, error } = await supabase.functions.invoke("broker-checkin", { body: { action } });
      if (error) {
        throw new Error(await functionErrorMessage(error, "Falha no check-in"));
      }
      const responseError = data && typeof data === "object" && "error" in data
        ? (data as { error?: unknown }).error
        : null;
      if (typeof responseError === "string" && responseError) throw new Error(responseError);
      toast({ title: action === "checkin" ? "✅ Check-in realizado!" : "👋 Check-out realizado!" });
      await loadQueue();
    } catch (e: unknown) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha no check-in", variant: "destructive" });
    } finally {
      setCheckingIn(false);
    }
  }, [loadQueue]);

  const handleCheckIn = useCallback(() => invokeCheckin("checkin"), [invokeCheckin]);
  const handleCheckOut = useCallback(() => invokeCheckin("checkout"), [invokeCheckin]);

  // ── Convert Lead to Deal (fluxo real: anexo no lead + RPC convert_lead_to_deal) ──
  const openConvertLead = (lead: LeadRecord) => {
    setConvertingLead(lead);
    setConvertDoc(null);
    setConvertForm({ developerId: "", projectId: "", unit: "", vgv: "" });
    setConvertProjects([]);
    setConvertOpen(true);
  };

  const pickConvertDeveloper = async (developerId: string) => {
    setConvertForm((prev) => ({ ...prev, developerId, projectId: "" }));
    try {
      setConvertProjects(await listDeveloperProjects(developerId));
    } catch {
      setConvertProjects([]);
    }
  };

  const confirmConvert = async () => {
    if (!convertingLead) return;
    if (!convertForm.developerId) {
      toast({ title: "Construtora obrigatória", description: "Escolha a construtora do negócio.", variant: "destructive" });
      return;
    }
    setConverting(true);
    try {
      if (convertDoc) await uploadLeadAttachment(convertingLead.id, convertDoc);
      await convertLeadToDeal({
        leadId: convertingLead.id,
        developerId: convertForm.developerId,
        projectId: convertForm.projectId || null,
        unit: convertForm.unit || null,
        vgvGross: convertForm.vgv ? Number(convertForm.vgv.replace(",", ".")) : null,
      });
      await fetchDeals();
      setConvertOpen(false);
      setConvertingLead(null);
      setConvertDoc(null);
      setActiveTab("deals");
      toast({
        title: "🎉 Lead convertido em negócio!",
        description: convertDoc
          ? `"${convertingLead.name}" entrou no pipeline com o documento anexado.`
          : `"${convertingLead.name}" entrou no pipeline. Os documentos podem ser anexados depois.`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Não foi possível converter",
        description: err instanceof Error ? err.message : "verifique os dados do negócio",
      });
    } finally {
      setConverting(false);
    }
  };

  // ── Deal filters ──
  const filtered = useMemo(() => {
    return deals.filter((d) => {
      const s = search.toLowerCase();
      const matchSearch = !s || d.client.toLowerCase().includes(s) || (d.project?.toLowerCase() || "").includes(s) || (d.broker1?.toLowerCase() || "").includes(s);
      const matchDev = developerFilter === "all" || d.developer === developerFilter;
      const matchBroker = brokerFilter === "all" || d.broker1 === brokerFilter;
      const matchStage = stageFilter === "all" || d.stage === stageFilter;
      const matchStatus2 = status2Filter === "all" || d.status === status2Filter;
      const matchReview = documentReviewFilter === "all" || d.document_review_status === documentReviewFilter;
      const matchManager = managerFilter === "all" || d.manager1 === managerFilter;
      const matchClient = !clientNameFilter || d.client.toLowerCase().includes(clientNameFilter.toLowerCase());
      const dealMonth = d.month_base || (d.created_at ? format(parseISO(d.created_at), "MM/yyyy") : "");
      const matchMonth = monthFilter === "all" || dealMonth === monthFilter;
      return matchSearch && matchDev && matchBroker && matchStage && matchStatus2 && matchReview && matchManager && matchClient && matchMonth;
    }).sort((a, b) => {
      // Sort by Construtora first, then Status 2 in the FACEIMOB_STATUSES order
      const devCmp = (a.developer || "").localeCompare(b.developer || "");
      if (devCmp !== 0) return devCmp;
      const statusOrder = FACEIMOB_STATUSES.map(s => s.label);
      const aStatus = (a.status && a.status !== "Ativo" && a.status !== "OFF") ? a.status : (tableStageLabels[a.stage]?.label || "PROPOSTA");
      const bStatus = (b.status && b.status !== "Ativo" && b.status !== "OFF") ? b.status : (tableStageLabels[b.stage]?.label || "PROPOSTA");
      const aIdx = statusOrder.indexOf(aStatus); const bIdx = statusOrder.indexOf(bStatus);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
  }, [deals, search, developerFilter, brokerFilter, stageFilter, status2Filter, documentReviewFilter, managerFilter, clientNameFilter, monthFilter]);

  const dealsByStage = useMemo(() => {
    const map: Record<DealStage, PipelineDeal[]> = { incomplete: [], lead: [], proposal: [], visit_scheduled: [], under_analysis: [], approved: [], contract: [], closed: [] };
    filtered.filter((d) => d.active).forEach((d) => map[d.stage]?.push(d));
    return map;
  }, [filtered]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  // ── Deal metrics ──
  const activeDeals = deals.filter((d) => d.active).length;
  const totalVGV = deals.filter((d) => d.active).reduce((a, d) => a + (d.deal_value || 0), 0);
  const pendingDocumentReviews = deals.filter((d) => d.document_review_status === "pending").length;

  // Drag handlers
  const onDragStart = useCallback((dealId: string) => setDraggedDeal(dealId), []);
  const onDragEnd = useCallback(() => { setDraggedDeal(null); setDragOverStage(null); }, []);
  const onDragOver = useCallback((e: React.DragEvent, stage: DealStage) => { e.preventDefault(); setDragOverStage(stage); }, []);
  const onDrop = useCallback(async (stage: DealStage) => {
    if (draggedDeal) {
      const deal = deals.find(d => d.id === draggedDeal);
      if (!deal) return;

      const oldStage = deal.stage;
      const stageLabel = DEAL_STAGES.find((s) => s.value === stage)?.label ?? stage;

      try {
        // Resolve a etapa ANTES de mexer na tela: `can_enter_stage()` trabalha
        // com o id, e mover o card para depois desfazer pisca à toa.
        const stageId = await getStageIdByCode(stage);

        if (!canEnterStage(stageId)) {
          toast({
            variant: "destructive",
            title: "Movimentação não permitida",
            description: `Seu perfil não pode mover negócios para "${stageLabel}".`,
          });
          return;
        }

        if (stage === "under_analysis" && oldStage !== "under_analysis"
            && deal.document_review_status !== "approved") {
          await submitDealForManagerReview(draggedDeal);
          await fetchDeals();
          toast({
            title: "Enviado para conferência do gerente",
            description: "O card seguirá para Em análise quando um gerente aprovar os documentos.",
          });
          setDraggedDeal(null);
          setDragOverStage(null);
          return;
        }

        setDeals((prev) => prev.map((d) => d.id === draggedDeal ? { ...d, stage } : d));

        const { error } = await supabase
          .from('deals')
          .update({ stage_id: stageId })
          .eq('id', draggedDeal);

        if (error) throw error;

        toast({ title: `Deal movido para ${stageLabel}` });
      } catch (err) {
        // Sem este rollback o card ficava na coluna nova com o banco recusando a
        // gravação: a tela mentia sobre o estado real até o próximo reload.
        setDeals((prev) => prev.map((d) => d.id === draggedDeal ? { ...d, stage: oldStage } : d));
        console.error("Error updating deal stage:", err);
        toast({
          variant: "destructive",
          title: "Não foi possível avançar o negócio",
          description: err instanceof Error ? err.message : "O status não foi atualizado no servidor.",
        });
      }
    }
    setDraggedDeal(null);
    setDragOverStage(null);
  }, [draggedDeal, deals, canEnterStage, fetchDeals]);

  const openNewDeal = () => { setEditingDeal(null); setFormData(emptyDeal); setDealFormOpen(true); };
  const saveNewLead = async () => {
    if (!newLeadData.name.trim()) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    const { error } = await supabase.from("leads").insert({
      full_name: newLeadData.name,
      phone: newLeadData.phone,
      phone_raw: newLeadData.whatsapp || newLeadData.phone,
      email: newLeadData.email || null,
      utm_source: newLeadData.source || "manual",
      status: "queued",
      funnel_stage: "new",
      assigned_to: brokers.find(person => person.name === newLeadData.broker_name)?.id || null,
      notes: newLeadData.notes || null,
      raw_payload: { created_manually: true },
    });
    if (error) return toast({ title: "Erro ao criar lead", description: error.message, variant: "destructive" });
    setNewLeadOpen(false);
    setNewLeadData({ name: "", phone: "", whatsapp: "", email: "", source: "", broker_name: "", notes: "" });
    toast({ title: "✅ Lead criado com sucesso!" });
  };

  const saveDeal = async () => {
    if (!formData.client.trim()) return;
    try {
      await saveLegacyDeal(
        {
          ...formData,
          id: editingDeal?.id,
          month_base: formData.month_base || (monthFilter !== "all" ? monthFilter : undefined),
        },
        people,
      );
      await fetchDeals();
      setDealFormOpen(false);
      toast({ title: editingDeal ? "Deal atualizado" : "Deal criado" });
    } catch (error) {
      toast({
        title: "Erro ao salvar deal",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    }
  };

  const saveDetailDeal = async (updated: PipelineDeal) => {
    await saveLegacyDeal(updated, people);
    await fetchDeals();
  };

  const toggleDealActive = async (dealId: string) => {
    const deal = deals.find(row => row.id === dealId);
    if (!deal) return;
    if (!deal.active) return toast({ title: "Negócios encerrados não podem ser reabertos por este atalho" });
    const stageId = await getStageIdByCode("lost");
    const { error } = await supabase.from("deals")
      .update({ stage_id: stageId, lost_reason: "Arquivado manualmente" })
      .eq("id", dealId);
    if (error) return toast({ title: "Erro ao arquivar", description: error.message, variant: "destructive" });
    setDeals(await listLegacyDeals());
  };

  const updateDealStatus = async (dealId: string, newStatus: string) => {
    const previous = deals.find((d) => d.id === dealId)?.status;
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, status: newStatus } : d));
    try {
      const normalized = normalizeStatus(newStatus);
      const current = deals.find((d) => d.id === dealId);
      const stageCode =
        normalized === "VENDA"
          ? "closed"
          : normalized === "QUEDA" || normalized === "DISTRATO" || normalized === "OFF"
            ? "lost"
            : current?.stage || "proposal";
      const stageId = await getStageIdByCode(stageCode);
      const { error } = await supabase
        .from("deals")
        .update({
          stage_id: stageId,
          status_detail: newStatus,
          lost_reason:
            normalized === "DISTRATO"
              ? "Distrato"
              : normalized === "QUEDA" || normalized === "OFF"
                ? newStatus
                : null,
        })
        .eq("id", dealId);
      if (error) throw error;
    } catch (err) {
      // Reverte: manter na tela um status que o banco recusou é mentir.
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, status: previous || d.status } : d));
      console.error("Error updating status:", err);
      toast({
        variant: "destructive",
        title: "Erro ao salvar status",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  /**
   * Agenda a visita.
   *
   * Antes isto só mudava a etapa do negócio e guardava a data em estado local:
   * a visita sumia no reload e a tabela `visits` — que tem data marcada, data
   * realizada e resultado — nunca recebia nada. Agora as duas coisas acontecem:
   * o card anda no funil E o agendamento fica registrado.
   */
  const scheduleVisit = async () => {
    if (!visitDeal || !visitDate) return;
    if (!user?.id) return toast({ title: "Sessão expirada", variant: "destructive" });

    const stageId = await getStageIdByCode("visit_scheduled");
    if (!canEnterStage(stageId)) {
      return toast({
        variant: "destructive",
        title: "Movimentação não permitida",
        description: 'Seu perfil não pode mover negócios para "Visita Agendada".',
      });
    }

    const { error } = await supabase.from("deals").update({ stage_id: stageId }).eq("id", visitDeal.id);
    if (error) return toast({ title: "Erro ao agendar visita", description: error.message, variant: "destructive" });

    try {
      await scheduleVisitRecord({
        dealId: visitDeal.id,
        brokerId: user.id,
        scheduledAt: visitDate.toISOString(),
      });
    } catch (e) {
      // A etapa já mudou; avisar sem desfazer é melhor do que fingir sucesso.
      toast({
        title: "Etapa atualizada, mas a visita não foi registrada",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    }

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
  const proposalsToday = deals.filter((d) => d.stage === "proposal" && d.created_at === format(new Date(), "yyyy-MM-dd")).length;
  const proposalsPeriod = deals.filter((d) => d.stage === "proposal" && d.active).length;
  const avgDealValue = activeDeals ? totalVGV / activeDeals : 0;
  const avgDaysInPipeline = activeDeals ? deals.filter((d) => d.active).reduce((a, d) => a + d.days_in_pipeline, 0) / activeDeals : 0;
  const brokerDeals = brokers.map((b) => ({
    name: b.name,
    count: deals.filter((d) => d.broker1 === b.name && d.active).length,
  })).sort((a, b) => b.count - a.count);
  return (
    <div className="space-y-4">
      {/* ── TOP RANKING (game / broker funnel) ────────── */}
      <PipelineTopRanking deals={deals} />

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
                <Button variant="destructive" size="sm" onClick={() => setCloseMonthOpen(true)} disabled={isMonthClosed}>
                  <Target className="h-4 w-4 mr-1" /> {isMonthClosed ? `${monthFilter} fechado` : "Fechar Mês"}
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

      {/* ── ATTENDANCE QUEUE (compact) ────────── */}
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>Fila: <span className="font-semibold text-foreground">{queue.length}</span></span>
          {queue.length > 0 && (
            <div className="flex -space-x-1.5 ml-1">
              {queue.slice(0, 5).map((q) => (
                <div key={q.id} className="w-5 h-5 rounded-full bg-primary/20 border border-background flex items-center justify-center text-[9px] font-bold text-primary" title={`${q.name} - ${q.checkedInAt}`}>
                  {q.name.charAt(0)}
                </div>
              ))}
              {queue.length > 5 && <div className="w-5 h-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] text-muted-foreground">+{queue.length - 5}</div>}
            </div>
          )}
        </div>
        {isInQueue ? (
          <Button size="sm" variant="ghost" onClick={handleCheckOut} className="h-7 text-xs text-destructive hover:text-destructive">
            <LogIn className="h-3.5 w-3.5 mr-1" /> Check-out
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={handleCheckIn} disabled={checkingIn} className="h-7 text-xs text-emerald-500 hover:text-emerald-500">
            <LogIn className="h-3.5 w-3.5 mr-1" /> {checkingIn ? "..." : "Check-in"}
          </Button>
        )}
      </div>

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
                  {/* `aria-label` em cada filtro: o gatilho do Select mostra o
                      valor escolhido, então sem nome próprio ele deixa de ser
                      identificável — para o leitor de tela e para qualquer um
                      que precise achá-lo depois de já ter filtrado. */}
                  <div className="grid grid-cols-2 gap-3">
                    <Select value={stageFilter} onValueChange={setStageFilter}>
                      <SelectTrigger aria-label="Status"><SelectValue placeholder="PROPOSTA" /></SelectTrigger>
                      <SelectContent>{[{ value: "all", label: "Todos Status" }, ...DEAL_STAGES].map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={status2Filter} onValueChange={setStatus2Filter}>
                      <SelectTrigger aria-label="Status 2"><SelectValue placeholder="Escolher Status 2" /></SelectTrigger>
                      <SelectContent className="max-h-80">
                        <SelectItem value="all">Todos Status 2</SelectItem>
                        {FACEIMOB_STATUSES.map(s => <SelectItem key={s.label} value={s.label}>{s.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={documentReviewFilter} onValueChange={setDocumentReviewFilter}>
                      <SelectTrigger aria-label="Conferência documental"><SelectValue placeholder="Conferência documental" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas conferências</SelectItem>
                        <SelectItem value="draft">Em preparação</SelectItem>
                        <SelectItem value="pending">Aguardando gerente</SelectItem>
                        <SelectItem value="returned">Devolvido para correção</SelectItem>
                        <SelectItem value="approved">Conferido</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input aria-label="Mês" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} placeholder="03/2026" />
                    <Select value={developerFilter} onValueChange={setDeveloperFilter}>
                      <SelectTrigger aria-label="Construtora"><SelectValue placeholder="Escolher uma Construtora" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Todas Construtoras</SelectItem>{developers.map(d => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={managerFilter} onValueChange={setManagerFilter}>
                      <SelectTrigger aria-label="Gerente"><SelectValue placeholder="Escolher Gerente 1" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Todos Gerentes</SelectItem>{managers.map(m => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Select value={brokerFilter} onValueChange={setBrokerFilter}>
                      <SelectTrigger aria-label="Corretor"><SelectValue placeholder="Escolher Corretor 1" /></SelectTrigger>
                      <SelectContent><SelectItem value="all">Todos Corretores</SelectItem>{brokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input aria-label="Nome do cliente" placeholder="Filtrar por nome cliente" value={clientNameFilter} onChange={(e) => setClientNameFilter(e.target.value)} />
                    <Input placeholder="Filtrar por nome 2º cliente" value={clientName2Filter} onChange={(e) => setClientName2Filter(e.target.value)} />
                    <Input placeholder="Filtrar por CPF Cliente" value={cpfFilter} onChange={(e) => setCpfFilter(e.target.value)} />
                    <Input placeholder="Filtrar por CPF 2º Cliente" value={cpf2Filter} onChange={(e) => setCpf2Filter(e.target.value)} />
                  </div>
                  <div className="flex justify-end mt-3">
                    <Button variant="ghost" size="sm" onClick={() => { setStageFilter("all"); setStatus2Filter("all"); setDocumentReviewFilter("all"); setDeveloperFilter("all"); setBrokerFilter("all"); setManagerFilter("all"); setClientNameFilter(""); setClientName2Filter(""); setCpfFilter(""); setCpf2Filter(""); setSearch(""); }}>
                      <X className="h-3 w-3 mr-1" /> Limpar Filtros
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Right side: compact metrics + view toggle */}
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar cliente, projeto, corretor..." className="pl-10 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="flex border border-border rounded-lg overflow-hidden">
                  <button onClick={() => setViewMode("table")} className={cn("p-1.5 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                    <List className="h-4 w-4" />
                  </button>
                  <button onClick={() => setViewMode("kanban")} className={cn("p-1.5 transition-colors", viewMode === "kanban" ? "bg-primary text-primary-foreground" : "hover:bg-secondary")}>
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Compact inline metrics */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span><span className="text-primary font-semibold">{activeDeals}</span> ativos</span>
                <span>•</span>
                <span><span className="text-foreground font-medium">{approvedDeals}</span> aprov. total</span>
                <span><span className="text-foreground font-medium">{approvedCond}</span> aprov. cond.</span>
                <span><span className="text-foreground font-medium">{underAnalysis}</span> em análise</span>
                <span><span className="text-warning font-semibold">{pendingDeals}</span> pendentes</span>
                <button
                  type="button"
                  onClick={() => setDocumentReviewFilter("pending")}
                  className="inline-flex items-center gap-1 hover:text-warning transition-colors"
                >
                  <FileCheck2 className="h-3 w-3" />
                  <span className="text-warning font-semibold">{pendingDocumentReviews}</span> aguard. gerente
                </button>
                <span>•</span>
                <span><span className="text-foreground font-medium">{proposalsToday}</span> hoje</span>
                <span><span className="text-foreground font-medium">{proposalsPeriod}</span> no período</span>
              </div>
            </div>
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
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "mb-2 h-5 px-1.5 text-[9px]",
                                    documentReviewMeta[deal.document_review_status ?? "draft"].className,
                                  )}
                                >
                                  {documentReviewMeta[deal.document_review_status ?? "draft"].label}
                                </Badge>
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
                            <th className="p-2 font-medium text-left">Conferência</th>
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
                          {dealsLoading && (
                            <tr><td colSpan={15} className="p-6 text-center text-muted-foreground">Carregando negócios...</td></tr>
                          )}
                          {!dealsLoading && paginated.length === 0 && (
                            <tr><td colSpan={15} className="p-6 text-center text-muted-foreground">Nenhum negócio encontrado com os filtros atuais.</td></tr>
                          )}
                          {paginated.map((deal) => {
                            const statusDate = deal.created_at ? format(parseISO(deal.created_at), "MM/yy") : "";
                            const status2Label = (deal.status && deal.status !== "Ativo" && deal.status !== "OFF")
                              ? deal.status
                              : (tableStageLabels[deal.stage]?.label || "PROPOSTA");
                            const status2Color = faceimobStatusColor(status2Label);
                            const review = documentReviewMeta[deal.document_review_status ?? "draft"];
                            const stripeColor =
                              deal.days_in_pipeline > 60 ? "bg-red-600" :
                              deal.days_in_pipeline > 30 ? "bg-orange-500" :
                              deal.days_in_pipeline > 14 ? "bg-yellow-500" : "bg-emerald-500";
                            return (
                              <tr key={deal.id} className="border-b border-border/10 hover:bg-secondary/20 transition-colors cursor-pointer" onClick={() => setDetailDeal(deal)}>
                                <td className="p-0 text-center relative w-3">
                                  <div className={cn("absolute left-0 top-0 bottom-0 w-1.5", stripeColor)} />
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
                                <td className="p-2">
                                  <Badge variant="outline" className={cn("text-[9px] whitespace-nowrap", review.className)}>
                                    {review.label}
                                  </Badge>
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
        /* ═══ LEADS TAB (Funil) ═══ */
        <LeadFunnel
          actorName={user?.email || "Usuário"}
          onConvert={openConvertLead}
        />
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
                  O negócio será inserido na etapa inicial do funil
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">Os documentos obrigatórios serão cobrados somente no envio para conferência do gerente.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Construtora *</label>
                  <Select value={convertForm.developerId} onValueChange={pickConvertDeveloper}>
                    <SelectTrigger><SelectValue placeholder="Escolher" /></SelectTrigger>
                    <SelectContent>{developers.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Empreendimento</label>
                  <Select
                    value={convertForm.projectId}
                    onValueChange={(v) => setConvertForm(p => ({ ...p, projectId: v }))}
                    disabled={!convertForm.developerId || convertProjects.length === 0}
                  >
                    <SelectTrigger><SelectValue placeholder={convertProjects.length ? "Opcional" : "Sem empreendimentos"} /></SelectTrigger>
                    <SelectContent>{convertProjects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Unidade</label>
                  <Input value={convertForm.unit} onChange={(e) => setConvertForm(p => ({ ...p, unit: e.target.value }))} placeholder="Opcional" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">VGV bruto</label>
                  <Input value={convertForm.vgv} onChange={(e) => setConvertForm(p => ({ ...p, vgv: e.target.value }))} placeholder="Opcional" />
                </div>
              </div>

              <div>
                <label className="text-sm text-muted-foreground mb-2 block">Documento inicial (opcional)</label>
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
                <Button onClick={confirmConvert} disabled={!convertForm.developerId || converting} className="bg-success hover:bg-success/90 text-success-foreground">
                  <ArrowRightCircle className="h-4 w-4 mr-1" /> {converting ? "Convertendo..." : "Converter em Negócio"}
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
          people={people}
          developers={developers}
          onReviewChanged={fetchDeals}
          onSave={async (updated) => {
            await saveDetailDeal(updated);
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
              <Select value={formData.developer} onValueChange={(v) => { setFormData((p) => ({ ...p, developer: v, project: "" })); void loadFormProjects(v); }}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{developers.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Empreendimento</label>
              <Select value={formData.project} onValueChange={(v) => setFormData((p) => ({ ...p, project: v }))} disabled={!formData.developer}><SelectTrigger><SelectValue placeholder={formProjects.length ? "Selecione" : "Sem empreendimentos"} /></SelectTrigger><SelectContent>{formProjects.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Unidade</label><Input value={formData.unit} onChange={(e) => setFormData((p) => ({ ...p, unit: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 1</label>
              <Select value={formData.broker1} onValueChange={(v) => setFormData((p) => ({ ...p, broker1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{brokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor 2</label>
              <Select value={formData.broker2 || "none"} onValueChange={(v) => setFormData((p) => ({ ...p, broker2: v === "none" ? undefined : v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{brokers.filter((b) => b.active).map((b) => <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 1</label>
              <Select value={formData.manager1} onValueChange={(v) => setFormData((p) => ({ ...p, manager1: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{managers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Gerente 2</label>
              <Select value={formData.manager2 || "none"} onValueChange={(v) => setFormData((p) => ({ ...p, manager2: v === "none" ? undefined : v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent><SelectItem value="none">Nenhum</SelectItem>{managers.map((m) => <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>)}</SelectContent></Select></div>
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
                <SelectContent>{sources.map(s => <SelectItem key={s.id} value={s.label}>{s.label}</SelectItem>)}</SelectContent>
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
