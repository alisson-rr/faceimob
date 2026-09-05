import { useState } from "react";
import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DealCard } from "./DealCard";
import { useCanExitStage } from "./data";
import { blockedMoveReason, dealLock } from "./guards";
import { funnelStages, stageSurface, type PipelineStage } from "./stages";

interface Props {
  stages: PipelineStage[];
  deals: LegacyDealRecord[];
  onOpen: (deal: LegacyDealRecord) => void;
  onMove: (deal: LegacyDealRecord, stage: PipelineStage) => void;
  /** Encerrar o negócio pelo diálogo de perda. Só existia na visão de tabela:
   *  no kanban era preciso trocar de visão para perder um negócio. */
  onLose: (deal: LegacyDealRecord) => void;
  /** Espelha `can_edit_deal`: sem escrita o cartão abre, mas não arrasta. */
  canWrite: boolean;
  /** Meses congelados: negócio de mês fechado não muda de etapa (0031). */
  closedMonths: string[];
}

/**
 * Kanban do funil.
 *
 * As colunas vêm de `pipeline_stages` — não de uma lista no front. Era isso que
 * fazia a etapa `lost`, que existe no banco, cair em `incomplete` na tela.
 *
 * A trava do cartão sai de `dealLock`, a MESMA função da tabela. Enquanto o
 * cartão recalculava `canWrite && canExit` por conta própria, o mês congelado
 * não chegava até ele: o gerente via alça, `draggable` e os botões de mover num
 * negócio de mês fechado, e o gesto morria no `blockedMoveReason` com toast
 * vermelho — o "gesto que aparece e o banco recusa" que o guards.ts existe para
 * eliminar.
 *
 * A recusa POR DESTINO desce junto (`blockedMove`): `can_exit` diz se dá para
 * sair da coluna, e é só metade da matriz — `can_enter` do destino e a
 * conferência documental dependem de para onde se move.
 */
export function DealsKanban({ stages, deals, onOpen, onMove, onLose, canWrite, closedMonths }: Props) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  /** Anúncio para leitor de tela: o cartão sai de uma coluna e entra em outra
   *  sem que o foco acompanhe, então sem isto o gesto era mudo até o toast. */
  const [announcement, setAnnouncement] = useState("");
  const canExitStage = useCanExitStage();
  const { isAdmin, canEnterStage } = useAuth();

  const columns = funnelStages(stages);

  /** A mesma recusa que `useDealActions` consulta antes de gravar, agora também
   *  ANTES de oferecer o gesto: `can_exit` sozinho é metade da matriz, e o
   *  `can_enter` do destino e a conferência documental só apareciam depois do
   *  clique, em toast vermelho. */
  const blockedMove = (deal: LegacyDealRecord, stage: PipelineStage) =>
    blockedMoveReason(deal, stage, { isAdmin, canEnterStage, canExitStage, closedMonths });

  const move = (deal: LegacyDealRecord, stage: PipelineStage) => {
    setAnnouncement(`Movendo ${deal.client} para ${stage.label}.`);
    onMove(deal, stage);
  };

  const drop = (stage: PipelineStage) => {
    const deal = deals.find((row) => row.id === dragged);
    setDragged(null);
    setDragOver(null);
    if (!canWrite || !deal || deal.stage === stage.code) return;
    // A MESMA recusa que a coluna acabou de desenhar em vermelho durante o
    // arraste. Sem esta linha o solte virava escrita: o `aria-live` anunciava
    // "Movendo Fulano para Aprovado" e só depois vinha o toast destrutivo de
    // `moveDeal` — quem usa leitor de tela ouvia a confirmação ANTES da
    // negativa, e quem enxerga levava toast vermelho por um gesto que a própria
    // coluna já tinha recusado. Aqui o gesto simplesmente não vira escrita, que
    // é o contrato do `guards.ts`; o toast continua cobrindo teclado e botões.
    const recusa = blockedMove(deal, stage);
    if (recusa) {
      setAnnouncement(recusa);
      return;
    }
    move(deal, stage);
  };

  /** O negócio que está na mão, para a coluna saber se aceita o destino ANTES
   *  do solte: `drop()` só conferia `canWrite` e a mudança de coluna, e a
   *  recusa por destino (`can_enter`, conferência documental) só aparecia
   *  depois, em toast vermelho. A coluna que recusa passa a se marcar durante
   *  o arraste. */
  const emArraste = dragged ? deals.find((row) => row.id === dragged) ?? null : null;
  const recusaDoDestino = (stage: PipelineStage) =>
    emArraste && emArraste.stage !== stage.code ? blockedMove(emArraste, stage) : null;

  return (
    <div className="overflow-x-auto">
      <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      <div className="flex min-w-max gap-3 pb-4">
        {columns.map((stage, index) => {
          const surface = stageSurface(stage.code);
          const stageDeals = deals.filter((deal) => deal.stage === stage.code);
          const recusa = recusaDoDestino(stage);
          return (
            <div
              key={stage.id}
              className={cn(
                "w-60 flex-shrink-0 rounded-2xl border transition-all",
                surface.border,
                dragOver === stage.id && (recusa ? "ring-2 ring-destructive" : "ring-2 ring-ring"),
              )}
              onDragOver={(event) => { event.preventDefault(); setDragOver(stage.id); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={() => drop(stage)}
            >
              <div className={cn("flex items-center justify-between rounded-t-2xl p-3", surface.header)}>
                <div className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-full", surface.dot)} aria-hidden />
                  <h3 className="text-xs font-semibold">{stage.label}</h3>
                </div>
                <Badge variant="secondary" className="h-5 px-1.5 text-xs tabular-nums">{stageDeals.length}</Badge>
              </div>
              {/* A recusa do destino aparece durante o arraste, não depois do
                  solte: era só o toast vermelho que contava. */}
              {dragOver === stage.id && recusa && (
                <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {recusa}
                </p>
              )}

              <div className={cn("max-h-[calc(100vh-420px)] min-h-[180px] space-y-2 overflow-y-auto p-2", surface.body)}>
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    onOpen={onOpen}
                    onMove={move}
                    lock={dealLock(deal, { canWrite, isAdmin, closedMonths })}
                    canExit={canExitStage(deal.stage_id)}
                    blockedMove={(destino) => blockedMove(deal, destino)}
                    onBlockedMove={setAnnouncement}
                    previousStage={columns[index - 1]}
                    nextStage={columns[index + 1]}
                    onLose={onLose}
                    dragging={dragged === deal.id}
                    onDragStart={() => setDragged(deal.id)}
                    onDragEnd={() => { setDragged(null); setDragOver(null); }}
                  />
                ))}
                {stageDeals.length === 0 && (
                  <p className="flex h-20 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                    <Inbox className="h-3.5 w-3.5" aria-hidden /> Vazia
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
