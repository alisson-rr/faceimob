import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mockDeals } from "@/data/mockData";
import { DEAL_STAGES, type PipelineDeal, type DealStage } from "@/types/crm";
import { Plus, Download, Search, Filter, Calendar } from "lucide-react";

const stageBadgeColor: Record<DealStage, string> = {
  lead: 'bg-muted text-muted-foreground',
  proposal: 'bg-primary/20 text-primary',
  visit_scheduled: 'bg-warning/20 text-warning',
  approved: 'bg-success/20 text-success',
  contract: 'bg-purple-500/20 text-purple-400',
  closed: 'bg-muted text-muted-foreground',
};

export default function Pipeline() {
  const [deals, setDeals] = useState<PipelineDeal[]>(mockDeals);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");

  const filtered = deals.filter(d => {
    const matchSearch = d.client.toLowerCase().includes(search.toLowerCase()) ||
      d.project.toLowerCase().includes(search.toLowerCase());
    const matchStage = stageFilter === 'all' || d.stage === stageFilter;
    return matchSearch && matchStage;
  });

  const toggleActive = (id: string) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, active: !d.active } : d));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pipeline de Vendas</h1>
          <p className="text-muted-foreground">{filtered.length} negócios encontrados</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" /> Exportar
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" /> Novo Deal
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="glass">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar cliente ou projeto..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Etapa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as etapas</SelectItem>
                {DEAL_STAGES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left p-4 font-medium">Cliente</th>
                <th className="text-left p-4 font-medium">Etapa</th>
                <th className="text-left p-4 font-medium">Incorporadora</th>
                <th className="text-left p-4 font-medium">Empreendimento</th>
                <th className="text-left p-4 font-medium">Unidade</th>
                <th className="text-left p-4 font-medium">Dias</th>
                <th className="text-left p-4 font-medium">Visita</th>
                <th className="text-left p-4 font-medium">Corretor 1</th>
                <th className="text-left p-4 font-medium">Gerente</th>
                <th className="text-left p-4 font-medium">Valor</th>
                <th className="text-left p-4 font-medium">Ativo</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((deal) => (
                <tr key={deal.id} className={`border-b border-border/30 hover:bg-secondary/50 transition-colors ${!deal.active ? 'opacity-50' : ''}`}>
                  <td className="p-4 font-medium">{deal.client}</td>
                  <td className="p-4">
                    <Badge className={stageBadgeColor[deal.stage]}>
                      {DEAL_STAGES.find(s => s.value === deal.stage)?.label}
                    </Badge>
                  </td>
                  <td className="p-4 text-muted-foreground">{deal.developer}</td>
                  <td className="p-4">{deal.project}</td>
                  <td className="p-4">{deal.unit}</td>
                  <td className="p-4 text-muted-foreground">{deal.days_in_pipeline}d</td>
                  <td className="p-4">
                    {deal.visit_date ? (
                      <span className="flex items-center gap-1 text-warning text-xs">
                        <Calendar className="h-3 w-3" /> {deal.visit_date}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="p-4">{deal.broker1}</td>
                  <td className="p-4 text-muted-foreground">{deal.manager1}</td>
                  <td className="p-4 font-medium">R$ {(deal.deal_value / 1000).toFixed(0)}k</td>
                  <td className="p-4">
                    <Switch checked={deal.active} onCheckedChange={() => toggleActive(deal.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
