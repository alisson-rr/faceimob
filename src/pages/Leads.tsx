import { useState, useRef, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { mockLeads as initialLeads, mockBrokers, mockSources } from "@/data/mockData";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/types/crm";
import {
  Plus, Upload, Search, Phone, Mail, MessageCircle, Pencil,
  ArrowRightCircle, UserPlus, X, FileSpreadsheet, CheckCircle,
  Zap, Send, Bot, Clock, BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  autoAssignBroker, generateLeadTasks, checkFollowUpRules,
  whatsappTemplates, emailTemplates, renderTemplate,
  calculateSourceMetrics, type AutoTask
} from "@/lib/automationEngine";

const statusColor: Record<LeadStatus, string> = {
  new: 'bg-primary/20 text-primary',
  contacted: 'bg-warning/20 text-warning',
  qualified: 'bg-success/20 text-success',
  converted: 'bg-purple-500/20 text-purple-400',
  lost: 'bg-destructive/20 text-destructive',
};

const emptyLead = {
  name: '', phone: '', whatsapp: '', email: '', source: '',
  broker_id: '', broker_name: '', status: 'new' as LeadStatus, notes: '',
};

export default function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeads() {
      setLoading(true);
      try {
        const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        setLeads(data as Lead[]);
      } catch (err) {
        console.error("Error fetching leads:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeads();
  }, []);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [tasks, setTasks] = useState<AutoTask[]>([]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState(emptyLead);
  const [assignOpen, setAssignOpen] = useState<Lead | null>(null);
  const [assignBroker, setAssignBroker] = useState("");
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [whatsappOpen, setWhatsappOpen] = useState<Lead | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [whatsappMessage, setWhatsappMessage] = useState("");
  const [emailOpen, setEmailOpen] = useState<Lead | null>(null);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState("");
  const [showSourceMetrics, setShowSourceMetrics] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = leads.filter(l => {
    const s = search.toLowerCase();
    const matchSearch = !s || l.name.toLowerCase().includes(s) || l.email.toLowerCase().includes(s) || l.phone.includes(s);
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter;
    return matchSearch && matchStatus && matchSource;
  });

  const sourceMetrics = useMemo(() => calculateSourceMetrics(leads), [leads]);

  const openNew = () => { setEditingLead(null); setFormData(emptyLead); setFormOpen(true); };
  const openEdit = (lead: Lead) => { setEditingLead(lead); setFormData({ ...lead, broker_name: lead.broker_name || '' }); setFormOpen(true); };

  const saveLead = async () => {
    let broker = mockBrokers.find(b => b.id === formData.broker_id);

    // Auto-assign if no broker selected (new leads only)
    if (!editingLead && !formData.broker_id) {
      const auto = autoAssignBroker();
      broker = mockBrokers.find(b => b.id === auto.id);
      formData.broker_id = auto.id;
      formData.broker_name = auto.name;
    }

    try {
      if (editingLead) {
        const { error } = await supabase
          .from('leads')
          .update({
            ...formData,
            broker_name: broker?.name || formData.broker_name || '',
            updated_at: new Date().toISOString()
          })
          .eq('id', editingLead.id);
        
        if (error) throw error;
        setLeads(prev => prev.map(l => l.id === editingLead.id ? { ...l, ...formData, broker_name: broker?.name || l.broker_name } : l));
      } else {
        const { data, error } = await supabase
          .from('leads')
          .insert([{
            ...formData,
            broker_name: broker?.name || formData.broker_name || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (error) throw error;
        setLeads(prev => [data as Lead, ...prev]);

        // Generate automation tasks (client-side only for now)
        const newTasks = generateLeadTasks(data as Lead);
        setTasks(prev => [...newTasks, ...prev]);
        toast({ title: "⚡ Automação", description: `${newTasks.length} tarefas criadas automaticamente.` });
      }
      setFormOpen(false);
      toast({ title: editingLead ? "Lead atualizado" : "Lead criado com sucesso" });
    } catch (err) {
      console.error("Error saving lead:", err);
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Ocorreu um problema ao persistir os dados." });
    }
  };

  const doAssign = async () => {
    if (!assignOpen || !assignBroker) return;
    const broker = mockBrokers.find(b => b.id === assignBroker);
    
    try {
      const { error } = await supabase
        .from('leads')
        .update({ broker_id: assignBroker, broker_name: broker?.name || '', updated_at: new Date().toISOString() })
        .eq('id', assignOpen.id);
      
      if (error) throw error;
      
      setLeads(prev => prev.map(l => l.id === assignOpen.id ? { ...l, broker_id: assignBroker, broker_name: broker?.name || '' } : l));
      setAssignOpen(null);
      setAssignBroker("");
      toast({ title: "Corretor atribuído com sucesso" });
    } catch (err) {
      console.error("Error assigning broker:", err);
      toast({ variant: "destructive", title: "Erro ao atribuir", description: "Não foi possível salvar a alteração." });
    }
  };

  const convertToDeal = async (lead: Lead) => {
    try {
      const { error } = await supabase
        .from('leads')
        .update({ status: 'converted' as LeadStatus, updated_at: new Date().toISOString() })
        .eq('id', lead.id);
      
      if (error) throw error;
      
      setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: 'converted' as LeadStatus } : l));
      toast({ title: `Lead "${lead.name}" convertido em deal`, description: "Acesse o Pipeline para gerenciar o negócio." });
    } catch (err) {
      console.error("Error converting lead:", err);
      toast({ variant: "destructive", title: "Erro ao converter", description: "Não foi possível atualizar o status." });
    }
  };

  // WhatsApp
  const openWhatsApp = (lead: Lead) => {
    setWhatsappOpen(lead);
    setSelectedTemplate("");
    setWhatsappMessage("");
  };

  const applyWhatsAppTemplate = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tpl = whatsappTemplates.find(t => t.id === templateId);
    if (tpl && whatsappOpen) {
      const rendered = renderTemplate(tpl.template, {
        client_name: whatsappOpen.name,
        broker_name: whatsappOpen.broker_name || "Faceimob",
        project: "Nossos empreendimentos",
        visit_date: "",
        visit_time: "",
        address: "",
      });
      setWhatsappMessage(rendered);
    }
  };

  const sendWhatsApp = () => {
    if (!whatsappOpen) return;
    const phone = whatsappOpen.whatsapp || whatsappOpen.phone;
    const encoded = encodeURIComponent(whatsappMessage);
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encoded}`, '_blank');
    setWhatsappOpen(null);
    toast({ title: "WhatsApp aberto", description: `Mensagem preparada para ${whatsappOpen.name}` });
  };

  // Email
  const openEmail = (lead: Lead) => {
    setEmailOpen(lead);
    setSelectedEmailTemplate("");
  };

  const sendEmail = () => {
    if (!emailOpen) return;
    const tpl = emailTemplates.find(t => t.id === selectedEmailTemplate);
    if (tpl) {
      const subject = renderTemplate(tpl.subject, { client_name: emailOpen.name, project: "", broker_name: emailOpen.broker_name || "Faceimob", unit: "", visit_date: "" });
      const body = renderTemplate(tpl.body, { client_name: emailOpen.name, project: "", broker_name: emailOpen.broker_name || "Faceimob", unit: "", visit_date: "" });
      window.open(`mailto:${emailOpen.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    }
    setEmailOpen(null);
    toast({ title: "📧 Email", description: `Email preparado para ${emailOpen.name}` });
  };

  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      setCsvPreview(rows.slice(0, 11));
      setCsvOpen(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const importCSV = () => {
    if (csvPreview.length < 2) return;
    const headers = csvPreview[0].map(h => h.toLowerCase());
    const nameIdx = headers.findIndex(h => h.includes('nome') || h.includes('name'));
    const phoneIdx = headers.findIndex(h => h.includes('telefone') || h.includes('phone'));
    const emailIdx = headers.findIndex(h => h.includes('email'));
    const sourceIdx = headers.findIndex(h => h.includes('origem') || h.includes('source'));
    const newLeads: Lead[] = csvPreview.slice(1).filter(r => r.length > 1).map((row, i) => {
      const auto = autoAssignBroker();
      return {
        id: String(Date.now() + i),
        name: row[nameIdx] || row[0] || '',
        phone: row[phoneIdx] || row[1] || '',
        whatsapp: row[phoneIdx] || row[1] || '',
        email: row[emailIdx] || row[2] || '',
        source: row[sourceIdx] || 'CSV Import',
        broker_id: auto.id,
        broker_name: auto.name,
        created_at: new Date().toISOString().slice(0, 10),
        status: 'new' as LeadStatus,
        notes: 'Importado via CSV - auto-atribuído',
      };
    });
    setLeads(prev => [...newLeads, ...prev]);
    setCsvOpen(false);
    setCsvPreview([]);
    toast({ title: `${newLeads.length} leads importados e auto-atribuídos` });
  };

  // Metrics
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const qualifiedLeads = leads.filter(l => l.status === 'qualified').length;
  const convertedLeads = leads.filter(l => l.status === 'converted').length;
  const pendingTasks = tasks.filter(t => !t.completed).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">Leads <Zap className="h-5 w-5 text-primary" /></h1>
          <p className="text-muted-foreground">{filtered.length} de {totalLeads} leads {loading && "• Carregando..."}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVFile} />
          <Button variant="outline" size="sm" onClick={() => setShowSourceMetrics(!showSourceMetrics)}>
            <BarChart3 className="h-4 w-4 mr-2" /> Origens
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Novo Lead
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: totalLeads, color: 'text-primary' },
          { label: 'Novos', value: newLeads, color: 'text-primary' },
          { label: 'Qualificados', value: qualifiedLeads, color: 'text-success' },
          { label: 'Convertidos', value: convertedLeads, color: 'text-purple-400' },
          { label: 'Tarefas', value: pendingTasks, color: 'text-warning' },
        ].map(m => (
          <Card key={m.label} className="glass">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className={cn("text-2xl font-bold", m.color)}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Source Metrics Panel */}
      <AnimatePresence>
        {showSourceMetrics && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="glass border-primary/30">
              <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-primary">📊 Métricas por Origem</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border/30 text-muted-foreground"><th className="p-2 text-left">Origem</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Convertidos</th><th className="p-2 text-right">Conv. %</th><th className="p-2 text-right">Dias Médios</th></tr></thead>
                  <tbody>{sourceMetrics.map(s => (
                    <tr key={s.source} className="border-b border-border/10"><td className="p-2">{s.source}</td><td className="p-2 text-right">{s.totalLeads}</td><td className="p-2 text-right">{s.converted}</td><td className="p-2 text-right"><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", s.conversionRate > 20 ? "bg-emerald-600/20 text-emerald-400" : "bg-warning/20 text-warning")}>{s.conversionRate}%</span></td><td className="p-2 text-right">{s.avgDaysToConvert || "—"}</td></tr>
                  ))}</tbody>
                </table>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Automation Tasks */}
      {tasks.length > 0 && (
        <Card className="glass border-warning/30">
          <CardHeader className="py-2 px-3 flex flex-row items-center gap-2">
            <Bot className="h-4 w-4 text-warning" />
            <CardTitle className="text-xs font-semibold text-warning">Tarefas Automatizadas</CardTitle>
          </CardHeader>
          <CardContent className="p-3 space-y-2">
            {tasks.filter(t => !t.completed).slice(0, 5).map((task) => (
              <motion.div key={task.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                className={cn("flex items-center gap-3 p-2 rounded-lg border text-xs",
                  task.priority === "high" ? "border-destructive/20 bg-destructive/5" : "border-border/30 bg-card/40"
                )}>
                <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-muted-foreground">{task.assignedTo}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setTasks(prev => prev.map(t => t.id === task.id ? { ...t, completed: true } : t))}>
                  <CheckCircle className="h-3 w-3 mr-1" /> Feito
                </Button>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Follow-up Alerts */}
      {leads.some(l => checkFollowUpRules(l)) && (
        <Card className="glass border-amber-500/30">
          <CardHeader className="py-2 px-3"><CardTitle className="text-xs font-semibold text-amber-400">⏰ Alertas de Follow-up</CardTitle></CardHeader>
          <CardContent className="p-3 space-y-1">
            {leads.map(l => {
              const rule = checkFollowUpRules(l);
              if (!rule) return null;
              return (
                <div key={l.id} className={cn("p-2 rounded text-xs border",
                  rule.severity === "danger" ? "border-destructive/20 bg-destructive/5" :
                  rule.severity === "warning" ? "border-warning/20 bg-warning/5" : "border-primary/20 bg-primary/5"
                )}>
                  {rule.action}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Search + Filters */}
      <Card className="glass">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, email ou telefone..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todos Status</SelectItem>{LEAD_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent><SelectItem value="all">Todas Origens</SelectItem>{mockSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Leads List */}
      <div className="grid gap-3">
        {filtered.map((lead) => (
          <Card key={lead.id} className="glass hover:bg-secondary/50 transition-colors group">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-medium">{lead.name}</h3>
                    <Badge className={statusColor[lead.status]}>{LEAD_STATUSES.find(s => s.value === lead.status)?.label}</Badge>
                    {checkFollowUpRules(lead) && <Badge variant="outline" className="text-[10px] border-warning/30 text-warning">⏰ Follow-up</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {lead.email}</span>
                    <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {lead.phone}</span>
                    <button onClick={() => openWhatsApp(lead)} className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors">
                      <MessageCircle className="h-3 w-3" /> WhatsApp
                    </button>
                    <button onClick={() => openEmail(lead)} className="flex items-center gap-1 text-primary hover:text-primary/80 transition-colors">
                      <Send className="h-3 w-3" /> Email
                    </button>
                  </div>
                  {lead.notes && <p className="text-xs text-muted-foreground mt-2">{lead.notes}</p>}
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
                  <div className="text-right text-sm mr-4">
                    <p className="text-muted-foreground">Origem: {lead.source}</p>
                    <p className="text-muted-foreground">Corretor: {lead.broker_name || '—'}</p>
                    <p className="text-xs text-muted-foreground">{lead.created_at}</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(lead)} title="Editar"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => { setAssignOpen(lead); setAssignBroker(lead.broker_id); }} title="Atribuir"><UserPlus className="h-4 w-4" /></Button>
                    {lead.status !== 'converted' && (
                      <Button variant="ghost" size="icon" onClick={() => convertToDeal(lead)} title="Converter" className="text-success hover:text-success">
                        <ArrowRightCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <div className="text-center p-8 text-muted-foreground">Nenhum lead encontrado.</div>}
      </div>

      {/* Lead Form Modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle>{editingLead ? 'Editar Lead' : 'Novo Lead'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label><Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Email</label><Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Telefone</label><Input value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">WhatsApp</label><Input value={formData.whatsapp} onChange={e => setFormData(p => ({ ...p, whatsapp: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Origem</label>
              <Select value={formData.source} onValueChange={v => setFormData(p => ({ ...p, source: v }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{mockSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Corretor (auto se vazio)</label>
              <Select value={formData.broker_id} onValueChange={v => setFormData(p => ({ ...p, broker_id: v }))}><SelectTrigger><SelectValue placeholder="Auto-atribuir" /></SelectTrigger><SelectContent>{mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Status</label>
              <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v as LeadStatus }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LEAD_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><label className="text-sm text-muted-foreground mb-1 block">Observações</label><Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} /></div>
          </div>
          {!editingLead && <p className="text-[10px] text-muted-foreground flex items-center gap-1"><Bot className="h-3 w-3" /> Ao criar, o sistema auto-atribui corretor e gera tarefas de follow-up.</p>}
          <DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button onClick={saveLead} disabled={!formData.name}>{editingLead ? 'Salvar' : 'Criar Lead'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Broker Modal */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Atribuir Corretor</DialogTitle></DialogHeader>
          {assignOpen && (<div className="space-y-4"><p className="text-sm text-muted-foreground">Lead: <span className="text-foreground font-medium">{assignOpen.name}</span></p><Select value={assignBroker} onValueChange={setAssignBroker}><SelectTrigger><SelectValue placeholder="Selecione o corretor" /></SelectTrigger><SelectContent>{mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.id}>{b.name} — Time {b.team}</SelectItem>)}</SelectContent></Select><DialogFooter><DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose><Button size="sm" onClick={doAssign} disabled={!assignBroker}>Atribuir</Button></DialogFooter></div>)}
        </DialogContent>
      </Dialog>

      {/* WhatsApp Modal */}
      <Dialog open={!!whatsappOpen} onOpenChange={(o) => !o && setWhatsappOpen(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-400" /> WhatsApp para {whatsappOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Template</label>
              <Select value={selectedTemplate} onValueChange={applyWhatsAppTemplate}>
                <SelectTrigger><SelectValue placeholder="Selecione um template" /></SelectTrigger>
                <SelectContent>{whatsappTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea value={whatsappMessage} onChange={e => setWhatsappMessage(e.target.value)} rows={6} placeholder="Escreva ou selecione um template..." />
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={sendWhatsApp} disabled={!whatsappMessage} className="bg-emerald-600 hover:bg-emerald-700">
                <Send className="h-4 w-4 mr-2" /> Enviar WhatsApp
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Email Modal */}
      <Dialog open={!!emailOpen} onOpenChange={(o) => !o && setEmailOpen(null)}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" /> Email para {emailOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Select value={selectedEmailTemplate} onValueChange={setSelectedEmailTemplate}>
              <SelectTrigger><SelectValue placeholder="Selecione um template de email" /></SelectTrigger>
              <SelectContent>{emailTemplates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} — {t.subject}</SelectItem>)}</SelectContent>
            </Select>
            {selectedEmailTemplate && (
              <div className="p-3 rounded-lg bg-secondary/50 text-xs space-y-2">
                <p className="font-semibold">Assunto: {emailTemplates.find(t => t.id === selectedEmailTemplate)?.subject}</p>
                <p className="whitespace-pre-line text-muted-foreground">{emailTemplates.find(t => t.id === selectedEmailTemplate)?.body}</p>
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
              <Button onClick={sendEmail} disabled={!selectedEmailTemplate}><Send className="h-4 w-4 mr-2" /> Abrir Email</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* CSV Import Modal */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="glass-strong max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-success" /> Importar Leads via CSV</DialogTitle></DialogHeader>
          {csvPreview.length > 0 && (<div className="space-y-4"><p className="text-sm text-muted-foreground">Preview ({csvPreview.length - 1} linhas) — leads serão auto-atribuídos</p><div className="overflow-x-auto max-h-60 border border-border/50 rounded-lg"><table className="w-full text-xs"><thead><tr className="bg-secondary/50 border-b border-border/50">{csvPreview[0]?.map((h, i) => <th key={i} className="p-2 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead><tbody>{csvPreview.slice(1).map((row, ri) => (<tr key={ri} className="border-b border-border/20">{row.map((cell, ci) => <td key={ci} className="p-2">{cell}</td>)}</tr>))}</tbody></table></div><DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button onClick={importCSV}><CheckCircle className="h-4 w-4 mr-2" /> Importar {csvPreview.length - 1} Leads</Button></DialogFooter></div>)}
        </DialogContent>
      </Dialog>
    </div>
  );
}
