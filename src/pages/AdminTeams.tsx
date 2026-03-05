import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, UserPlus, Building2, ArrowRight, Pencil, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface TeamMember {
  id: string;
  name: string;
  role: 'broker' | 'manager' | 'director';
  team: string;
  managerId?: string;
  directorId?: string;
}

const initialDirectors: TeamMember[] = [
  { id: 'd1', name: 'Roberto Mendes', role: 'director', team: '' },
  { id: 'd2', name: 'Carla Almeida', role: 'director', team: '' },
];

const initialManagers: TeamMember[] = [
  { id: 'm1', name: 'Marcos Oliveira', role: 'manager', team: 'Alpha', directorId: 'd1' },
  { id: 'm2', name: 'Patricia Rocha', role: 'manager', team: 'Beta', directorId: 'd1' },
  { id: 'm3', name: 'Ricardo Santos', role: 'manager', team: 'Gamma', directorId: 'd2' },
];

const initialBrokers: TeamMember[] = [
  { id: 'b1', name: 'Carlos Silva', role: 'broker', team: 'Alpha', managerId: 'm1' },
  { id: 'b2', name: 'Ana Martins', role: 'broker', team: 'Alpha', managerId: 'm1' },
  { id: 'b3', name: 'Roberto Souza', role: 'broker', team: 'Beta', managerId: 'm2' },
  { id: 'b4', name: 'Juliana Costa', role: 'broker', team: 'Beta', managerId: 'm2' },
  { id: 'b5', name: 'Fernando Lima', role: 'broker', team: 'Gamma', managerId: 'm3' },
];

const initialTeams = ['Alpha', 'Beta', 'Gamma'];

export default function AdminTeams() {
  const [directors] = useState(initialDirectors);
  const [managers, setManagers] = useState(initialManagers);
  const [brokers, setBrokers] = useState(initialBrokers);
  const [teams, setTeams] = useState(initialTeams);
  const [newTeam, setNewTeam] = useState("");
  const [assignDialog, setAssignDialog] = useState<{ type: 'broker' | 'manager'; member: TeamMember } | null>(null);
  const [assignTarget, setAssignTarget] = useState("");

  const addTeam = () => {
    if (!newTeam.trim()) return;
    setTeams(prev => [...prev, newTeam.trim()]);
    setNewTeam("");
    toast({ title: "Equipe criada", description: newTeam });
  };

  const removeTeam = (name: string) => {
    setTeams(prev => prev.filter(t => t !== name));
    toast({ title: "Equipe removida" });
  };

  const assignMember = () => {
    if (!assignDialog || !assignTarget) return;
    if (assignDialog.type === 'broker') {
      setBrokers(prev => prev.map(b =>
        b.id === assignDialog.member.id ? { ...b, managerId: assignTarget } : b
      ));
    } else {
      setManagers(prev => prev.map(m =>
        m.id === assignDialog.member.id ? { ...m, directorId: assignTarget } : m
      ));
    }
    toast({ title: "Atribuição atualizada" });
    setAssignDialog(null);
    setAssignTarget("");
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Gestão de Equipes</h1>
        <p className="text-xs text-muted-foreground">Gerencie a estrutura hierárquica: Diretores → Gerentes → Corretores</p>
      </div>

      {/* Teams */}
      <Card className="border-border/50">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" /> Equipes</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex gap-2 mb-3">
            <Input value={newTeam} onChange={e => setNewTeam(e.target.value)} placeholder="Nome da equipe" className="text-xs max-w-48" />
            <Button size="sm" onClick={addTeam}><Plus className="h-3 w-3 mr-1" /> Criar</Button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {teams.map(t => (
              <Badge key={t} variant="outline" className="text-xs flex items-center gap-1">
                {t}
                <button onClick={() => removeTeam(t)} className="ml-1 text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Hierarchy */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Directors */}
        <Card className="border-blue-500/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm text-blue-400">Diretores</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {directors.map(d => (
              <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg border border-border/30 bg-blue-500/5">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">{d.name.charAt(0)}</div>
                <span className="text-xs font-medium flex-1">{d.name}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Managers */}
        <Card className="border-cyan-500/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm text-cyan-400">Gerentes</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {managers.map(m => {
              const dir = directors.find(d => d.id === m.directorId);
              return (
                <div key={m.id} className="p-2 rounded-lg border border-border/30 bg-cyan-500/5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">{m.name.charAt(0)}</div>
                    <div className="flex-1">
                      <span className="text-xs font-medium">{m.name}</span>
                      <p className="text-[10px] text-muted-foreground">Equipe: {m.team}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setAssignDialog({ type: 'manager', member: m }); setAssignTarget(m.directorId || ''); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                  {dir && <p className="text-[9px] text-blue-400 mt-1 ml-10">↑ {dir.name}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Brokers */}
        <Card className="border-emerald-500/30">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm text-emerald-400">Corretores</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {brokers.map(b => {
              const mgr = managers.find(m => m.id === b.managerId);
              return (
                <div key={b.id} className="p-2 rounded-lg border border-border/30 bg-emerald-500/5">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">{b.name.charAt(0)}</div>
                    <div className="flex-1">
                      <span className="text-xs font-medium">{b.name}</span>
                      <p className="text-[10px] text-muted-foreground">Equipe: {b.team}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setAssignDialog({ type: 'broker', member: b }); setAssignTarget(b.managerId || ''); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                  {mgr && <p className="text-[9px] text-cyan-400 mt-1 ml-10">↑ {mgr.name}</p>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Assign Dialog */}
      <Dialog open={!!assignDialog} onOpenChange={() => setAssignDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {assignDialog?.type === 'broker' ? 'Atribuir Gerente' : 'Atribuir Diretor'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs">Membro: <strong>{assignDialog?.member.name}</strong></p>
            <Select value={assignTarget} onValueChange={setAssignTarget}>
              <SelectTrigger className="text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {assignDialog?.type === 'broker'
                  ? managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name} ({m.team})</SelectItem>)
                  : directors.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)
                }
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setAssignDialog(null)}>Cancelar</Button>
            <Button size="sm" onClick={assignMember}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
