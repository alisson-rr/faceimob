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
import { mockManagers as initialManagers, mockTeams as initialTeams, mockDeals, mockLeads } from "@/data/mockData";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useCallback } from "react";
import type { Broker, Manager, PipelineDeal } from "@/types/crm";
import { Plus, Pencil, Users, ChevronDown, Crown, Medal, X, Shield, UserCog, Briefcase, Star, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { format, parseISO, differenceInDays } from 'date-fns';

// ── Types for new entities ──
interface TeamEntity { id: string; name: string; }
interface PersonEntity { id: string; name: string; team: string; active: boolean; }

// ── Team stats helpers ──
function getTeamStats(teamName: string, brokers: Broker[], allDeals: PipelineDeal[]) {
  const teamBrokerNames = brokers.filter(b => b.team === teamName).map(b => b.name);
  const teamDeals = allDeals.filter(d => teamBrokerNames.includes(d.broker1));
  const teamLeadsList = mockLeads.filter(l => teamBrokerNames.includes(l.broker_name || ""));
  const leads = teamLeadsList.length;
  const propostas = teamDeals.filter(d => d.stage === "proposal").length;
  const negocios = teamDeals.filter(d => d.active).length;
  const vendas = teamDeals.filter(d => d.stage === "closed").length;
  const conversao = leads > 0 ? ((vendas / leads) * 100).toFixed(0) : "0";
  return { leads, propostas, negocios, vendas, conversao };
}

function getBrokerRanking(teamName: string, brokers: Broker[], allDeals: PipelineDeal[]) {
  return brokers
    .filter(b => b.team === teamName && b.active)
    .map(b => {
      const brokerDeals = allDeals.filter(d => d.broker1 === b.name);
      const vendas = brokerDeals.filter(d => d.stage === "closed").length;
      const vgv = brokerDeals.reduce((s, d) => s + (d.deal_value || 0), 0);
      return { ...b, vendas, vgv };
    })
    .sort((a, b) => b.vendas - a.vendas || b.vgv - a.vgv);
}

const MedalIcon = ({ pos }: { pos: number }) => {
  if (pos === 0) return <Crown className="h-4 w-4 text-yellow-400" />;
  if (pos === 1) return <Medal className="h-4 w-4 text-gray-300" />;
  if (pos === 2) return <Medal className="h-4 w-4 text-amber-600" />;
  return <span className="text-xs text-muted-foreground font-mono">{pos + 1}</span>;
};

// ── Reusable Person List Component ──
function PersonList({ items, onAdd, onEdit, onToggle, icon: Icon, color }: {
  items: PersonEntity[];
  onAdd: () => void;
  onEdit: (p: PersonEntity) => void;
  onToggle: (id: string) => void;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}><Plus className="h-4 w-4 mr-2" /> Adicionar</Button>
      </div>
      <Card className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/30 text-muted-foreground text-xs">
                <th className="text-left p-3 font-medium">Nome</th>
                <th className="text-left p-3 font-medium">Time</th>
                <th className="text-center p-3 font-medium">Ativo</th>
                <th className="text-center p-3 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} className={cn("border-b border-border/20 hover:bg-secondary/30 transition-colors", !p.active && "opacity-40")}>
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold", color)}>
                        {p.name.charAt(0)}
                      </div>
                      <span className="font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{p.team || "—"}</td>
                  <td className="p-3 text-center"><Switch checked={p.active} onCheckedChange={() => onToggle(p.id)} /></td>
                  <td className="p-3 text-center">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(p)}><Pencil className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground text-sm">Nenhum cadastro encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function Team() {
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [managersFromDb, setManagersFromDb] = useState<Manager[]>([]);
  const [directorsFromDb, setDirectorsFromDb] = useState<PersonEntity[]>([]);
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRealData = useCallback(async () => {
    setLoading(true);
    try {
      const [brokersRes, dealsRes] = await Promise.all([
        supabase.from('brokers').select('*').order('name'),
        supabase.from('deals').select(`
          *,
          broker1:brokers!deals_broker1_id_fkey(name),
          broker2:brokers!deals_broker2_id_fkey(name),
          manager1:brokers!deals_manager1_id_fkey(name),
          manager2:brokers!deals_manager2_id_fkey(name)
        `)
      ]);

      if (brokersRes.error) throw brokersRes.error;
      if (dealsRes.error) throw dealsRes.error;

      const all = brokersRes.data || [];
      const managerById = new Map(all.map((b: any) => [b.id, b.name]));

      const mappedBrokers: Broker[] = all
        .filter((b: any) => (b.role || 'broker') === 'broker')
        .map((b: any) => ({
          id: b.id,
          name: b.name,
          active: b.active !== false,
          monthly_sales: 0,
          monthly_vgv: 0,
          team: managerById.get(b.manager_id) || 'Sem time',
        }));

      const mappedManagers: Manager[] = all
        .filter((b: any) => b.role === 'manager')
        .map((b: any) => ({
          id: b.id,
          name: b.name,
          team: b.name,
          active: b.active !== false,
        } as Manager));

      const mappedDirectors: PersonEntity[] = all
        .filter((b: any) => b.role === 'director')
        .map((b: any) => ({
          id: b.id,
          name: b.name,
          team: '',
          active: b.active !== false,
        }));

      const mappedDeals: PipelineDeal[] = (dealsRes.data || []).map(d => ({
        ...d,
        broker1: (d.broker1 as any)?.name || '',
        broker2: (d.broker2 as any)?.name || undefined,
        manager1: (d.manager1 as any)?.name || '',
        manager2: (d.manager2 as any)?.name || undefined,
        days_in_pipeline: differenceInDays(new Date(), parseISO(d.created_at || new Date().toISOString())),
      })) as any[];

      setBrokers(mappedBrokers);
      setManagersFromDb(mappedManagers);
      setDirectorsFromDb(mappedDirectors);
      setDeals(mappedDeals);
    } catch (error) {
      console.error('Error fetching team data:', error);
      toast({ title: "Erro ao carregar dados", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);


  useEffect(() => {
    fetchRealData();
  }, [fetchRealData]);

  const ARCHIMEDES_TEAMS = ['Archimedes', 'Susana', 'José Portilho', 'Alexandre'];
  const FABIO_TEAMS = ['Zona Sul', 'Victor', 'Verônica', 'Daiane'];
  const MAURICIO_TEAMS = ['Mauricio', 'Leonardo', 'Alisson'];
  const ALL_TEAMS = [...ARCHIMEDES_TEAMS, ...FABIO_TEAMS, ...MAURICIO_TEAMS];

  const [managers, setManagers] = useState<Manager[]>([]);
  const [teams, setTeams] = useState<TeamEntity[]>(
    ALL_TEAMS.map((t, i) => ({ id: String(i), name: t }))
  );
  const [directors, setDirectors] = useState<PersonEntity[]>([]);

  useEffect(() => { setManagers(managersFromDb); }, [managersFromDb]);
  useEffect(() => { setDirectors(directorsFromDb); }, [directorsFromDb]);

  const [ccaUsers, setCcaUsers] = useState<PersonEntity[]>([]);
  const [partners, setPartners] = useState<PersonEntity[]>([]);
  const [admins, setAdmins] = useState<PersonEntity[]>([]);

  // ── Team form ──
  const [teamFormOpen, setTeamFormOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamEntity | null>(null);
  const [teamName, setTeamName] = useState("");

  // ── Broker form ──
  const [brokerFormOpen, setBrokerFormOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [brokerForm, setBrokerForm] = useState({ name: '', team: '', active: true, monthly_sales: 0, monthly_vgv: 0 });

  // ── Manager form ──
  const [managerFormOpen, setManagerFormOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<Manager | null>(null);
  const [managerForm, setManagerForm] = useState({ name: '', team: '', active: true });

  // ── Generic person form (for directors, cca, partners, admin) ──
  const [personFormOpen, setPersonFormOpen] = useState(false);
  const [personFormType, setPersonFormType] = useState<"director" | "cca" | "partner" | "admin">("director");
  const [editingPerson, setEditingPerson] = useState<PersonEntity | null>(null);
  const [personForm, setPersonForm] = useState({ name: '', team: '', active: true });

  const teamNames = useMemo(() => teams.map(t => t.name), [teams]);

  // ── Team CRUD ──
  const openNewTeam = () => { setEditingTeam(null); setTeamName(""); setTeamFormOpen(true); };
  const openEditTeam = (t: TeamEntity) => { setEditingTeam(t); setTeamName(t.name); setTeamFormOpen(true); };
  const saveTeam = () => {
    if (!teamName.trim()) return;
    if (editingTeam) {
      setTeams(prev => prev.map(t => t.id === editingTeam.id ? { ...t, name: teamName.trim() } : t));
    } else {
      setTeams(prev => [...prev, { id: String(Date.now()), name: teamName.trim() }]);
    }
    setTeamFormOpen(false);
    toast({ title: editingTeam ? "Equipe atualizada" : "Equipe criada" });
  };
  const removeTeam = (id: string) => {
    setTeams(prev => prev.filter(t => t.id !== id));
    toast({ title: "Equipe removida" });
  };

  // ── Broker CRUD ──
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

  // ── Manager CRUD ──
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

  // ── Generic person CRUD ──
  const getPersonSetter = (type: string) => {
    switch (type) {
      case "director": return setDirectors;
      case "cca": return setCcaUsers;
      case "partner": return setPartners;
      case "admin": return setAdmins;
      default: return setDirectors;
    }
  };
  const getPersonList = (type: string) => {
    switch (type) {
      case "director": return directors;
      case "cca": return ccaUsers;
      case "partner": return partners;
      case "admin": return admins;
      default: return directors;
    }
  };
  const personTypeLabel: Record<string, string> = {
    director: "Diretor",
    cca: "CCA",
    partner: "Sócio",
    admin: "Administrador",
  };

  const openNewPerson = (type: "director" | "cca" | "partner" | "admin") => {
    setPersonFormType(type);
    setEditingPerson(null);
    setPersonForm({ name: '', team: '', active: true });
    setPersonFormOpen(true);
  };
  const openEditPerson = (p: PersonEntity, type: "director" | "cca" | "partner" | "admin") => {
    setPersonFormType(type);
    setEditingPerson(p);
    setPersonForm(p);
    setPersonFormOpen(true);
  };
  const savePerson = () => {
    const setter = getPersonSetter(personFormType);
    if (editingPerson) {
      setter(prev => prev.map(p => p.id === editingPerson.id ? { ...p, ...personForm } : p));
    } else {
      setter(prev => [...prev, { ...personForm, id: String(Date.now()) }]);
    }
    setPersonFormOpen(false);
    toast({ title: editingPerson ? `${personTypeLabel[personFormType]} atualizado` : `${personTypeLabel[personFormType]} adicionado` });
  };
  const togglePerson = (id: string, type: string) => {
    const setter = getPersonSetter(type);
    setter(prev => prev.map(p => p.id === id ? { ...p, active: !p.active } : p));
  };

  const uniqueTeams = useMemo(() => teamNames, [teamNames]);
  const teamComparison = useMemo(() =>
    uniqueTeams.map(t => ({ name: t, ...getTeamStats(t, brokers, deals) })),
    [uniqueTeams, brokers, deals]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Equipes</h1>
        <p className="text-muted-foreground">Gestão de equipes e pessoal</p>
        {loading && (
          <div className="flex items-center mt-2 text-primary">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-sm">Carregando dados do banco...</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="teams">
        <TabsList className="glass flex-wrap">
          <TabsTrigger value="teams">Equipes</TabsTrigger>
          <TabsTrigger value="brokers">Corretores ({brokers.length})</TabsTrigger>
          <TabsTrigger value="managers">Gerentes ({managers.length})</TabsTrigger>
          <TabsTrigger value="directors">Diretores ({directors.length})</TabsTrigger>
          <TabsTrigger value="cca">CCA ({ccaUsers.length})</TabsTrigger>
          <TabsTrigger value="partners">Sócios ({partners.length})</TabsTrigger>
          <TabsTrigger value="admins">ADM ({admins.length})</TabsTrigger>
        </TabsList>

        {/* ═══ EQUIPES TAB ═══ */}
        <TabsContent value="teams" className="mt-4 space-y-6">
          <div className="flex justify-end">
            <Button size="sm" onClick={openNewTeam}><Plus className="h-4 w-4 mr-2" /> Nova Equipe</Button>
          </div>

          {/* Team cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {teams.map(team => {
              const stats = getTeamStats(team.name, brokers, deals);
              const ranking = getBrokerRanking(team.name, brokers, deals);
              return (
                <Collapsible key={team.id}>
                  <Card className="glass border-primary/30 hover:border-primary/60 transition-colors">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold">{team.name}</h3>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground font-semibold">{stats.conversao}%</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditTeam(team)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeTeam(team.id)}><X className="h-3 w-3" /></Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        {[
                          { label: "Leads", value: stats.leads },
                          { label: "Propostas", value: stats.propostas },
                          { label: "Negócios", value: stats.negocios },
                          { label: "Vendas", value: stats.vendas },
                        ].map(m => (
                          <div key={m.label} className="p-3 rounded-lg bg-secondary/60">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{m.label}</p>
                            <p className="text-xl font-bold">{m.value}</p>
                          </div>
                        ))}
                      </div>
                      <CollapsibleTrigger className="w-full">
                        <div className="flex items-center justify-between p-2 rounded-lg border border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer">
                          <span className="text-sm text-muted-foreground">Corretores ({ranking.length})</span>
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-3">
                        <div className="space-y-2">
                          {ranking.map((b, i) => (
                            <div key={b.id} className={cn("flex items-center justify-between p-2 rounded-lg", i < 3 ? "bg-warning/5" : "bg-secondary/30")}>
                              <div className="flex items-center gap-2">
                                <MedalIcon pos={i} />
                                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold">{b.name.charAt(0)}</div>
                                <span className="text-sm font-medium">{b.name}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span>{b.vendas} vendas</span>
                                <span>R$ {(b.vgv / 1000).toFixed(0)}k</span>
                              </div>
                            </div>
                          ))}
                          {ranking.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Nenhum corretor ativo</p>}
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
            <CardHeader><CardTitle className="text-base font-semibold">Comparação entre Equipes</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipe</TableHead><TableHead>Leads</TableHead><TableHead>Propostas</TableHead><TableHead>Negócios</TableHead><TableHead>Vendas</TableHead><TableHead>Conversão</TableHead>
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
                      <td className="p-3 text-center"><Button variant="ghost" size="icon" onClick={() => openEditBroker(b)}><Pencil className="h-4 w-4" /></Button></td>
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
                      <td className="p-3 text-center"><Button variant="ghost" size="icon" onClick={() => openEditManager(m)}><Pencil className="h-4 w-4" /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ═══ DIRECTORS TAB ═══ */}
        <TabsContent value="directors" className="mt-4">
          <PersonList
            items={directors}
            onAdd={() => openNewPerson("director")}
            onEdit={(p) => openEditPerson(p, "director")}
            onToggle={(id) => togglePerson(id, "director")}
            icon={UserCog}
            color="bg-cyan-500/20 text-cyan-400"
          />
        </TabsContent>

        {/* ═══ CCA TAB ═══ */}
        <TabsContent value="cca" className="mt-4">
          <PersonList
            items={ccaUsers}
            onAdd={() => openNewPerson("cca")}
            onEdit={(p) => openEditPerson(p, "cca")}
            onToggle={(id) => togglePerson(id, "cca")}
            icon={Shield}
            color="bg-warning/20 text-warning"
          />
        </TabsContent>

        {/* ═══ PARTNERS TAB ═══ */}
        <TabsContent value="partners" className="mt-4">
          <PersonList
            items={partners}
            onAdd={() => openNewPerson("partner")}
            onEdit={(p) => openEditPerson(p, "partner")}
            onToggle={(id) => togglePerson(id, "partner")}
            icon={Star}
            color="bg-purple-500/20 text-purple-400"
          />
        </TabsContent>

        {/* ═══ ADMINS TAB ═══ */}
        <TabsContent value="admins" className="mt-4">
          <PersonList
            items={admins}
            onAdd={() => openNewPerson("admin")}
            onEdit={(p) => openEditPerson(p, "admin")}
            onToggle={(id) => togglePerson(id, "admin")}
            icon={Briefcase}
            color="bg-destructive/20 text-destructive"
          />
        </TabsContent>
      </Tabs>

      {/* ═══ TEAM FORM ═══ */}
      <Dialog open={teamFormOpen} onOpenChange={setTeamFormOpen}>
        <DialogContent className="glass-strong max-w-sm">
          <DialogHeader><DialogTitle>{editingTeam ? 'Editar Equipe' : 'Nova Equipe'}</DialogTitle></DialogHeader>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Nome da Equipe *</label>
            <Input value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="Ex: Alpha, Beta..." />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveTeam} disabled={!teamName.trim()}>{editingTeam ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ BROKER FORM ═══ */}
      <Dialog open={brokerFormOpen} onOpenChange={setBrokerFormOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader><DialogTitle>{editingBroker ? 'Editar Corretor' : 'Novo Corretor'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label>
              <Input value={brokerForm.name} onChange={e => setBrokerForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Time</label>
              <Select value={brokerForm.team} onValueChange={v => setBrokerForm(p => ({ ...p, team: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{teamNames.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
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

      {/* ═══ MANAGER FORM ═══ */}
      <Dialog open={managerFormOpen} onOpenChange={setManagerFormOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader><DialogTitle>{editingManager ? 'Editar Gerente' : 'Novo Gerente'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label>
              <Input value={managerForm.name} onChange={e => setManagerForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Time</label>
              <Select value={managerForm.team} onValueChange={v => setManagerForm(p => ({ ...p, team: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{teamNames.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={saveManager} disabled={!managerForm.name}>{editingManager ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ GENERIC PERSON FORM (Director/CCA/Partner/Admin) ═══ */}
      <Dialog open={personFormOpen} onOpenChange={setPersonFormOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader><DialogTitle>{editingPerson ? `Editar ${personTypeLabel[personFormType]}` : `Novo ${personTypeLabel[personFormType]}`}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><label className="text-sm text-muted-foreground mb-1 block">Nome *</label>
              <Input value={personForm.name} onChange={e => setPersonForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="text-sm text-muted-foreground mb-1 block">Time (opcional)</label>
              <Select value={personForm.team || "none"} onValueChange={v => setPersonForm(p => ({ ...p, team: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {teamNames.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select></div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose>
            <Button onClick={savePerson} disabled={!personForm.name}>{editingPerson ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
