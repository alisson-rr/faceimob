import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { avisarQueda } from "@/components/ui/avisos";
import { toast } from "@/components/ui/sonner";
import { ehDesfechoRuim } from "@/lib/dealStatus";
import { describeError } from "@/lib/supabaseError";
import { moveDealStatus, statusKey, type DealStatus } from "@/integrations/supabase/dealStatuses";
import { ccaEnviarParaVirarNegocio, submitDealForManagerReview } from "@/integrations/supabase/documents";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";

/**
 * Mover o negócio para um Status 2 que pede texto (0164).
 *
 * Dois caminhos, porque são duas coisas diferentes no banco:
 *  · voltar para a análise (esteira ágil, retorno à esteira, análise p/ virar
 *    negócio) é o ENVIO AO GERENTE — reabre a conferência e devolve o caso à
 *    CCA. A mensagem é obrigatória e vai para o histórico e para os gerentes;
 *  · o resto é `move_deal_status` com a observação que o status pede.
 */
export type MovimentoComTexto = { deal: LegacyDealRecord; status: DealStatus };

const ANALISE_VIRAR = statusKey("15. ANÁLISE P/ VIRAR NEGÓCIO");

export function MoverStatusDialog({ movimento, envioParaAnalise, onClose, onMoved }: {
  movimento: MovimentoComTexto;
  /** `true` quando o destino é um dos status de análise: vira envio ao gerente. */
  envioParaAnalise: boolean;
  onClose: () => void;
  onMoved: () => void | Promise<void>;
}) {
  const id = useId();
  const { deal, status } = movimento;
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const limpo = texto.trim();
  const { roles } = useAuth();
  // 0358: a CCA manda o aprovado direto para a esteira dela, sem o gerente.
  const diretoPelaCca = envioParaAnalise && roles.includes("cca") && statusKey(status.value) === ANALISE_VIRAR;

  const confirmar = async () => {
    if (!limpo || enviando) return;
    setEnviando(true);
    try {
      if (diretoPelaCca) {
        await ccaEnviarParaVirarNegocio(deal.id, limpo);
        toast.success("Enviado para análise p/ virar negócio", {
          description: "O negócio voltou para a esteira da CCA, com a sua observação no histórico.",
        });
      } else if (envioParaAnalise) {
        await submitDealForManagerReview(
          deal.id, limpo, statusKey(status.value) === ANALISE_VIRAR ? "virar" : "agil",
        );
        toast.success("Enviado para análise", {
          description: "O gerente confere e o negócio volta para a CCA com a sua observação.",
        });
      } else {
        await moveDealStatus(deal.id, status.value, limpo);
        if (ehDesfechoRuim(status.value)) avisarQueda(`Negócio movido para ${status.label}`, deal.client);
        else toast.success(`Negócio movido para ${status.label}`, { duration: 2500 });
      }
      await onMoved();
      onClose();
    } catch (error) {
      toast.error("Não foi possível mover o negócio", {
        description: describeError(error, "O Status 2 não foi alterado."),
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{envioParaAnalise ? "Enviar para análise" : `Mover para ${status.label}`}</DialogTitle>
          <DialogDescription>
            {diretoPelaCca
              ? `${deal.client}: o negócio vai direto para a esteira da CCA, sem a conferência do gerente. A mensagem fica no histórico.`
              : envioParaAnalise
              ? `${deal.client}: descreva a pendência respondida. A mensagem vai para o gerente conferir e fica no histórico do negócio.`
              : `${deal.client}: este status pede uma observação, que fica no histórico do negócio.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-texto`}>{envioParaAnalise ? "Mensagem do envio" : "Observação"}</Label>
          <Textarea
            id={`${id}-texto`} rows={4} maxLength={envioParaAnalise ? 4000 : 2000}
            value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={envioParaAnalise ? "Ex.: comprovante de renda atualizado anexado." : "Escreva a observação"}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Button variant="success" onClick={() => void confirmar()} disabled={!limpo || enviando}>
            {enviando ? "Enviando…" : envioParaAnalise ? "Enviar para análise" : "Mover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
