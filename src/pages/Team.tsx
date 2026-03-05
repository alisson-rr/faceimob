import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockBrokers as initialBrokers, mockManagers as initialManagers, mockTeams } from "@/data/mockData";
import type { Broker, Manager } from "@/types/crm";
import { Plus, Pencil, Users, TrendingUp, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

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

  const toggleBroker = (id: string) => {
    setBrokers(prev => prev.map(b => b.id === id ? { ...b, active: !b.active } : b));
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

  const toggleManager = (id: string) => {
    setManagers(prev => prev.map(m => m.id === id ? { ...m, active: !m.active } : m));
  };

  // Metrics
  const activeBrokers = brokers.filter(b => b.active).length;
  const totalVGV = brokers.reduce((a, b) => a + b.monthly_vgv, 0);
  const totalSales = brokers.reduce((a, b) => a + b.monthly_sales, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Equipe</h1>
        <p className="text-muted-foreground">Gerenciamento de corretores e gerentes</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-primary" /><span className="text-xs text-muted-foreground">Corretores Ativos</span></div>
            <p className="text-2xl font-bold text-primary">{activeBrokers}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-success" /><span className="text-xs text-muted-foreground">Gerentes</span></div>
            <p className="text-2xl font-bold text-success">{managers.filter(m => m.active).length}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><TrendingUp className="h-4 w-4 text-warning" /><span className="text-xs text-muted-foreground">Vendas/Mês</span></div>
            <p className="text-2xl font-bold">{totalSales}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1"><DollarSign className="h-4 w-4 text-success" /><span className="text-xs text-muted-foreground">VGV Total</span></div>
            <p className="text-2xl font-bold">R$ {(totalVGV / 1000000).toFixed(1)}M</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="brokers">
        <TabsList className="glass">
          <TabsTrigger value="brokers">Corretores ({brokers.length})</TabsTrigger>
          <TabsTrigger value="managers">Gerentes ({managers.length})</TabsTrigger>
        </TabsList>

        {/* BROKERS */}
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
                      <td className="p-3 text-center"><Switch checked={b.active} onCheckedChange={() => toggleBroker(b.id)} /></td>
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

        {/* MANAGERS */}
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
                      <td className="p-3 text-center"><Switch checked={m.active} onCheckedChange={() => toggleManager(m.id)} /></td>
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
