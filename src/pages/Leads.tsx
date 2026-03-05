import { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
  ArrowRightCircle, UserPlus, X, FileSpreadsheet, CheckCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

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
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [formData, setFormData] = useState(emptyLead);
  const [assignOpen, setAssignOpen] = useState<Lead | null>(null);
  const [assignBroker, setAssignBroker] = useState("");
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = leads.filter(l => {
    const s = search.toLowerCase();
    const matchSearch = !s || l.name.toLowerCase().includes(s) || l.email.toLowerCase().includes(s) || l.phone.includes(s);
    const matchStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchSource = sourceFilter === 'all' || l.source === sourceFilter;
    return matchSearch && matchStatus && matchSource;
  });

  const openNew = () => { setEditingLead(null); setFormData(emptyLead); setFormOpen(true); };
  const openEdit = (lead: Lead) => { setEditingLead(lead); setFormData({ ...lead, broker_name: lead.broker_name || '' }); setFormOpen(true); };

  const saveLead = () => {
    const broker = mockBrokers.find(b => b.id === formData.broker_id);
    if (editingLead) {
      setLeads(prev => prev.map(l => l.id === editingLead.id ? { ...l, ...formData, broker_name: broker?.name || l.broker_name } : l));
    } else {
      const newLead: Lead = {
        ...formData,
        id: String(Date.now()),
        created_at: new Date().toISOString().slice(0, 10),
        broker_name: broker?.name || '',
      };
      setLeads(prev => [newLead, ...prev]);
    }
    setFormOpen(false);
    toast({ title: editingLead ? "Lead atualizado" : "Lead criado com sucesso" });
  };

  const doAssign = () => {
    if (!assignOpen || !assignBroker) return;
    const broker = mockBrokers.find(b => b.id === assignBroker);
    setLeads(prev => prev.map(l => l.id === assignOpen.id ? { ...l, broker_id: assignBroker, broker_name: broker?.name || '' } : l));
    setAssignOpen(null);
    setAssignBroker("");
    toast({ title: "Corretor atribuído com sucesso" });
  };

  const convertToDeal = (lead: Lead) => {
    setLeads(prev => prev.map(l => l.id === lead.id ? { ...l, status: 'converted' as LeadStatus } : l));
    toast({ title: `Lead "${lead.name}" convertido em deal`, description: "Acesse o Pipeline para gerenciar o negócio." });
  };

  const handleCSVFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = text.split('\n').map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      setCsvPreview(rows.slice(0, 11)); // header + 10 rows
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

    const newLeads: Lead[] = csvPreview.slice(1).filter(r => r.length > 1).map((row, i) => ({
      id: String(Date.now() + i),
      name: row[nameIdx] || row[0] || '',
      phone: row[phoneIdx] || row[1] || '',
      whatsapp: row[phoneIdx] || row[1] || '',
      email: row[emailIdx] || row[2] || '',
      source: row[sourceIdx] || 'CSV Import',
      broker_id: '',
      broker_name: '',
      created_at: new Date().toISOString().slice(0, 10),
      status: 'new' as LeadStatus,
      notes: 'Importado via CSV',
    }));

    setLeads(prev => [...newLeads, ...prev]);
    setCsvOpen(false);
    setCsvPreview([]);
    toast({ title: `${newLeads.length} leads importados com sucesso` });
  };

  // Metrics
  const totalLeads = leads.length;
  const newLeads = leads.filter(l => l.status === 'new').length;
  const qualifiedLeads = leads.filter(l => l.status === 'qualified').length;
  const convertedLeads = leads.filter(l => l.status === 'converted').length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground">{filtered.length} de {totalLeads} leads</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVFile} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-2" /> Novo Lead
          </Button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: totalLeads, color: 'text-primary' },
          { label: 'Novos', value: newLeads, color: 'text-primary' },
          { label: 'Qualificados', value: qualifiedLeads, color: 'text-success' },
          { label: 'Convertidos', value: convertedLeads, color: 'text-purple-400' },
        ].map(m => (
          <Card key={m.label} className="glass">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{m.label}</p>
              <p className={cn("text-2xl font-bold", m.color)}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + Filters */}
      <Card className="glass">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, email ou telefone..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Status</SelectItem>
              {LEAD_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Origem" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Origens</SelectItem>
              {mockSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
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
                    <Badge className={statusColor[lead.status]}>
                      {LEAD_STATUSES.find(s => s.value === lead.status)?.label}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {lead.email}</span>
                    <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {lead.phone}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" /> WhatsApp</span>
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
                    <Button variant="ghost" size="icon" onClick={() => { setAssignOpen(lead); setAssignBroker(lead.broker_id); }} title="Atribuir Corretor"><UserPlus className="h-4 w-4" /></Button>
                    {lead.status !== 'converted' && (
                      <Button variant="ghost" size="icon" onClick={() => convertToDeal(lead)} title="Converter em Deal" className="text-success hover:text-success">
                        <ArrowRightCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center p-8 text-muted-foreground">Nenhum lead encontrado.</div>
        )}
      </div>

      {/* Lead Form Modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLead ? 'Editar Lead' : 'Novo Lead'}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Nome *</label>
              <Input value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Email</label>
              <Input type="email" value={formData.email} onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Telefone</label>
              <Input value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">WhatsApp</label>
              <Input value={formData.whatsapp} onChange={e => setFormData(p => ({ ...p, whatsapp: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Origem</label>
              <Select value={formData.source} onValueChange={v => setFormData(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockSources.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Corretor</label>
              <Select value={formData.broker_id} onValueChange={v => setFormData(p => ({ ...p, broker_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Status</label>
              <Select value={formData.status} onValueChange={v => setFormData(p => ({ ...p, status: v as LeadStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm text-muted-foreground mb-1 block">Observações</label>
              <Textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveLead} disabled={!formData.name}>{editingLead ? 'Salvar' : 'Criar Lead'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Broker Modal */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => !o && setAssignOpen(null)}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-primary" /> Atribuir Corretor</DialogTitle>
          </DialogHeader>
          {assignOpen && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Lead: <span className="text-foreground font-medium">{assignOpen.name}</span></p>
              <Select value={assignBroker} onValueChange={setAssignBroker}>
                <SelectTrigger><SelectValue placeholder="Selecione o corretor" /></SelectTrigger>
                <SelectContent>
                  {mockBrokers.filter(b => b.active).map(b => <SelectItem key={b.id} value={b.id}>{b.name} — Time {b.team}</SelectItem>)}
                </SelectContent>
              </Select>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline" size="sm">Cancelar</Button></DialogClose>
                <Button size="sm" onClick={doAssign} disabled={!assignBroker}>Atribuir</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CSV Import Modal */}
      <Dialog open={csvOpen} onOpenChange={setCsvOpen}>
        <DialogContent className="glass-strong max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-success" /> Importar Leads via CSV</DialogTitle>
          </DialogHeader>
          {csvPreview.length > 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Preview dos dados ({csvPreview.length - 1} linhas):</p>
              <div className="overflow-x-auto max-h-60 border border-border/50 rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/50 border-b border-border/50">
                      {csvPreview[0]?.map((h, i) => <th key={i} className="p-2 text-left font-medium text-muted-foreground">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.slice(1).map((row, ri) => (
                      <tr key={ri} className="border-b border-border/20">
                        {row.map((cell, ci) => <td key={ci} className="p-2">{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">Colunas esperadas: Nome, Telefone, Email, Origem (flexível)</p>
              <DialogFooter>
                <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
                <Button onClick={importCSV}><CheckCircle className="h-4 w-4 mr-2" /> Importar {csvPreview.length - 1} Leads</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
