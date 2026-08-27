import { AlertTriangle, Clock } from "lucide-react";
import { SectionCard, StatusBadge } from "@/components/shared";
import { dateTime, num } from "@/lib/format";
import { funnelStageLabel, type LeadRecord } from "@/integrations/supabase/leads";

/** Quantos atrasados cabem antes de virar rolagem dentro do card. */
const VISIBLE = 8;

/**
 * Leads atrasados — a mesma conta de `overdue_lead_count`, que é a que bloqueia
 * o check-in. Uma heurística de tela diferente daqui mentiria para o corretor
 * sobre por que ele não consegue bater ponto.
 *
 * Cada linha é um `<button>` e abre o detalhe: a lista existe para o lead ser
 * tratado, não só contado.
 */
export function OverdueLeadsCard({
  leads, threshold, onOpen,
}: {
  leads: LeadRecord[];
  threshold: number;
  onOpen: (lead: LeadRecord) => void;
}) {
  if (leads.length === 0) return null;
  const blocked = leads.length >= threshold;

  return (
    <SectionCard
      title={`Leads atrasados (${num(leads.length)})`}
      description="Próxima ação vencida. Trate cada um para liberar novos check-ins."
      icon={AlertTriangle}
      actions={
        <StatusBadge tone={blocked ? "danger" : "warning"}>
          {blocked ? "Check-in bloqueado" : `Trava em ${num(threshold)}`}
        </StatusBadge>
      }
      contentClassName="space-y-2"
      footer={leads.length > VISIBLE ? `+ ${num(leads.length - VISIBLE)} outros leads atrasados.` : undefined}
    >
      {leads.slice(0, VISIBLE).map((lead) => (
        <button
          key={lead.id}
          type="button"
          onClick={() => onOpen(lead)}
          className="flex w-full items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-left transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{lead.name}</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs text-destructive">
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              venceu em {dateTime(lead.next_action_at)}
            </span>
          </span>
          <StatusBadge tone="neutral" className="shrink-0">{funnelStageLabel(lead.funnel_stage)}</StatusBadge>
        </button>
      ))}
    </SectionCard>
  );
}
