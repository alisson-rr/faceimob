import { BarChart3, FileCheck2, LayoutGrid, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  search: string;
  onSearch: (value: string) => void;
  view: "table" | "kanban";
  onView: (view: "table" | "kanban") => void;
  analyticsOpen: boolean;
  onToggleAnalytics: () => void;
  activeCount: number;
  listedCount: number;
  pendingReviews: number;
  onFilterPendingReviews: () => void;
}

/** Busca, alternância de visão e a régua de contadores do Pipeline. */
export function DealsToolbar({
  search, onSearch, view, onView, analyticsOpen, onToggleAnalytics,
  activeCount, listedCount, pendingReviews, onFilterPendingReviews,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Buscar negócio"
            placeholder="Buscar cliente, empreendimento, corretor…"
            className="h-9 pl-10"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>

        <div className="flex flex-shrink-0 overflow-hidden rounded-full border border-border">
          <Button
            variant="ghost" size="icon" aria-label="Ver em tabela" aria-pressed={view === "table"}
            className={cn("h-9 w-9 rounded-none", view === "table" && "bg-primary text-primary-foreground")}
            onClick={() => onView("table")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost" size="icon" aria-label="Ver em kanban" aria-pressed={view === "kanban"}
            className={cn("h-9 w-9 rounded-none", view === "kanban" && "bg-primary text-primary-foreground")}
            onClick={() => onView("kanban")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>

        <Button
          variant="outline" size="icon" className="h-9 w-9 flex-shrink-0 sm:w-auto sm:px-3"
          aria-label="Indicadores" aria-pressed={analyticsOpen} onClick={onToggleAnalytics}
        >
          <BarChart3 className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Indicadores</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><strong className="tabular-nums text-primary">{activeCount}</strong> ativos</span>
        <span aria-hidden>·</span>
        <span><strong className="tabular-nums text-foreground">{listedCount}</strong> na listagem</span>
        <button
          type="button"
          onClick={onFilterPendingReviews}
          className="inline-flex items-center gap-1 rounded transition-colors hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileCheck2 className="h-3 w-3" aria-hidden />
          <strong className="tabular-nums text-warning">{pendingReviews}</strong> aguardando gerente
        </button>
      </div>
    </div>
  );
}
