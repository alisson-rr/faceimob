import { AlertTriangle, Inbox, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/shared";
import { describeError } from "@/lib/supabaseError";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import type { DealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import { DealsTable } from "./DealsTable";
import { StatusKanban } from "./StatusKanban";

interface Props {
  view: "table" | "kanban";
  /** Negócios já filtrados e ordenados. */
  deals: LegacyDealRecord[];
  /** Colunas do kanban: os Status 2 do cadastro (0164). */
  catalog: DealStatusCatalog;
  /** Status 1 do filtro; `null` = todos. */
  /** Status 1 cujos Status 2 viram colunas; `null` = todos. */
  statusGroupIds: string[] | null;
  isPending: boolean;
  error: unknown;
  filtered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
  onNewDeal: () => void;
  /** Espelha `deals_insert`/`can_edit_deal`. Sem isto o vazio-de-verdade
   *  oferecia "Adicionar negócio" ao sócio — e a tabela e o kanban seguiam
   *  oferecendo mover, trocar status, agendar visita e perder, que o banco
   *  recusa. O cabeçalho dizia "Somente leitura" e a linha dizia o contrário. */
  canWrite: boolean;
  /** Meses congelados (`closed_months`): a linha e o cartão precisam dizer. */
  closedMonths: string[];
  onOpen: (deal: LegacyDealRecord) => void;
  onStatusChange: (deal: LegacyDealRecord, status: string) => void;
  onScheduleVisit: (deal: LegacyDealRecord) => void;
  onLose: (deal: LegacyDealRecord, preset?: string) => void;
  onReopen: (deal: LegacyDealRecord) => void;
  onReactivate?: (deal: LegacyDealRecord) => void;
  currentMonth?: string | null;
  ccaQueuePositions?: ReadonlyMap<string, number>;
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
  view, deals, catalog, statusGroupIds, isPending, error, filtered, canWrite, closedMonths,
  onRetry, onClearFilters, onNewDeal, onOpen, onStatusChange, onScheduleVisit, onLose,
  onReopen, onReactivate, currentMonth, ccaQueuePositions,
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
        description="Tente ampliar o período ou limpar a construtora e o corretor."
        action={<Button variant="outline" onClick={onClearFilters}>Limpar filtros</Button>}
      />
    ) : (
      <EmptyState
        icon={Inbox}
        title="Nenhum negócio criado no período"
        description="Amplie as datas do período, converta um lead do funil ou crie o negócio direto por aqui."
        action={canWrite ? <Button variant="tintSuccess" onClick={onNewDeal}>Adicionar negócio</Button> : undefined}
      />
    );
  }

  return view === "kanban" ? (
    <StatusKanban
      catalog={catalog}
      statusGroupIds={statusGroupIds}
      deals={deals}
      onOpen={onOpen}
      onMoveStatus={onStatusChange}
      onLose={onLose}
      onReactivate={onReactivate}
      currentMonth={currentMonth}
      ccaQueuePositions={ccaQueuePositions}
      canWrite={canWrite}
      closedMonths={closedMonths}
    />
  ) : (
    <DealsTable
      deals={deals}
      ccaQueuePositions={ccaQueuePositions}
      canWrite={canWrite}
      closedMonths={closedMonths}
      onOpen={onOpen}
      onStatusChange={onStatusChange}
      onScheduleVisit={onScheduleVisit}
      onLose={onLose}
      onReopen={onReopen}
    />
  );
}
