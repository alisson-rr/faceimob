import { AlertTriangle, GitBranch, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import { useDealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { BarList } from "./BarList";
import { linhasDoStatus2 } from "./cartoesDoMes";
import type { DealRow } from "./data";

export interface SalesFunnelCardProps {
  /** Negócios do período (`view.rows`). O bloco conta vendas + em aberto — o
   *  mesmo conjunto de antes; perdido e cancelado ficam de fora. */
  deals: DealRow[];
}

/**
 * Onde estão os negócios do mês, pelo Status 2 (pedido de 28/09/2026): uma
 * linha por Status 2 com negócio no período, na ordem do cadastro de status, e
 * nenhuma zerada. Antes era por etapa do pipeline, com as etapas vazias na
 * lista — o cliente lê a operação pelo Status 2.
 *
 * O total continua sendo vendas + em aberto (`linhasDoStatus2`), e o rodapé
 * diz isso.
 */
export function SalesFunnelCard({ deals }: SalesFunnelCardProps) {
  const catalog = useDealStatusCatalog();
  // Sem o catálogo não há ordem nem rótulo: a lista espera, e o rodapé não
  // conta antes disso.
  const rows = catalog.data ? linhasDoStatus2(deals, catalog.data) : [];
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  const body = () => {
    if (catalog.isPending) return <LoadingState variant="block" label="Carregando os status…" />;

    if (catalog.isError) {
      return (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar os status"
          description={describeError(
            catalog.error,
            "A consulta do catálogo de status falhou. Sem ela não dá para ordenar os negócios por Status 2.",
          )}
          action={
            <Button variant="outline" onClick={() => void catalog.refetch()}>
              Tentar de novo
            </Button>
          }
        />
      );
    }

    if (total === 0) {
      return (
        <EmptyState
          icon={Inbox}
          title="Nenhum negócio no período"
          description="Negócio perdido ou cancelado não entra nesta contagem. Troque o mês no filtro do topo para ver outro período."
        />
      );
    }

    return <BarList rows={rows} share />;
  };

  return (
    <SectionCard
      title="Negócios por etapa"
      description="Negócios do período por Status 2, na ordem do cadastro"
      icon={GitBranch}
      footer={total > 0 ? `${num(total)} negócios no período · vendas + em aberto` : undefined}
    >
      {body()}
    </SectionCard>
  );
}
