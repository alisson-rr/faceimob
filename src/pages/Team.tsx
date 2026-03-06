import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { mockBrokers as initialBrokers, mockManagers as initialManagers, mockTeams, mockDeals, mockLeads } from "@/data/mockData";
import type { Broker, Manager } from "@/types/crm";
import { Plus, Pencil, Users, TrendingUp, DollarSign, ChevronDown, Crown, Medal } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// Compute team stats from deals/leads
function getTeamStats(teamName: string, brokers: Broker[]) {
  const teamBrokerNames = brokers.filter(b => b.team === teamName).map(b => b.name);
  const teamDeals = mockDeals.filter(d => teamBrokerNames.includes(d.broker1));
  const teamLeads = mockLeads.filter(l => teamBrokerNames.includes(l.broker_name || ""));

  const leads = teamLeads.length;
  const propostas = teamDeals.filter(d => d.stage === "proposal").length;
  const negocios = teamDeals.filter(d => d.active).length;
  const vendas = teamDeals.filter(d => d.stage === "closed").length;
  const conversao = leads > 0 ? ((vendas / leads) * 100).toFixed(0) : "0";

  return { leads, propostas, negocios, vendas, conversao };
}

function getBrokerRanking(teamName: string, brokers: Broker[]) {
  return brokers
    .filter(b => b.team === teamName && b.active)
    .map(b => {
      const brokerDeals = mockDeals.filter(d => d.broker1 === b.name);
      const vendas = brokerDeals.filter(d => d.stage === "closed").length;
      const negocios = brokerDeals.filter(d => d.active).length;
      const vgv = brokerDeals.reduce((s, d) => s + d.deal_value, 0);
      return { ...b, vendas, negocios, vgv };
    })
    .sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
}

const MedalIcon = ({ pos }: { pos: number }) => {
  if (pos === 0) return <Crown className="h-4 w-4 text-yellow-400" />;
  if (pos === 1) return <Medal className="h-4 w-4 text-gray-300" />;
  if (pos === 2) return <Medal className="h-4 w-4 text-amber-600" />;
  return <span className="text-xs text-muted-foreground font-mono">{pos + 1}</span>;
};

export default function Team() {
  const [brokers, setBrokers] = useState<Broker[]>(initialBrokers);
  const [managers, setManagers] = useState<Manager[]>(initialManagers);

  // Broker form
  const [brokerFormOpen, setBrokerFormOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [brokerForm, setBrokerForm] = useState({ name: '', team: '', active: true, monthly_sales: 0, monthly_vgv: 0 });

  // Manager form
  const [managerFormOpen, setManagerFormOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<Manager | null>(null);
  const [managerForm, setManagerForm] = useState({ name: '', team: '', active: true });

  const openNewBroker = () => { setEditingBroker(null); setBrokerForm({ name: '', team: '', active: true, monthly_sales: 0, monthly_vgv: 0 }); setBrokerFormOpen(true); };
  const openEditBroker = (b: Broker) => { setEditingBroker(b); setBrokerForm(b); setBrokerFormOpen(true); };

  const saveBroker = () => {
    if (editingBroker) {
      setBrokers(prev => prev.map(b => b.id === editingBroker.id ? { ...b, ...brokerForm } : b));
    } else {
      setBrokers(prev => [...prev, { ...brokerForm, id: String(Date.now()) }]);
    }
    setBrokerFormOpen(false);
    toast({ title: editingBroker ? "Corretor atualizado" : "Corretor adicionado" });
  };

  const openNewManager = () => { setEditingManager(null); setManagerForm({ name: '', team: '', active: true }); setManagerFormOpen(true); };
  const openEditManager = (m: Manager) => { setEditingManager(m); setManagerForm(m); setManagerFormOpen(true); };

  const saveManager = () => {
    if (editingManager) {
      setManagers(prev => prev.map(m => m.id === editingManager.id ? { ...m, ...managerForm } : m));
    } else {
      setManagers(prev => [...prev, { ...managerForm, id: String(Date.now()) }]);
    }
    setManagerFormOpen(false);
    toast({ title: editingManager ? "Gerente atualizado" : "Gerente adicionado" });
  };

  const uniqueTeams = useMemo(() => [...new Set(brokers.map(b => b.team))], [brokers]);

  const teamComparison = useMemo(() =>
    uniqueTeams.map(t => ({ name: t, ...getTeamStats(t, brokers) })),
    [uniqueTeams, brokers]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Equipes</h1>
        <p className="text-muted-foreground">Desempenho por equipe</p>
      </div>

      <Tabs defaultValue="teams">
        <TabsList className="glass">
          <TabsTrigger value="teams">Equipes</TabsTrigger>
          <TabsTrigger value="brokers">Corretores ({brokers.length})</TabsTrigger>
          <TabsTrigger value="managers">Gerentes ({managers.length})</TabsTrigger>
        </TabsList>

        {/* ═══ EQUIPES TAB ═══ */}
        <TabsContent value="teams" className="mt-4 space-y-6">
          {/* Team cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {uniqueTeams.map(teamName => {
              const stats = getTeamStats(teamName, brokers);
              const ranking = getBrokerRanking(teamName, brokers);

              return (
                <Collapsible key={teamName}>
                  <Card className="glass border-primary/30 hover:border-primary/60 transition-colors">
                    <CardContent className="p-5">
                      {/* Team header */}
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold">{teamName}</h3>
                        <span className="text-sm text-muted-foreground font-semibold">{stats.conversao}%</span>
                      </div>

                      {/* Metrics grid */}
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="p-3 rounded-lg bg-secondary/60">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Leads</p>
                          <p className="text-xl font-bold">{stats.leads}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/60">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Propostas</p>
                          <p className="text-xl font-bold">{stats.propostas}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/60">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Negócios</p>
                          <p className="text-xl font-bold">{stats.negocios}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/60">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vendas</p>
                          <p className="text-xl font-bold">{stats.vendas}</p>
                        </div>
                      </div>

                      {/* Expandable broker ranking */}
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between p-2 rounded-lg border border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer">
                          <span className="text-sm text-muted-foreground">Corretores ({ranking.length})</span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent className="mt-3">
                        <div className="space-y-2">
                          {ranking.map((b, i) => (
                            <div key={b.id} className={cn(
                              "flex items-center justify-between p-2 rounded-lg transition-colors",
                              i < 3 ? "bg-warning/5" : "bg-secondary/30"
                            )}>
                              <div className="flex items-center gap-2">
                                <MedalIcon pos={i} />
                                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold">
                                  {b.name.charAt(0)}
                                </div>
                                <span className="text-sm font-medium">{b.name}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>{b.vendas} vendas</span>
                                <span>R$ {(b.vgv / 1000).toFixed(0)}k</span>
                              </div>
                            </div>
                          ))}
                          {ranking.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-2">Nenhum corretor ativo</p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </CardContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>

          {/* Comparison table */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Comparação entre Equipes</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipe</TableHead>
                    <TableHead>Leads</TableHead>
                    <TableHead>Propostas</TableHead>
                    <TableHead>Negócios</TableHead>
                    <TableHead>Vendas</TableHead>
                    <TableHead>Conversão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamComparison.map(t => (
                    <TableRow key={t.name}>
                      <TableCell className="font-semibold">{t.name}</TableCell>
                      <TableCell className="font-bold">{t.leads}</TableCell>
                      <TableCell className="font-bold">{t.propostas}</TableCell>
                      <TableCell className="font-bold">{t.negocios}</TableCell>
                      <TableCell className="font-bold">{t.vendas}</TableCell>
                      <TableCell className="font-bold">{t.conversao}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ BROKERS TAB ═══ */}
        <TabsContent value="brokers" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={openNewBroker}><Plus className="h-4 w-4 mr-2" /> Novo Corretor</Button>
          </div>
          <Card className="glass overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-secondary/30 text-muted-foreground text-xs">
                    <th className="text-left p-3 font-medium">Corretor</th>
                    <th className="text-left p-3 font-medium">Time</th>
                    <th className="text-right p-3 font-medium">Vendas/Mês</th>
                    <th className="text-right p-3 font-medium">VGV</th>
                    <th className="text-center p-3 font-medium">Ativo</th>
                    <th className="text-center p-3 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {brokers.map(b => (
                    <tr key={b.id} className={cn("border-b border-border/20 hover:bg-secondary/30 transition-colors", !b.active && "opacity-40")}>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">{b.name.charAt(0)}</div>
                          <span className="font-medium">{b.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{b.team}</td>
                      <td className="p-3 text-right font-semibold">{b.monthly_sales}</td>
                      <td className="p-3 text-right text-muted-foreground">R$ {(b.monthly_vgv / 1000000).toFixed(2)}M</td>
                      <td className="p-3 text-center"><Switch checked={b.active} onCheckedChange={() => setBrokers(prev => prev.map(x => x.id === b.id ? { ...x, active: !x.active } : x))} /></td>
                      <td className="p-3 text-center">
                        <Button variant="ghost" size="icon" onClick={() => openEditBroker(b)}><Pencil className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ═══ MANAGERS TAB ═══ */}
        <TabsContent value="managers" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button size="sm" onClick={openNewManager}><Plus className="h-4 w-4 mr-2" /> Novo Gerente</Button>
          </div>
          <Card className="glass overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-secondary/30 text-muted-foreground text-xs">
                    <th className="text-left p-3 font-medium">Gerente</th>
                    <th className="text-left p-3 font-medium">Time</th>
                    <th className="text-center p-3 font-medium">Ativo</th>
                    <th className="text-center p-3 font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {managers.map(m => (
                    <tr key={m.id} className={cn("border-b border-border/20 hover:bg-secondary/30 transition-colors", !m.active && "opacity-40")}>
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center text-success text-sm font-semibold">{m.name.charAt(0)}</div>
                          <span className="font-medium">{m.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{m.team}</td>
                      <td className="p-3 text-center"><Switch checked={m.active} onCheckedChange={() => setManagers(prev => prev.map(x => x.id === m.id ? { ...x, active: !x.active } : x))} /></td>
                      <td className="p-3 text-center">
                        <Button variant="ghost" size="icon" onClick={() => openEditManager(m)}><Pencil className="h-4 w-4" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Broker Form */}
      <Dialog open={brokerFormOpen} onOpenChange={setBrokerFormOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader><DialogTitle>{editingBroker ? 'Editar Corretor' : 'Novo Corretor'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label>
              <Input value={brokerForm.name} onChange={e => setBrokerForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Time</label>
              <Select value={brokerForm.team} onValueChange={v => setBrokerForm(p => ({ ...p, team: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{mockTeams.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-muted-foreground mb-1 block">Vendas/Mês</label>
                <Input type="number" value={brokerForm.monthly_sales} onChange={e => setBrokerForm(p => ({ ...p, monthly_sales: Number(e.target.value) }))} /></div>
              <div><label className="text-sm text-muted-foreground mb-1 block">VGV Mensal</label>
                <Input type="number" value={brokerForm.monthly_vgv} onChange={e => setBrokerForm(p => ({ ...p, monthly_vgv: Number(e.target.value) }))} /></div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveBroker} disabled={!brokerForm.name}>{editingBroker ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manager Form */}
      <Dialog open={managerFormOpen} onOpenChange={setManagerFormOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader><DialogTitle>{editingManager ? 'Editar Gerente' : 'Novo Gerente'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label>
              <Input value={managerForm.name} onChange={e => setManagerForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Time</label>
              <Select value={managerForm.team} onValueChange={v => setManagerForm(p => ({ ...p, team: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{mockTeams.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveManager} disabled={!managerForm.name}>{editingManager ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
