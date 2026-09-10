import { AlertTriangle, GitBranch, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import { num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { BarList } from "./BarList";
import { funnelRows, useFunnelStages } from "./data";

export interface SalesFunnelCardProps {
  /** Negocios do periodo por codigo de etapa — venda + em aberto, o mesmo
   *  conjunto do KPI "Negocios". Perdido e cancelado ficam de fora. */
  stageCounts: Map<string, number>;
}

/**
 * Onde estao os negocios do mes, etapa a etapa da esteira.
 *
 * A lista conta VENDA + EM ABERTO, nao so o que ainda esta andando: o total
 * daqui e o mesmo do KPI "Negocios", e os dois nasciam de regras diferentes e
 * mostravam 22 e 25 lado a lado, na mesma tela. Por isso o texto nao pode
 * chamar o conjunto de "ativo" — a linha "Fechado · 7" esta bem ali.
 *
 * A ordem e os rotulos saem de `pipeline_stages` (Tarefa H: fonte unica de
 * etapa), nao de um catalogo fixo no frontend — com a lista chumbada, etapa
 * renomeada no banco aparecia com o nome velho e etapa NOVA nao aparecia,
 * levando junto os negocios dela. Etapa sem negocio continua na lista com zero:
 * some-la esconde justamente o gargalo.
 */
export function SalesFunnelCard({ stageCounts }: SalesFunnelCardProps) {
  const stages = useFunnelStages();
  // Sem o catalogo NADA casa, e `funnelRows` leria a etapa de todo negocio como
  // "fora do catalogo": enquanto a consulta nao volta, a lista fica vazia e o
  // corpo mostra o carregamento — o rodape nao pode contar antes disso.
  const rows = stages.data ? funnelRows(stages.data, stageCounts) : [];
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  const body = () => {
    if (stages.isPending) return <LoadingState variant="block" label="Carregando as etapas…" />;

    if (stages.isError) {
      return (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar as etapas"
          description={describeError(
            stages.error,
            "A consulta do catálogo de etapas falhou. Sem ela não dá para dizer em que etapa cada negócio está.",
          )}
          action={
            <Button variant="outline" onClick={() => void stages.refetch()}>
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
      description="Negócios do período, por etapa da esteira"
      icon={GitBranch}
      footer={total > 0 ? `${num(total)} negócios no período · vendas + em aberto` : undefined}
    >
      {body()}
    </SectionCard>
  );
}
