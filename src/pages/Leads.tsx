import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import {
  Plus, Upload, Search, Phone, Mail, MessageCircle, Pencil,
  ArrowRightCircle, UserPlus, FileSpreadsheet, CheckCircle,
  Zap, Send, Clock, BarChart3, AlertTriangle, Timer, HandMetal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappTemplates, emailTemplates, renderTemplate } from "@/lib/automationEngine";
import {
  listLeads, listLeadSources, listAssignableBrokers, getAutomationSettings,
  createLead, createLeads, updateLead, claimLead, reassignLead,
  convertLeadToDeal, listDevelopers, listDeveloperProjects,
  LEAD_STATUSES, leadStatusLabel, leadStatusClass, funnelStageLabel,
  attendSecondsLeft, formatCountdown, canClaim, isLeadOverdue,
  sourcePerformance, trackingFields,
  type LeadRecord, type LeadSource, type AutomationSettings, type NewLeadInput,
} from "@/integrations/supabase/leads";
import type { PersonRecord } from "@/integrations/supabase/newSchema";

const emptyForm = {
  full_name: "", phone: "", email: "", document: "",
  source_id: "", notes: "",
};

const GESTOR_ROLES = ["admin", "director", "manager", "marketing"];

export default function Leads() {
  const { user, role } = useAuth();
  const profileId = user?.id || null;
  const isGestor = GESTOR_ROLES.includes(role);

  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [brokers, setBrokers] = useState<PersonRecord[]>([]);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Redesenha os cronômetros da trava de atendimento sem recarregar dados.
  const [now, setNow] = useState(() => Date.now());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  // Modais
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRecord | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [assignOpen, setAssignOpen] = useState<LeadRecord | null>(null);
  const [assignBroker, setAssignBroker] = useState("");
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [whatsappOpen, setWhatsappOpen] = useState<LeadRecord | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [emailOpen, setEmailOpen] = useState<LeadRecord | null>(null);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState("");
  const [showSourceMetrics, setShowSourceMetrics] = useState(false);
  const [convertOpen, setConvertOpen] = useState<LeadRecord | null>(null);
  const [developers, setDevelopers] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [convertForm, setConvertForm] = useState({ developerId: "", projectId: "", unit: "", vgv: "" });
  const [converting, setConverting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await listLeads();
      setLeads(rows);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "falha ao carregar leads";
      setLoadError(message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const [leadsResult, sourcesResult, brokersResult, settingsResult] = await Promise.allSettled([
        listLeads(),
        listLeadSources(),
        isGestor ? listAssignableBrokers() : Promise.resolve([] as PersonRecord[]),
        getAutomationSettings(),
      ]);
      if (!active) return;
      if (leadsResult.status === "fulfilled") setLeads(leadsResult.value);
      else setLoadError(leadsResult.reason?.message || "falha ao carregar leads");
      if (sourcesResult.status === "fulfilled") setSources(sourcesResult.value);
      if (brokersResult.status === "fulfilled") setBrokers(brokersResult.value);
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isGestor]);

  // A roleta mexe no lead pelo banco (atribuição, expiração, redistribuição):
  // sem realtime a tela do corretor mostra um estado que já não existe.
  useEffect(() => {
    const channel = supabase
      .channel("leads-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => { void reload(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  // Esta tela fica aberta o dia inteiro. O tique de 1s só vale quando há trava
  // correndo; fora disso um passo lento basta para "atrasado" e "inativo".
  const hasRunningDeadline = leads.some(
    (lead) => lead.status === "assigned" && lead.attend_deadline,
  );

  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), hasRunningDeadline ? 1_000 : 30_000);
    return () => clearInterval(ticker);
  }, [hasRunningDeadline]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchSearch = !term
        || lead.name.toLowerCase().includes(term)
        || (lead.email || "").toLowerCase().includes(term)
        || (lead.phone || "").includes(term)
        || (lead.campaign_name || "").toLowerCase().includes(term);
      const matchStatus = statusFilter === "all" || lead.status === statusFilter;
      const matchSource = sourceFilter === "all"
        || lead.source_id === sourceFilter
        || (sourceFilter === "none" && !lead.source_id);
      return matchSearch && matchStatus && matchSource;
    });
  }, [leads, search, statusFilter, sourceFilter]);

  const metrics = useMemo(() => ({
    total: leads.length,
    queued: leads.filter((lead) => lead.status === "queued").length,
    attending: leads.filter((lead) => lead.status === "attending" || lead.status === "in_progress").length,
    converted: leads.filter((lead) => lead.status === "converted").length,
    overdue: leads.filter((lead) => isLeadOverdue(lead, now)).length,
  }), [leads, now]);

  const sourceMetrics = useMemo(() => sourcePerformance(leads), [leads]);
  const overdueLeads = useMemo(
    () => leads.filter((lead) => isLeadOverdue(lead, now)),
    [leads, now],
  );
  const overdueThreshold = settings?.overdue_block_threshold ?? 20;

  const openNew = () => { setEditingLead(null); setFormData(emptyForm); setFormOpen(true); };
  const openEdit = (lead: LeadRecord) => {
    setEditingLead(lead);
    setFormData({
      full_name: lead.full_name,
      phone: lead.phone || "",
      email: lead.email || "",
      document: lead.document || "",
      source_id: lead.source_id || "",
      notes: lead.notes || "",
    });
    setFormOpen(true);
  };

  const saveLead = async () => {
    if (!formData.full_name.trim()) return;
    setSaving(true);
    try {
      if (editingLead) {
        await updateLead(editingLead.id, {
          full_name: formData.full_name,
          phone: formData.phone || null,
          email: formData.email || null,
          document: formData.document || null,
          source_id: formData.source_id || null,
          notes: formData.notes || null,
        });
        toast({ title: "Lead atualizado" });
      } else {
        await createLead({
          full_name: formData.full_name,
          phone: formData.phone,
          email: formData.email,
          document: formData.document,
          source_id: formData.source_id || null,
          notes: formData.notes,
        });
        toast({
          title: "Lead criado",
          description: "Entrou na fila de distribuição. A roleta atribui o corretor.",
        });
      }
      setFormOpen(false);
      await reload();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: err instanceof Error ? err.message : "não foi possível gravar o lead",
      });
    } finally {
      setSaving(false);
    }
  };

  // "Atender": trava o lead com o corretor (claim_lead) e para o cronômetro.
  const attend = async (lead: LeadRecord) => {
    try {
      await claimLead(lead.id);
      toast({ title: "Lead em atendimento", description: `${lead.name} está travado com você.` });
      await reload();
    } catch (err) {
      // Caso comum: outro corretor assumiu antes, ou o prazo estourou e o lead
      // voltou à fila. A mensagem vem do banco.
      toast({
        variant: "destructive",
        title: "Não foi possível atender",
        description: err instanceof Error ? err.message : "tente novamente",
      });
      await reload();
    }
  };

  const doAssign = async () => {
    if (!assignOpen || !assignBroker) return;
    try {
      await reassignLead(assignOpen.id, assignBroker);
      toast({ title: "Lead realocado", description: "A trava de atendimento reiniciou." });
      setAssignOpen(null);
      setAssignBroker("");
      await reload();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro ao realocar",
        description: err instanceof Error ? err.message : "sem permissão ou corretor inválido",
      });
    }
  };

  const openConvert = async (lead: LeadRecord) => {
    setConvertOpen(lead);
    setConvertForm({ developerId: "", projectId: "", unit: "", vgv: "" });
    setProjects([]);
    try {
      setDevelopers(await listDevelopers());
    } catch {
      setDevelopers([]);
    }
  };

  const pickDeveloper = async (developerId: string) => {
    setConvertForm((prev) => ({ ...prev, developerId, projectId: "" }));
    try {
      setProjects(await listDeveloperProjects(developerId));
    } catch {
      setProjects([]);
    }
  };

  const doConvert = async () => {
    if (!convertOpen || !convertForm.developerId) return;
    setConverting(true);
    try {
      await convertLeadToDeal({
        leadId: convertOpen.id,
        developerId: convertForm.developerId,
        projectId: convertForm.projectId || null,
        unit: convertForm.unit || null,
        vgvGross: convertForm.vgv ? Number(convertForm.vgv.replace(",", ".")) : null,
      });
      toast({
        title: "Lead convertido em negócio",
        description: "Acompanhe no Pipeline, em análise inicial.",
      });
      setConvertOpen(null);
      await reload();
    } catch (err) {
      // O banco exige ao menos um documento anexado ao lead — a recusa vem daí.
      toast({
        variant: "destructive",
        title: "Não foi possível converter",
        description: err instanceof Error ? err.message : "verifique os dados do negócio",
      });
    } finally {
      setConverting(false);
    }
  };

  // WhatsApp
  const openWhatsApp = (lead: LeadRecord) => {
    setWhatsappOpen(lead);
    setSelectedTemplate("");
    setWhatsappMessage("");
  };

  const applyWhatsAppTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tpl = whatsappTemplates.find((t) => t.id === templateId);
    if (tpl && whatsappOpen) {
      setWhatsappMessage(renderTemplate(tpl.template, {
        client_name: whatsappOpen.name,
        broker_name: whatsappOpen.broker_name || "Faceimob",
        project: "Nossos empreendimentos",
        visit_date: "",
        visit_time: "",
        address: "",
      }));
    }
  };

  const sendWhatsApp = () => {
    if (!whatsappOpen) return;
    const digits = (whatsappOpen.phone || "").replace(/\D/g, "");
    const phone = digits.startsWith("55") ? digits : `55${digits}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage)}`, "_blank");
    setWhatsappOpen(null);
    toast({ title: "WhatsApp aberto", description: `Mensagem preparada para ${whatsappOpen.name}` });
  };

  // E-mail
  const openEmail = (lead: LeadRecord) => {
    setEmailOpen(lead);
    setSelectedEmailTemplate("");
  };

  const sendEmail = () => {
    if (!emailOpen) return;
    const tpl = emailTemplates.find((t) => t.id === selectedEmailTemplate);
    if (tpl) {
      const vars = {
        client_name: emailOpen.name, project: "",
        broker_name: emailOpen.broker_name || "Faceimob", unit: "", visit_date: "",
      };
      const subject = renderTemplate(tpl.subject, vars);
      const body = renderTemplate(tpl.body, vars);
      window.open(`mailto:${emailOpen.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    }
    setEmailOpen(null);
  };

  // Importação Leadfy (CSV/XLSX)
  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    reader.onload = (ev) => {
      let rows: string[][] = [];
      if (isExcel) {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
        rows = json.map((r) => r.map((c: any) => String(c ?? "").trim()));
      } else {
        const text = ev.target?.result as string;
        rows = text.split(/\r?\n/).map((r) => r.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
      }
      setCsvPreview(rows.filter((r) => r.some((c) => c)).slice(0, 11));
      setCsvOpen(true);
    };
    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
    e.target.value = "";
  };

  const importCSV = async () => {
    if (csvPreview.length < 2) return;
    const headers = csvPreview[0].map((h) => h.toLowerCase().trim());
    const find = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
    const nameIdx = find("cliente", "nome", "name");
    const phoneIdx = find("telefone", "phone", "whatsapp", "canal");
    const emailIdx = find("email", "e-mail");
    const sourceIdx = find("fonte", "origem", "source");
    const notesIdx = find("observaç", "mensagem", "obs");

    const importSource = sources.find((s) => s.channel === "import")
      || sources.find((s) => /leadfy/i.test(s.label));

    const payload: NewLeadInput[] = csvPreview.slice(1)
      .filter((row) => row.length > 1 && (row[nameIdx] || row[0]))
      .map((row) => {
        const label = sourceIdx >= 0 ? row[sourceIdx] : "";
        const matched = label
          ? sources.find((s) => s.label.toLowerCase() === label.toLowerCase())
          : null;
        return {
          full_name: (nameIdx >= 0 ? row[nameIdx] : row[0]) || "",
          phone: phoneIdx >= 0 ? row[phoneIdx] : null,
          email: emailIdx >= 0 ? row[emailIdx] : null,
          source_id: (matched || importSource)?.id || null,
          utm_source: label || "Leadfy",
          notes: notesIdx >= 0 ? row[notesIdx] : "Importado via Leadfy",
        };
      });

    try {
      const count = await createLeads(payload);
      setCsvOpen(false);
      setCsvPreview([]);
      toast({
        title: `${count} leads importados`,
        description: "Entraram na fila; a roleta distribui conforme o check-in.",
      });
      await reload();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro na importação",
        description: err instanceof Error ? err.message : "não foi possível salvar os leads",
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">Leads <Zap className="h-5 w-5 text-primary" /></h1>
          <p className="text-muted-foreground">
            {filtered.length} de {metrics.total} leads {loading && "• Carregando..."}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleCSVFile} />
          <Button variant="outline" size="sm" onClick={() => setShowSourceMetrics(!showSourceMetrics)}>
            <BarChart3 className="h-4 w-4 mr-2" /> Origens
          </Button>
          {isGestor && (
            <>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Importar Leadfy (CSV/XLSX)
              </Button>
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" /> Novo Lead
              </Button>
            </>
          )}
        </div>
      </div>

      {loadError && (
        <Card className="glass border-destructive/40">
          <CardContent className="p-4 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <span>Não foi possível carregar os leads: {loadError}</span>
          </CardContent>
        </Card>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: metrics.total, color: "text-primary" },
          { label: "Na fila", value: metrics.queued, color: "text-muted-foreground" },
          { label: "Em atendimento", value: metrics.attending, color: "text-primary" },
          { label: "Convertidos", value: metrics.converted, color: "text-purple-400" },
          { label: "Atrasados", value: metrics.overdue, color: metrics.overdue > 0 ? "text-destructive" : "text-success" },
        ].map((m) => (
          <Card key={m.label} className="glass">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className={cn("text-2xl font-bold", m.color)}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Origens: quanto cada campanha converte (ata 23/07) */}
      <AnimatePresence>
        {showSourceMetrics && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="glass border-primary/30">
              <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">Desempenho por origem</CardTitle></CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-left">Origem</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Convertidos</th><th className="p-2 text-right">Conv. %</th><th className="p-2 text-right">Dias até converter</th></tr></thead>
                  <tbody>{sourceMetrics.map((s) => (
                    <tr key={s.source} className="border-b border-border/10">
                      <td className="p-2">{s.source}</td>
                      <td className="p-2 text-right">{s.totalLeads}</td>
                      <td className="p-2 text-right">{s.converted}</td>
                      <td className="p-2 text-right">
                        <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", s.conversionRate > 20 ? "bg-emerald-600/20 text-emerald-400" : "bg-warning/20 text-warning")}>{s.conversionRate}%</span>
                      </td>
                      <td className="p-2 text-right">{s.avgDaysToConvert || "—"}</td>
                    </tr>
                  ))}
                  {sourceMetrics.length === 0 && (
                    <tr><td colSpan={5} className="p-3 text-center text-muted-foreground">Sem leads para medir.</td></tr>
                  )}</tbody>
                </table>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Atrasados: mesma conta que bloqueia o check-in (overdue_lead_count) */}
      {overdueLeads.length > 0 && (
        <Card className="glass border-amber-500/30">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs font-semibold text-amber-400 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> Leads atrasados ({overdueLeads.length})
              {overdueLeads.length >= overdueThreshold && (
                <span className="text-destructive">• check-in bloqueado a partir de {overdueThreshold}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-1">
            {overdueLeads.slice(0, 8).map((lead) => (
              <div key={lead.id} className="p-2 rounded text-xs border border-warning/20 bg-warning/5 flex items-center justify-between gap-2">
                <span className="truncate">
                  <span className="font-medium">{lead.name}</span>
                  {" — próxima ação vencida em "}
                  {lead.next_action_at ? format(new Date(lead.next_action_at), "dd/MM HH:mm") : "—"}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">{funnelStageLabel(lead.funnel_stage)}</Badge>
              </div>
            ))}
            {overdueLeads.length > 8 && (
              <p className="text-[11px] text-muted-foreground">+ {overdueLeads.length - 8} outros.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Busca + filtros */}
      <Card className="glass">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, e-mail, telefone ou campanha..." className="pl-10" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-52"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {LEAD_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as origens</SelectItem>
              {sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              <SelectItem value="none">Sem origem</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Lista */}
      <div className="grid gap-3">
        {filtered.map((lead) => {
          const secondsLeft = attendSecondsLeft(lead, now);
          const claimable = canClaim(lead, profileId);
          const overdue = isLeadOverdue(lead, now);
          const tracking = trackingFields(lead).slice(0, 3);
          return (
            <Card
              key={lead.id}
              className={cn(
                "glass hover:bg-secondary/50 transition-colors group",
                claimable && "ring-2 ring-primary/60",
                overdue && "ring-1 ring-destructive/50",
              )}
            >
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-medium">{lead.name}</h3>
                      <Badge className={leadStatusClass(lead.status)}>{leadStatusLabel(lead.status)}</Badge>
                      <Badge variant="outline" className="text-[10px]">{funnelStageLabel(lead.funnel_stage)}</Badge>
                      {secondsLeft !== null && (
                        <Badge
                          className={cn(
                            "gap-1",
                            secondsLeft <= 60 ? "bg-destructive text-destructive-foreground" : "bg-warning/20 text-warning",
                          )}
                        >
                          <Timer className="h-3 w-3" /> {formatCountdown(secondsLeft)}
                        </Badge>
                      )}
                      {overdue && (
                        <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive gap-1">
                          <AlertTriangle className="h-3 w-3" /> Atrasado
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                      {lead.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {lead.email}</span>}
                      {lead.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {lead.phone}</span>}
                      {lead.phone && (
                        <button onClick={() => openWhatsApp(lead)} className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </button>
                      )}
                      {lead.email && (
                        <button onClick={() => openEmail(lead)} className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors">
                          <Send className="h-3 w-3" /> E-mail
                        </button>
                      )}
                    </div>
                    {tracking.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {tracking.map((field) => (
                          <Badge key={field.label} variant="outline" className="text-[10px] font-normal">
                            {field.label}: {field.value}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {lead.notes && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{lead.notes}</p>}
                  </div>
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                    <div className="text-right text-sm mr-2">
                      <p className="text-muted-foreground">Origem: {lead.source || "—"}</p>
                      <p className="text-muted-foreground">Corretor: {lead.broker_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(lead.created_at), "dd/MM/yyyy HH:mm")}</p>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {claimable && (
                        <Button size="sm" onClick={() => attend(lead)} className="gap-1">
                          <HandMetal className="h-3.5 w-3.5" /> Atender
                        </Button>
                      )}
                      <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(lead)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                        {isGestor && (
                          <Button
                            variant="ghost" size="icon" title="Realocar corretor"
                            onClick={() => { setAssignOpen(lead); setAssignBroker(lead.assigned_to || ""); }}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                        )}
                        {lead.status !== "converted" && !lead.converted_deal_id && (
                          <Button
                            variant="ghost" size="icon" title="Converter em negócio"
                            className="text-success hover:text-success" onClick={() => openConvert(lead)}
                          >
                            <ArrowRightCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && !loading && (
          <div className="text-center p-8 text-muted-foreground">Nenhum lead encontrado.</div>
        )}
      </div>

      {/* Formulário de lead */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle>{editingLead ? "Editar Lead" : "Novo Lead"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label><Input value={formData.full_name} onChange={(e) => setFormData((p) => ({ ...p, full_name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">E-mail</label><Input type="email" value={formData.email} onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Telefone / WhatsApp</label><Input value={formData.phone} onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">CPF / documento</label><Input value={formData.document} onChange={(e) => setFormData((p) => ({ ...p, document: e.target.value }))} /></div>
            <div className="sm:col-span-2">
              <label className="text-sm text-muted-foreground mb-1 block">Origem</label>
              <Select value={formData.source_id} onValueChange={(v) => setFormData((p) => ({ ...p, source_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2"><label className="text-sm text-muted-foreground mb-1 block">Observações</label><Textarea value={formData.notes} onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))} rows={3} /></div>
          </div>
          {!editingLead && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" /> O lead entra na fila e a roleta escolhe o corretor entre quem está com check-in aberto.
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveLead} disabled={!formData.full_name.trim() || saving}>
              {saving ? "Salvando..." : editingLead ? "Salvar" : "Criar Lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Realocar corretor */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Realocar Lead</DialogTitle></DialogHeader>
          {assignOpen && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Lead: <span className="text-foreground font-medium">{assignOpen.name}</span></p>
              <Select value={assignBroker} onValueChange={setAssignBroker}>
                <SelectTrigger><SelectValue placeholder="Selecione o corretor" /></SelectTrigger>
                <SelectContent>
                  {brokers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}{b.team ? ` — ${b.team}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">A trava de atendimento reinicia para o novo corretor.</p>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
                <Button size="sm" onClick={doAssign} disabled={!assignBroker}>Realocar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Converter em negócio */}
      <Dialog open={!!convertOpen} onOpenChange={(o) => !o && setConvertOpen(null)}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightCircle className="h-5 w-5 text-success" /> Converter em Negócio
            </DialogTitle>
          </DialogHeader>
          {convertOpen && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-secondary/50 text-xs space-y-0.5">
                <p className="text-sm font-medium">{convertOpen.name}</p>
                <p className="text-muted-foreground">{convertOpen.email || "sem e-mail"} • {convertOpen.phone || "sem telefone"}</p>
                <p className="text-muted-foreground">Origem: {convertOpen.source || "—"} • Corretor: {convertOpen.broker_name || "—"}</p>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Construtora *</label>
                <Select value={convertForm.developerId} onValueChange={pickDeveloper}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{developers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Empreendimento</label>
                <Select
                  value={convertForm.projectId}
                  onValueChange={(v) => setConvertForm((p) => ({ ...p, projectId: v }))}
                  disabled={!convertForm.developerId || projects.length === 0}
                >
                  <SelectTrigger><SelectValue placeholder={convertForm.developerId ? "Selecione" : "Escolha a construtora"} /></SelectTrigger>
                  <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm text-muted-foreground mb-1 block">Unidade</label><Input value={convertForm.unit} onChange={(e) => setConvertForm((p) => ({ ...p, unit: e.target.value }))} /></div>
                <div><label className="text-sm text-muted-foreground mb-1 block">VGV bruto</label><Input inputMode="decimal" value={convertForm.vgv} onChange={(e) => setConvertForm((p) => ({ ...p, vgv: e.target.value }))} /></div>
              </div>
              <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                O lead precisa de pelo menos um documento anexado — a regra é validada no banco e a recusa aparece aqui.
              </p>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
                <Button size="sm" onClick={doConvert} disabled={!convertForm.developerId || converting}>
                  {converting ? "Convertendo..." : "Converter"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* WhatsApp */}
      <Dialog open={!!whatsappOpen} onOpenChange={(o) => !o && setWhatsappOpen(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-400" /> WhatsApp para {whatsappOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Template</label>
              <Select value={selectedTemplate} onValueChange={applyWhatsAppTemplate}>
                <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                <SelectContent>{whatsappTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea value={whatsappMessage} onChange={(e) => setWhatsappMessage(e.target.value)} rows={6} placeholder="Escreva ou selecione um template..." />
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={sendWhatsApp} disabled={!whatsappMessage} className="bg-emerald-600 hover:bg-emerald-700">
                <Send className="h-4 w-4 mr-2" /> Enviar WhatsApp
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* E-mail */}
      <Dialog open={!!emailOpen} onOpenChange={(o) => !o && setEmailOpen(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> E-mail para {emailOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={selectedEmailTemplate} onValueChange={setSelectedEmailTemplate}>
              <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
              <SelectContent>{emailTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} — {t.subject}</SelectItem>)}</SelectContent>
            </Select>
            {selectedEmailTemplate && (
              <div className="p-3 rounded-lg bg-secondary/50 text-xs space-y-2">
                <p className="font-semibold">Assunto: {emailTemplates.find((t) => t.id === selectedEmailTemplate)?.subject}</p>
                <p className="whitespace-pre-line text-muted-foreground">{emailTemplates.find((t) => t.id === selectedEmailTemplate)?.body}</p>
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={sendEmail} disabled={!selectedEmailTemplate}><Send className="h-4 w-4 mr-2" /> Abrir e-mail</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Importação */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="glass-strong max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-success" /> Importar Leads (CSV/XLSX)</DialogTitle></DialogHeader>
          {csvPreview.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Preview ({csvPreview.length - 1} linhas) — os leads entram na fila da roleta, sem corretor.
              </p>
              <div className="overflow-x-auto max-h-60 border border-border/50 rounded-lg">
                <table className="w-full text-xs">
                  <thead><tr className="bg-secondary/50 border-b border-border/50">{csvPreview[0]?.map((h, i) => <th key={i} className="p-2 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
                  <tbody>{csvPreview.slice(1).map((row, ri) => (
                    <tr key={ri} className="border-b border-border/20">{row.map((cell, ci) => <td key={ci} className="p-2">{cell}</td>)}</tr>
                  ))}</tbody>
                </table>
              </div>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={importCSV}><CheckCircle className="h-4 w-4 mr-2" /> Importar {csvPreview.length - 1} leads</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
