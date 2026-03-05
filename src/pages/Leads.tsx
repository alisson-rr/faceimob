import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { mockLeads } from "@/data/mockData";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/types/crm";
import { Plus, Upload, Search, Phone, Mail, MessageCircle } from "lucide-react";

const statusColor: Record<LeadStatus, string> = {
  new: 'bg-primary/20 text-primary',
  contacted: 'bg-warning/20 text-warning',
  qualified: 'bg-success/20 text-success',
  converted: 'bg-purple-500/20 text-purple-400',
  lost: 'bg-destructive/20 text-destructive',
};

export default function Leads() {
  const [leads] = useState<Lead[]>(mockLeads);
  const [search, setSearch] = useState("");

  const filtered = leads.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground">{filtered.length} leads</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" /> Novo Lead
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar lead..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="grid gap-3">
        {filtered.map((lead) => (
          <Card key={lead.id} className="glass hover:bg-secondary/50 transition-colors">
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
                <div className="text-right text-sm">
                  <p className="text-muted-foreground">Origem: {lead.source}</p>
                  <p className="text-muted-foreground">Corretor: {lead.broker_name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{lead.created_at}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
