import { useState } from "react";
import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DealCard } from "./DealCard";
import { funnelStages, stageSurface, type PipelineStage } from "./stages";

interface Props {
  stages: PipelineStage[];
  deals: LegacyDealRecord[];
  onOpen: (deal: LegacyDealRecord) => void;
  onMove: (deal: LegacyDealRecord, stage: PipelineStage) => void;
}

/**
 * Kanban do funil.
 *
 * As colunas vêm de `pipeline_stages` — não de uma lista no front. Era isso que
 * fazia a etapa `lost`, que existe no banco, cair em `incomplete` na tela.
 */
export function DealsKanban({ stages, deals, onOpen, onMove }: Props) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const columns = funnelStages(stages);

  const drop = (stage: PipelineStage) => {
    const deal = deals.find((row) => row.id === dragged);
    setDragged(null);
    setDragOver(null);
    if (deal && deal.stage !== stage.code) onMove(deal, stage);
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-3 pb-4">
        {columns.map((stage, index) => {
          const surface = stageSurface(stage.code);
          const stageDeals = deals.filter((deal) => deal.stage === stage.code);
          return (
            <div
              key={stage.id}
              className={cn(
                "w-60 flex-shrink-0 rounded-2xl border transition-all",
                surface.border,
                dragOver === stage.id && "ring-2 ring-ring",
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

              <div className={cn("max-h-[calc(100vh-420px)] min-h-[180px] space-y-2 overflow-y-auto p-2", surface.body)}>
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    onOpen={onOpen}
                    onMove={onMove}
                    previousStage={columns[index - 1]}
                    nextStage={columns[index + 1]}
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
