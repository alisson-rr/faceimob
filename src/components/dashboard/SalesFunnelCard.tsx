import { GitBranch, Inbox } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/shared";
import { num } from "@/lib/format";
import { DEAL_STAGES } from "@/types/crm";
import { BarList } from "./BarList";

export interface SalesFunnelCardProps {
  /** Negocios ATIVOS por codigo de etapa, no periodo selecionado. */
  stageCounts: Map<string, number>;
}

/**
 * Onde estao os negocios abertos, etapa a etapa da esteira.
 *
 * A ordem e a do catalogo `DEAL_STAGES` (a mesma do Pipeline), e etapa sem
 * negocio continua na lista com zero: some-la esconde justamente o gargalo.
 * Negocio perdido ou cancelado nao entra — `active` ja filtra isso.
 */
export function SalesFunnelCard({ stageCounts }: SalesFunnelCardProps) {
  const rows = DEAL_STAGES.map((stage) => ({
    label: stage.label,
    value: stageCounts.get(stage.value) ?? 0,
  }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <SectionCard
      title="Negócios por etapa"
      description="Negócios ativos na esteira, no período selecionado"
      icon={GitBranch}
      footer={total > 0 ? `${num(total)} negócios ativos no período` : undefined}
    >
      {total === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nenhum negócio ativo no período"
          description="Negócio perdido ou cancelado não entra nesta contagem. Troque o mês no filtro do topo para ver outro período."
        />
      ) : (
        <BarList rows={rows} share />
      )}
    </SectionCard>
  );
}
