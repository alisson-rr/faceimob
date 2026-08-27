import type { KeyboardEvent } from "react";
import { AlertCircle, CalendarCheck, GripVertical, StickyNote, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { brl } from "@/lib/format";
import { calcDealProbability } from "@/lib/aiAnalytics";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DOCUMENT_REVIEW_META } from "./review";
import type { PipelineStage } from "./stages";

interface Props {
  deal: LegacyDealRecord;
  onOpen: (deal: LegacyDealRecord) => void;
  onMove: (deal: LegacyDealRecord, stage: PipelineStage) => void;
  previousStage?: PipelineStage;
  nextStage?: PipelineStage;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}

/**
 * Card do kanban.
 *
 * Era um `<div draggable>` e nada mais: sem `tabIndex`, sem `role`, sem
 * teclado. Quem navega por teclado ou usa a tela no celular não conseguia nem
 * abrir o negócio, muito menos movê-lo (achado X01).
 *
 * As setas ← → movem de coluna pelo MESMO `onMove` que o `onDrop` usa — a
 * validação de `can_enter_stage()` fica num lugar só. Duplicar a regra aqui era
 * o jeito garantido de o teclado permitir o que o mouse recusa.
 */
export function DealCard({
  deal, onOpen, onMove, previousStage, nextStage, dragging, onDragStart, onDragEnd,
}: Props) {
  const review = DOCUMENT_REVIEW_META[deal.document_review_status ?? "draft"];
  const probability = calcDealProbability(deal);
  const stale = deal.days_in_pipeline > 30;

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(deal);
      return;
    }
    // Só a seta com Shift move: seta sozinha é como se rola uma coluna longa,
    // e mover negócio sem querer aqui é gravação no banco.
    if (!event.shiftKey) return;
    if (event.key === "ArrowRight" && nextStage) {
      event.preventDefault();
      onMove(deal, nextStage);
    }
    if (event.key === "ArrowLeft" && previousStage) {
      event.preventDefault();
      onMove(deal, previousStage);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`${deal.client} — ${deal.stage_label}. Enter abre; Shift com seta move de etapa.`}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(deal)}
      onKeyDown={handleKeyDown}
      className={cn(
        "cursor-grab rounded-xl border border-border/40 bg-card p-3 text-left transition-all",
        "hover:border-primary/30 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:cursor-grabbing",
        dragging && "scale-95 opacity-40",
      )}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p className="text-xs font-semibold leading-tight">{deal.client}</p>
        <GripVertical className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className="text-xs text-muted-foreground">{deal.project || "Sem empreendimento"} · {deal.unit || "—"}</p>
      <p className="mb-2 text-xs text-muted-foreground">{deal.developer || "Sem construtora"}</p>

      <Badge variant="outline" className={cn("mb-2 h-5 px-1.5 text-xs", review.className)}>
        {review.label}
      </Badge>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tabular-nums text-primary">{brl(deal.deal_value)}</span>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded px-1 py-0.5 text-xs font-bold tabular-nums",
              probability >= 60 ? "bg-success/20 text-success"
                : probability >= 35 ? "bg-warning/20 text-warning"
                  : "bg-destructive/20 text-destructive",
            )}
          >
            {probability}%
          </span>
          <span className={cn("text-xs tabular-nums", stale ? "text-destructive" : "text-muted-foreground")}>
            {deal.days_in_pipeline}d
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-border/20 pt-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <User className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate text-xs text-muted-foreground">{deal.broker1 || "Sem corretor"}</span>
        </div>
        <div className="flex gap-1">
          {deal.visit_date && <CalendarCheck className="h-3 w-3 text-warning" aria-label="Visita agendada" />}
          {deal.notes && <StickyNote className="h-3 w-3 text-muted-foreground" aria-label="Tem observação" />}
          {stale && <AlertCircle className="h-3 w-3 text-destructive" aria-label="Parado há mais de 30 dias" />}
        </div>
      </div>
    </div>
  );
}
