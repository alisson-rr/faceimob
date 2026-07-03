import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, Pencil } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Broker {
  id: string;
  name: string;
  role: string;
  manager_id: string | null;
  director_id: string | null;
}

export default function AdminTeams() {
  const [rows, setRows] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignDialog, setAssignDialog] = useState<{ type: 'broker' | 'manager'; member: Broker } | null>(null);
  const [assignTarget, setAssignTarget] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("brokers")
      .select("id,name,role,manager_id,director_id")
      .eq("active", true)
      .order("name");
    if (error) toast({ title: "Erro ao carregar", description: error.message, variant: "destructive" });
    setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const directors = rows.filter(r => r.role === 'director');
  const managers = rows.filter(r => r.role === 'manager');
  const brokers = rows.filter(r => r.role === 'broker');

  const assignMember = async () => {
    if (!assignDialog || !assignTarget) return;
    const field = assignDialog.type === 'broker' ? 'manager_id' : 'director_id';
    const patch: any = { [field]: assignTarget };
    // If assigning manager to a broker, also propagate director from that manager
    if (assignDialog.type === 'broker') {
      const mgr = managers.find(m => m.id === assignTarget);
      if (mgr?.director_id) patch.director_id = mgr.director_id;
    }
    const { error } = await supabase.from("brokers").update(patch).eq("id", assignDialog.member.id);
    if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });

    // If assigning director to a manager, propagate to all brokers under that manager
    if (assignDialog.type === 'manager') {
      await supabase.from("brokers").update({ director_id: assignTarget }).eq("manager_id", assignDialog.member.id);
    }

    toast({ title: "Atribuição atualizada" });
    setAssignDialog(null);
    setAssignTarget("");
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Gestão de Equipes</h1>
        <p className="text-xs text-muted-foreground">Estrutura hierárquica: Diretores → Gerentes → Corretores</p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando...</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Directors */}
          <Card className="border-blue-500/30">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-blue-400">Diretores ({directors.length})</CardTitle>
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
              <CardTitle className="text-sm text-cyan-400">Gerentes ({managers.length})</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[600px] overflow-y-auto">
              {managers.map(m => {
                const dir = directors.find(d => d.id === m.director_id);
                return (
                  <div key={m.id} className="p-2 rounded-lg border border-border/30 bg-cyan-500/5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center text-xs font-bold text-cyan-400">{m.name.charAt(0)}</div>
                      <div className="flex-1">
                        <span className="text-xs font-medium">{m.name}</span>
                        {dir && <p className="text-[10px] text-blue-400">↑ {dir.name}</p>}
                        {!dir && <p className="text-[10px] text-muted-foreground">Sem diretor</p>}
                      </div>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setAssignDialog({ type: 'manager', member: m }); setAssignTarget(m.director_id || ''); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Brokers */}
          <Card className="border-emerald-500/30">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm text-emerald-400">Corretores ({brokers.length})</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2 max-h-[600px] overflow-y-auto">
              {brokers.map(b => {
                const mgr = managers.find(m => m.id === b.manager_id);
                return (
                  <div key={b.id} className="p-2 rounded-lg border border-border/30 bg-emerald-500/5">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">{b.name.charAt(0)}</div>
                      <div className="flex-1">
                        <span className="text-xs font-medium">{b.name}</span>
                        {mgr ? <p className="text-[10px] text-cyan-400">↑ {mgr.name}</p> : <p className="text-[10px] text-muted-foreground">Sem gerente</p>}
                      </div>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { setAssignDialog({ type: 'broker', member: b }); setAssignTarget(b.manager_id || ''); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

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
                  ? managers.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)
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
