import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { mockDeals } from "@/data/mockData";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  FileCheck, FileX, FilePlus, Send, AlertCircle,
  CheckCircle, Clock, XCircle, Building2, User, DollarSign
} from "lucide-react";

type CcaStage = 'credit_analysis' | 'pending_documents' | 'approved' | 'rejected' | 'sent_to_agency';

interface CcaDeal {
  dealId: string;
  client: string;
  developer: string;
  project: string;
  broker: string;
  value: number;
  stage: CcaStage;
  notes: string;
}

const CCA_STAGES: { value: CcaStage; label: string; icon: React.ElementType; color: string; bg: string }[] = [
  { value: 'credit_analysis', label: 'Análise de Crédito', icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  { value: 'pending_documents', label: 'Pendência de Documentos', icon: FilePlus, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  { value: 'approved', label: 'Aprovado', icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
  { value: 'rejected', label: 'Rejeitado', icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
  { value: 'sent_to_agency', label: 'Enviado à Agência', icon: Send, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
];

// Developers handled by internal CCA
const ccaDevelopers = ['MRV', 'Tenda', 'Direcional'];

const stageLabels: Record<CcaStage, string> = {
  credit_analysis: 'Análise de Crédito',
  pending_documents: 'Pendência Docs',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  sent_to_agency: 'Enviado Agência',
};

export default function CcaPipeline() {
  // Filter deals that require CCA (from ccaDevelopers)
  const initialCcaDeals: CcaDeal[] = useMemo(() =>
    mockDeals
      .filter(d => ccaDevelopers.includes(d.developer) && d.active)
      .map(d => ({
        dealId: d.id,
        client: d.client,
        developer: d.developer,
        project: d.project,
        broker: d.broker1,
        value: d.deal_value,
        stage: 'credit_analysis' as CcaStage,
        notes: '',
      })),
  []);

  const [deals, setDeals] = useState<CcaDeal[]>(initialCcaDeals);
  const [actionDeal, setActionDeal] = useState<CcaDeal | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'request_docs' | 'send_agency' | null>(null);
  const [actionNotes, setActionNotes] = useState("");

  const dealsByStage = useMemo(() => {
    const map: Record<CcaStage, CcaDeal[]> = {
      credit_analysis: [], pending_documents: [], approved: [], rejected: [], sent_to_agency: [],
    };
    deals.forEach(d => map[d.stage]?.push(d));
    return map;
  }, [deals]);

  const handleAction = (deal: CcaDeal, type: typeof actionType) => {
    setActionDeal(deal);
    setActionType(type);
    setActionNotes("");
  };

  const confirmAction = () => {
    if (!actionDeal || !actionType) return;
    const newStage: CcaStage =
      actionType === 'approve' ? 'approved' :
      actionType === 'reject' ? 'rejected' :
      actionType === 'request_docs' ? 'pending_documents' :
      'sent_to_agency';

    setDeals(prev => prev.map(d =>
      d.dealId === actionDeal.dealId ? { ...d, stage: newStage, notes: actionNotes } : d
    ));

    const labels = {
      approve: 'Crédito aprovado',
      reject: 'Crédito rejeitado',
      request_docs: 'Documentos solicitados',
      send_agency: 'Enviado à agência',
    };
    toast({ title: labels[actionType], description: `${actionDeal.client} - ${actionDeal.developer}` });
    setActionDeal(null);
    setActionType(null);
  };

  const metrics = [
    { label: 'Em Análise', value: dealsByStage.credit_analysis.length, color: 'text-amber-400' },
    { label: 'Pendência Docs', value: dealsByStage.pending_documents.length, color: 'text-blue-400' },
    { label: 'Aprovados', value: dealsByStage.approved.length, color: 'text-emerald-400' },
    { label: 'Rejeitados', value: dealsByStage.rejected.length, color: 'text-red-400' },
    { label: 'Na Agência', value: dealsByStage.sent_to_agency.length, color: 'text-purple-400' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">Pipeline CCA</h1>
        <p className="text-xs text-muted-foreground">Correspondente Bancário — Workflow de Aprovação de Crédito</p>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {metrics.map(m => (
          <Card key={m.label} className="border-border/50 bg-card/70">
            <CardContent className="p-3 text-center">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</span>
              <p className={cn("text-2xl font-bold", m.color)}>{m.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Kanban */}
      <div className="overflow-x-auto">
        <div className="flex gap-3 min-w-max pb-4">
          {CCA_STAGES.map(stage => {
            const stageDeals = dealsByStage[stage.value] || [];
            return (
              <div key={stage.value} className={cn("w-64 flex-shrink-0 rounded-xl border", stage.bg)}>
                <div className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <stage.icon className={cn("h-4 w-4", stage.color)} />
                    <span className="text-xs font-semibold">{stage.label}</span>
                  </div>
                  <Badge variant="secondary" className="text-[10px] h-5">{stageDeals.length}</Badge>
                </div>
                <div className="p-2 space-y-2 min-h-[200px] max-h-[calc(100vh-350px)] overflow-y-auto">
                  {stageDeals.map(deal => (
                    <Card key={deal.dealId} className="border-border/40 bg-card hover:border-primary/30 transition-all">
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
                        {deal.notes && <p className="text-[10px] text-muted-foreground italic border-t border-border/20 pt-1">{deal.notes}</p>}

                        {/* Actions based on stage */}
                        <div className="flex gap-1 flex-wrap pt-1">
                          {stage.value === 'credit_analysis' && (
                            <>
                              <Button size="sm" variant="outline" className="text-[9px] h-6 px-2" onClick={() => handleAction(deal, 'approve')}>
                                <CheckCircle className="h-3 w-3 mr-1" /> Aprovar
                              </Button>
                              <Button size="sm" variant="outline" className="text-[9px] h-6 px-2" onClick={() => handleAction(deal, 'request_docs')}>
                                <FilePlus className="h-3 w-3 mr-1" /> Docs
                              </Button>
                              <Button size="sm" variant="outline" className="text-[9px] h-6 px-2 text-red-400" onClick={() => handleAction(deal, 'reject')}>
                                <XCircle className="h-3 w-3 mr-1" /> Rejeitar
                              </Button>
                            </>
                          )}
                          {stage.value === 'pending_documents' && (
                            <>
                              <Button size="sm" variant="outline" className="text-[9px] h-6 px-2" onClick={() => handleAction(deal, 'approve')}>
                                <CheckCircle className="h-3 w-3 mr-1" /> Aprovar
                              </Button>
                              <Button size="sm" variant="outline" className="text-[9px] h-6 px-2 text-red-400" onClick={() => handleAction(deal, 'reject')}>
                                <XCircle className="h-3 w-3 mr-1" /> Rejeitar
                              </Button>
                            </>
                          )}
                          {stage.value === 'approved' && (
                            <Button size="sm" variant="outline" className="text-[9px] h-6 px-2" onClick={() => handleAction(deal, 'send_agency')}>
                              <Send className="h-3 w-3 mr-1" /> Enviar Agência
                            </Button>
                          )}
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

      {/* Action Dialog */}
      <Dialog open={!!actionDeal} onOpenChange={() => { setActionDeal(null); setActionType(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {actionType === 'approve' && '✅ Aprovar Crédito'}
              {actionType === 'reject' && '❌ Rejeitar Crédito'}
              {actionType === 'request_docs' && '📄 Solicitar Documentos'}
              {actionType === 'send_agency' && '🏦 Enviar à Agência'}
            </DialogTitle>
          </DialogHeader>
          {actionDeal && (
            <div className="space-y-3">
              <div className="text-xs space-y-1">
                <p><strong>Cliente:</strong> {actionDeal.client}</p>
                <p><strong>Construtora:</strong> {actionDeal.developer}</p>
                <p><strong>Projeto:</strong> {actionDeal.project}</p>
                <p><strong>Valor:</strong> R$ {actionDeal.value.toLocaleString('pt-BR')}</p>
              </div>
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
            <Button variant="outline" size="sm" onClick={() => { setActionDeal(null); setActionType(null); }}>Cancelar</Button>
            <Button size="sm" onClick={confirmAction}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
