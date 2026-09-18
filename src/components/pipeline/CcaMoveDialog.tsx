import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { dbError, describeError } from "@/lib/supabaseError";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { updateDeal, useCanExitStage } from "./data";
import { isBehindStage } from "./guards";
import { ccaStatusLabel, isDecision } from "./ccaStage";
import { ccaStageNotifiesSales, type CcaDeal, type CcaStage } from "./ccaData";
import type { PipelineStage } from "./stages";

/** Teto que `move_cca_case` cobra (0150). */
const MAX_MENSAGEM = 4000;

interface Props {
  deal: CcaDeal;
  stage: CcaStage;
  /** Etapa "Aprovado" do funil comercial, para levar o negócio junto. */
  approvedStage?: PipelineStage;
  /** Negócio do caso, da carga da própria esteira. Ausente: fora da visibilidade de quem move. */
  negocio?: LegacyDealRecord;
  onClose: () => void;
  onMoved: () => void | Promise<void>;
}

/**
 * Confirmação da movimentação na esteira.
 *
 * O desfecho vem do estágio (`cca_stages.status`), que o operador escolhe ao
 * criar o estágio: um "Aprovado" criado pela tela nascia `under_review` e não
 * decidia nem movia nada (achado P10).
 *
 * **O caso vai primeiro; o negócio é consequência.** São duas escritas em
 * transações separadas, e a do negócio é a que pode ser recusada — a matriz de
 * etapas (`deals_guard_stage`) e o mês fechado (`deals_guard_closed_month`)
 * cobram a analista, que não é dona do funil comercial. Enquanto o `updateDeal`
 * vinha primeiro, um 42501 abortava o `confirm` inteiro: o caso NÃO era decidido
 * e a analista ficava sem caminho nenhum — nem esteira, nem funil. Decidir o
 * caso é o trabalho dela; a etapa que não andou vira aviso no mesmo toast, e o
 * negócio segue movível pelo Pipeline por quem tem a etapa.
 *
 * **O negócio só anda para frente e só aberto** (`isBehindStage`). Aprovar o
 * caso de um negócio já em Contrato, Fechado ou Perdido o puxava de volta para
 * "Aprovado": a matriz deixa a CCA sair de Fechado, `deals_guard_stage` reabre o
 * desfecho e a venda saía do VGV (14/09/2026: 926 vendas e 3.036 perdidos
 * expostos na homologação).
 */
// `negocio` vem por prop porque `CcaDeal` carrega o estágio da ESTEIRA, não a
// etapa do negócio no funil comercial — e sem ela não dá para saber se ele está
// atrás de "Aprovado" nem espelhar a metade "sair" da matriz. É o registro que a
// esteira já carregou para o período, não a base inteira de negócios.
export function CcaMoveDialog({ deal, stage, approvedStage, negocio, onClose, onMoved }: Props) {
  const { canEnterStage } = useAuth();
  const canExitStage = useCanExitStage();
  // Abre VAZIA: a mensagem é o aviso desta movimentação para corretor e gerente,
  // e semear com a observação antiga (a do Bubble) mandava texto velho como novo.
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const levaAoAprovado = Boolean(negocio && isBehindStage(negocio, approvedStage));

  /**
   * Por que o negócio NÃO vai andar no funil quando deveria — `""` quando ele
   * anda ou quando não há o que andar (já está em "Aprovado" ou adiante, ou
   * encerrado: isso não é recusa, é o negócio no lugar certo).
   *
   * As DUAS metades da matriz, como em `ScheduleVisitDialog`: o
   * `deals_guard_stage` cobra `can_exit_stage(etapa atual)` ANTES de olhar o
   * destino, e checar só o "entrar" fazia este diálogo prometer a
   * movimentação para o banco recusá-la depois.
   *
   * Negócio fora da lista carregada não é movido às cegas: sem a etapa atual não
   * há como garantir que ele não está em Contrato ou Fechado.
   */
  const motivoParado = !approvedStage
    ? 'a etapa "Aprovado" do funil ainda não carregou.'
    : !negocio
      ? "o negócio não apareceu na sua lista; mova-o pelo Pipeline."
      : !levaAoAprovado
        ? ""
        : !canEnterStage(approvedStage.id)
          ? 'seu perfil não pode mover negócios para "Aprovado" no funil.'
          : !canExitStage(negocio.stage_id)
            ? `seu perfil não pode tirar um negócio de "${negocio.stage_label}".`
            : "";

  const confirm = async () => {
    setSaving(true);
    try {
      // A única porta desde a 0150: grava coluna, desfecho, Status 2 da coluna,
      // comentário no negócio e o aviso à equipe numa transação. O PATCH em
      // `cca_cases` passou a ser recusado (42501).
      const { error } = await supabase.rpc("move_cca_case", {
        p_case_id: deal.caseId,
        p_stage_id: stage.id,
        p_message: message.trim(),
      });
      if (error) throw dbError("move_cca_case", error);

      // O caso JÁ está decidido. Uma recusa aqui (matriz de etapas, mês fechado)
      // não desfaz a decisão: avisa e deixa o negócio para quem move o funil.
      let avisoNegocio = "";
      if (stage.status === "approved") {
        if (motivoParado) {
          avisoNegocio = motivoParado;
        } else if (levaAoAprovado && approvedStage) {
          try {
            await updateDeal(deal.dealId, { stage_id: approvedStage.id });
          } catch (err) {
            avisoNegocio = describeError(err, "o negócio não foi movido no funil.");
          }
        }
      }

      if (avisoNegocio) {
        toast.warning(`Caso movido para ${stage.name}`, {
          description: `${deal.client}. O negócio ficou parado no Pipeline: ${avisoNegocio}`,
        });
      } else {
        toast.success(`Caso movido para ${stage.name}`, { description: `${deal.client}.` });
      }
      await onMoved();
      onClose();
    } catch (err) {
      toast.error("Não foi possível mover o caso", {
        description: describeError(err, "Nada foi alterado no servidor."),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mover para {stage.name}</DialogTitle>
          <DialogDescription>
            {deal.client} · desfecho <strong className="text-foreground">{ccaStatusLabel(stage.status)}</strong>
            {isDecision(stage.status) && " — esta movimentação decide o caso."}
          </DialogDescription>
        </DialogHeader>

        {/* O efeito da coluna antes de confirmar (0155): quem é avisado e o que
            acontece com o status do negócio. */}
        <p className="rounded-xl border border-border bg-muted/30 p-2 text-xs">
          {ccaStageNotifiesSales(stage)
            ? "O corretor e o gerente do negócio recebem o aviso com a sua mensagem."
            : stage.status === "pending_documents"
              // A devolução do dossiê (0077) avisa o corretor por conta própria.
              ? "Movimento interno: sem aviso da movimentação, mas o corretor pode receber o aviso de que o dossiê voltou para ele."
              : "Movimento interno: o comercial não é avisado. A mensagem fica só no histórico do negócio."}{" "}
          {stage.deal_status_id
            ? <>O status do negócio passa a ser <strong className="text-foreground">{stage.deal_status?.label ?? "o Status 2 da coluna"}</strong>.</>
            : "O status do negócio não muda."}
          {/* A etapa do funil é outra coisa que o Status 2, e aprovar leva o
              negócio a "Aprovado" mesmo numa coluna interna: o comercial vê
              o negócio andar, então a tela diz antes de confirmar. */}
          {stage.status === "approved" && levaAoAprovado && !motivoParado && (
            <> O negócio vai para a etapa <strong className="text-foreground">{approvedStage?.label ?? "Aprovado"}</strong> do funil do Pipeline.</>
          )}
        </p>

        <div>
          <Label htmlFor="cca-move-message">Mensagem para a equipe</Label>
          <Textarea
            id="cca-move-message" rows={3} className="mt-1 text-xs"
            required maxLength={MAX_MENSAGEM} aria-describedby="cca-move-message-hint"
            placeholder={ccaStageNotifiesSales(stage)
              ? "O que mudou e o próximo passo. Vai para o corretor e o gerente."
              : "O que mudou e o próximo passo. Fica no histórico do negócio."}
            value={message} onChange={(event) => setMessage(event.target.value)}
          />
          <p id="cca-move-message-hint" className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
            Obrigatória · {message.length}/{MAX_MENSAGEM}
          </p>
        </div>

        {/* Mesma frase do toast, do mesmo `motivoParado`: enquanto o painel e o
            toast montavam o motivo cada um por sua conta, um podia prometer o
            que o outro desmentia. */}
        {stage.status === "approved" && motivoParado && (
          <p className="rounded-xl border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            O caso será aprovado, mas o negócio continua na etapa atual do funil: {motivoParado}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={saving || !message.trim()} onClick={() => void confirm()}>
            {saving ? "Movendo…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
