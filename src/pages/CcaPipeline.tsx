import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  FileCheck, FileX, FilePlus, Send, AlertCircle,
  CheckCircle, Clock, XCircle, Building2, User, DollarSign,
  Plus, Settings, Pencil, Trash2, GripVertical
} from "lucide-react";

interface CcaStage {
  id: string;
  name: string;
  color: string;
  order: number;
}

interface CcaDeal {
  dealId: string;
  client: string;
  developer: string;
  project: string;
  broker: string;
  value: number;
  stageId: string;
  stageName: string;
  notes: string;
}

// Developers handled by internal CCA
const ccaDevelopers = ['MRV', 'Tenda', 'Direcional', 'TENDA'];

export default function CcaPipeline() {
  const [deals, setDeals] = useState<CcaDeal[]>([]);
  const [stages, setStages] = useState<CcaStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showStageSettings, setShowStageSettings] = useState(false);
  const [editingStage, setEditingStage] = useState<CcaStage | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("text-primary");

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch stages
      const { data: stagesData, error: stagesError } = await supabase
        .from('cca_stages')
        .select('*')
        .order('order');
      
      if (stagesError) throw stagesError;
      setStages(stagesData || []);

      // Fetch CCA deals status
      const { data: ccaDeals, error: ccaError } = await supabase
        .from('cca_deals')
        .select('*');

      if (ccaError) throw ccaError;

      // Fetch relevant deals
      const { data: dealsData, error: dealsError } = await supabase
        .from('deals')
        .select(`
          *,
          broker1:brokers!deals_broker1_id_fkey(name)
        `)
        .in('developer', ccaDevelopers)
        .eq('active', true);

      if (dealsError) throw dealsError;

      const mapped: CcaDeal[] = (dealsData || []).map(d => {
        const cca = (ccaDeals || []).find(c => c.deal_id === d.id);
        
        // Map enum to stage name
        const statusMap: Record<string, string> = {
          'credit_analysis': 'Análise de Crédito',
          'pending_documents': 'Pendente',
          'approved': 'Aprovado Total',
          'sent_to_agency': 'Enviado à Agência'
        };

        const currentStatusName = cca?.status ? (statusMap[cca.status] || cca.status) : 'Análise de Crédito';
        const stage = stagesData?.find(s => s.name === currentStatusName) || stagesData?.[0];
        
        return {
          dealId: d.id,
          client: d.client,
          developer: d.developer || '',
          project: d.project || '',
          broker: (d.broker1 as any)?.name || '',
          value: d.deal_value || 0,
          stageId: stage?.id || '',
          stageName: stage?.name || 'Análise de Crédito',
          notes: cca?.notes || d.notes || '',
        };
      });
      setDeals(mapped);
    } catch (err) {
      console.error("Error fetching CCA data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const [actionDeal, setActionDeal] = useState<CcaDeal | null>(null);
  const [targetStage, setTargetStage] = useState<CcaStage | null>(null);
  const [actionNotes, setActionNotes] = useState("");

  const dealsByStage = useMemo(() => {
    const map: Record<string, CcaDeal[]> = {};
    stages.forEach(s => map[s.id] = []);
    deals.forEach(d => {
      if (map[d.stageId]) map[d.stageId].push(d);
    });
    return map;
  }, [deals, stages]);

  const handleAction = (deal: CcaDeal, stage: CcaStage) => {
    setActionDeal(deal);
    setTargetStage(stage);
    setActionNotes(deal.notes || "");
  };

  const confirmAction = async () => {
    if (!actionDeal || !targetStage) return;

    try {
      const { error } = await supabase
        .from('cca_deals' as any)
        .upsert({
          deal_id: actionDeal.dealId,
          status: targetStage.name,
          notes: actionNotes,
          updated_at: new Date().toISOString()
        } as any, { onConflict: 'deal_id' });

      if (error) throw error;

      setDeals(prev => prev.map(d =>
        d.dealId === actionDeal.dealId ? { ...d, stageId: targetStage.id, stageName: targetStage.name, notes: actionNotes } : d
      ));

      toast({ title: "Status atualizado", description: `${actionDeal.client} movido para ${targetStage.name}` });
      setActionDeal(null);
      setTargetStage(null);
    } catch (err) {
      console.error("Error updating CCA stage:", err);
      toast({ variant: "destructive", title: "Erro ao salvar", description: "Não foi possível atualizar o status." });
    }
  };

  const handleSaveStage = async () => {
    if (!newStageName) return;
    try {
      if (editingStage) {
        const { error } = await supabase
          .from('cca_stages')
          .update({ name: newStageName, color: newStageColor })
          .eq('id', editingStage.id);
        if (error) throw error;
        toast({ title: "Estágio atualizado" });
      } else {
        const { error } = await supabase
          .from('cca_stages')
          .insert({ name: newStageName, color: newStageColor, order: stages.length });
        if (error) throw error;
        toast({ title: "Estágio criado" });
      }
      setNewStageName("");
      setEditingStage(null);
      fetchData();
    } catch (err) {
      console.error("Error saving stage:", err);
    }
  };

  const handleDeleteStage = async (id: string) => {
    if (!confirm("Tem certeza que deseja excluir este estágio?")) return;
    try {
      const { error } = await supabase.from('cca_stages').delete().eq('id', id);
      if (error) throw error;
      toast({ title: "Estágio excluído" });
      fetchData();
    } catch (err) {
      console.error("Error deleting stage:", err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Pipeline CCA</h1>
          <p className="text-xs text-muted-foreground">Correspondente Bancário {loading && "• Carregando..."}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowStageSettings(true)}>
          <Settings className="h-4 w-4 mr-2" /> Gerenciar Estágios
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stages.map(s => (
          <Card key={s.id} className="border-border/50 bg-card/70">
            <CardContent className="p-3 text-center">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.name}</span>
              <p className={cn("text-2xl font-bold", s.color)}>{dealsByStage[s.id]?.length || 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-3 min-w-max pb-4">
          {stages.map(stage => {
            const stageDeals = dealsByStage[stage.id] || [];
            return (
              <div key={stage.id} className={cn("w-64 flex-shrink-0 rounded-xl border bg-muted/5 border-border/20")}>
                <div className="p-3 flex items-center justify-between border-b border-border/10">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-2 w-2 rounded-full", stage.color.replace('text-', 'bg-'))} />
                    <span className="text-xs font-semibold">{stage.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-5">{stageDeals.length}</Badge>
                </div>
                <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-350px)] overflow-y-auto">
                  {stageDeals.map(deal => (
                    <Card key={deal.dealId} className="border-border/40 bg-card hover:border-primary/30 transition-all group">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <p className="text-xs font-semibold">{deal.client}</p>
                          <Badge variant="outline" className="text-[9px]">{deal.developer}</Badge>
                        </div>
                        <div className="space-y-1 text-[10px] text-muted-foreground">
                          <div className="flex items-center gap-1"><Building2 className="h-3 w-3" />{deal.project}</div>
                          <div className="flex items-center gap-1"><User className="h-3 w-3" />{deal.broker}</div>
                          <div className="flex items-center gap-1"><DollarSign className="h-3 w-3" />R$ {deal.value.toLocaleString('pt-BR')}</div>
                        </div>
                        
                        <div className="flex gap-1 flex-wrap pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {stages.filter(s => s.id !== stage.id).map(nextStage => (
                            <Button 
                              key={nextStage.id} 
                              size="sm" 
                              variant="outline" 
                              className="text-[8px] h-5 px-1" 
                              onClick={() => handleAction(deal, nextStage)}
                            >
                              Mover p/ {nextStage.name}
                            </Button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {stageDeals.length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-8">Nenhum deal</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={showStageSettings} onOpenChange={setShowStageSettings}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Gerenciar Estágios do CCA</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Input 
                placeholder="Nome do novo estágio" 
                value={newStageName} 
                onChange={e => setNewStageName(e.target.value)} 
                className="text-xs"
              />
              <Select value={newStageColor} onValueChange={setNewStageColor}>
                <SelectTrigger className="w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text-amber-400">Amarelo</SelectItem>
                  <SelectItem value="text-blue-400">Azul</SelectItem>
                  <SelectItem value="text-emerald-400">Verde</SelectItem>
                  <SelectItem value="text-red-400">Vermelho</SelectItem>
                  <SelectItem value="text-purple-400">Roxo</SelectItem>
                  <SelectItem value="text-primary">Padrao</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleSaveStage}><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="space-y-2">
              {stages.map(s => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded-lg border border-border/50 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-3 w-3 text-muted-foreground" />
                    <span className={cn("text-xs font-medium", s.color)}>{s.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditingStage(s); setNewStageName(s.name); setNewStageColor(s.color); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => handleDeleteStage(s.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionDeal} onOpenChange={() => { setActionDeal(null); setTargetStage(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Mover para {targetStage?.name}</DialogTitle>
          </DialogHeader>
          {actionDeal && (
            <div className="space-y-3">
              <Textarea
                placeholder="Observações..."
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="text-xs"
                rows={3}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActionDeal(null)}>Cancelar</Button>
            <Button size="sm" onClick={confirmAction}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

