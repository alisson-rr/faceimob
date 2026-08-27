import { AlertTriangle, Inbox, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { DealsKanban } from "./DealsKanban";
import { DealsTable } from "./DealsTable";
import type { PipelineStage } from "./stages";

interface Props {
  view: "table" | "kanban";
  /** Negócios já filtrados e ordenados. */
  deals: LegacyDealRecord[];
  stages: PipelineStage[];
  isPending: boolean;
  error: unknown;
  filtered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
  onNewDeal: () => void;
  onOpen: (deal: LegacyDealRecord) => void;
  onMove: (deal: LegacyDealRecord, stage: PipelineStage) => void;
  onStatusChange: (deal: LegacyDealRecord, status: string) => void;
  onScheduleVisit: (deal: LegacyDealRecord) => void;
  onLose: (deal: LegacyDealRecord) => void;
}

/**
 * Os quatro estados da listagem num lugar só (achado A01).
 *
 * Antes o `catch` da carga só toastava e deixava `deals = []`: erro de rede e
 * filtro sem resultado davam a MESMA tela ("Nenhum negócio encontrado"), e o
 * kanban não tinha nem espera nem erro. Aqui carregando, erro, vazio-por-filtro
 * e vazio-de-verdade são telas distintas, cada uma com a sua saída.
 */
export function DealsBoard({
  view, deals, stages, isPending, error, filtered,
  onRetry, onClearFilters, onNewDeal, onOpen, onMove, onStatusChange, onScheduleVisit, onLose,
}: Props) {
  if (isPending) return <LoadingState variant="table" rows={8} label="Carregando negócios…" />;

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        tone="danger"
        title="Não consegui carregar os negócios"
        description={describeError(error, "Verifique a conexão e tente de novo.")}
        action={<Button onClick={onRetry}>Tentar de novo</Button>}
      />
    );
  }

  if (deals.length === 0) {
    return filtered ? (
      <EmptyState
        icon={Search}
        title="Nenhum negócio com esses filtros"
        description="Tente ampliar o mês ou limpar a construtora e o corretor."
        action={<Button variant="outline" onClick={onClearFilters}>Limpar filtros</Button>}
      />
    ) : (
      <EmptyState
        icon={Inbox}
        title="Nenhum negócio no pipeline"
        description="Converta um lead do funil ou crie o negócio direto por aqui."
        action={<Button onClick={onNewDeal}>Adicionar negócio</Button>}
      />
    );
  }

  return view === "kanban" ? (
    <DealsKanban
      stages={stages}
      deals={deals.filter((deal) => deal.active)}
      onOpen={onOpen}
      onMove={onMove}
    />
  ) : (
    <DealsTable
      deals={deals}
      onOpen={onOpen}
      onStatusChange={onStatusChange}
      onScheduleVisit={onScheduleVisit}
      onLose={onLose}
    />
  );
}
