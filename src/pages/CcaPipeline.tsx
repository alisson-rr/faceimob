import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { type DealStage } from "@/types/crm";
import {
  Building2, User, DollarSign, Plus, Settings, Pencil, Trash2, GripVertical, Send
} from "lucide-react";
import { getStageIdByCode, listLegacyDeals } from "@/integrations/supabase/newSchema";
import DeveloperSubmissionDialog from "@/components/DeveloperSubmissionDialog";

type CcaCaseStatus = "pending_documents" | "under_review" | "sent_to_developer" | "sent_to_agency" | "approved" | "rejected" | "cancelled";

interface CcaStage {
  id: string;
  name: string;
  color: string;
  position: number;
  status: string;
}

interface CcaDeal {
  caseId: string;
  dealId: string;
  client: string;
  developer: string;
  project: string;
  broker: string;
  value: number;
  stageId: string;
  stageName: string;
  notes: string;
  status: string;
}

export default function CcaPipeline() {
  const [deals, setDeals] = useState<CcaDeal[]>([]);
  const [stages, setStages] = useState<CcaStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showStageSettings, setShowStageSettings] = useState(false);
  const [editingStage, setEditingStage] = useState<CcaStage | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState("text-primary");
  const [submissionDeal, setSubmissionDeal] = useState<CcaDeal | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stagesResponse, casesResponse, dealRows] = await Promise.all([
        supabase
          .from("cca_stages")
          .select("id,name,color,position,status,active")
          .eq("active", true)
          .order("position"),
        supabase
          .from("cca_cases")
          .select("id,deal_id,status,stage_id,decision_notes,pending_items"),
        listLegacyDeals(),
      ]);

      if (stagesResponse.error) throw stagesResponse.error;
      if (casesResponse.error) throw casesResponse.error;

      const stagesData = (stagesResponse.data || []) as CcaStage[];
      const casesData = casesResponse.data || [];
      setStages(stagesData);

      const mapped: CcaDeal[] = casesData.map((cca) => {
        const deal = dealRows.find((row) => row.id === cca.deal_id);
        const stage =
          stagesData.find((row) => row.id === cca.stage_id) ||
          stagesData.find((row) => row.status === cca.status) ||
          stagesData[0];

        return {
          caseId: cca.id,
          dealId: cca.deal_id,
          client: deal?.client || "Cliente não informado",
          developer: deal?.developer || "",
          project: deal?.project || "",
          broker: deal?.broker1 || "",
          value: deal?.deal_value || 0,
          stageId: stage?.id || "",
          stageName: stage?.name || cca.status,
          notes: cca.decision_notes || deal?.notes || "",
          status: cca.status,
        };
      });
      setDeals(mapped);
      setLoadError(null);
    } catch (err) {
      console.error("Error fetching CCA data:", err);
      // Sem isto a esteira sumia em silêncio e parecia vazia.
      setLoadError(err instanceof Error ? err.message : "erro inesperado");
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
      const isDecision = ["approved", "rejected"].includes(targetStage.status);
      const { error } = await supabase
        .from("cca_cases")
        .update({
          stage_id: targetStage.id,
          status: targetStage.status as CcaCaseStatus,
          decision_notes: actionNotes || null,
          decided_at: isDecision ? new Date().toISOString() : null,
        })
        .eq("id", actionDeal.caseId);

      if (error) throw error;

      let mainStageUpdate: DealStage | null = null;
      if (targetStage.status === "approved") mainStageUpdate = "approved";

      if (mainStageUpdate) {
        const stageId = await getStageIdByCode(mainStageUpdate);
        const { error: dealError } = await supabase
          .from("deals")
          .update({ stage_id: stageId })
          .eq('id', actionDeal.dealId);

        if (dealError) {
          // O caso CCA já avançou; avisar que o negócio principal ficou para trás.
          toast({ variant: "destructive", title: "Pipeline não atualizado", description: dealError.message });
        } else {
          toast({ title: "Status do Pipeline atualizado" });
        }
      }

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
          .insert({
            name: newStageName,
            color: newStageColor,
            position: stages.length + 1,
            status: "under_review",
          });
        if (error) throw error;
        toast({ title: "Estágio criado" });
      }
      setNewStageName("");
      setEditingStage(null);
      fetchData();
    } catch (err) {
      console.error("Error saving stage:", err);
      toast({
        variant: "destructive",
        title: "Erro ao salvar estágio",
        description: err instanceof Error ? err.message : "tente novamente",
      });
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
      toast({
        variant: "destructive",
        title: "Erro ao excluir estágio",
        description: err instanceof Error ? err.message : "tente novamente",
      });
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

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm flex items-center justify-between gap-2">
            <span>Não foi possível carregar a esteira CCA: {loadError}</span>
            <Button size="sm" variant="outline" onClick={fetchData}>Tentar novamente</Button>
          </CardContent>
        </Card>
      )}

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

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 w-full text-[10px] gap-1"
                          onClick={() => setSubmissionDeal(deal)}
                        >
                          <Send className="h-3 w-3" /> Enviar à construtora
                        </Button>
                        
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
      {submissionDeal && (
        <DeveloperSubmissionDialog
          open={!!submissionDeal}
          onClose={() => setSubmissionDeal(null)}
          dealId={submissionDeal.dealId}
          clientName={submissionDeal.client}
          developerName={submissionDeal.developer}
        />
      )}

    </div>
  );
}

