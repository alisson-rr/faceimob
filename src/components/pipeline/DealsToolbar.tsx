import { useId } from "react";
import { BarChart3, FileCheck2, LayoutGrid, List, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Período de criação do negócio (`deals.created_at`), AAAA-MM-DD, `to` inclusivo. */
export type DealPeriod = { from: string; to: string };

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
  /** O período que o banco devolve. Mudar aqui refaz a consulta. */
  period: DealPeriod;
  onPeriod: (period: DealPeriod) => void;
  onLast30Days: () => void;
  /** Data apagada, pela metade ou início depois do fim: a lista não é consultada. */
  periodIncomplete?: boolean;
  /** Consulta ainda em voo ou falhada: os contadores viram travessão. Com `0`
   *  a régua AFIRMA "0 ativos · 0 aguardando gerente" antes de ler o banco —
   *  o mesmo achado que o `DealsBoard` corrigiu um nível abaixo. */
  countsUnknown?: boolean;
}

/** Busca, período, alternância de visão e a régua de contadores do Pipeline. */
export function DealsToolbar({
  search, onSearch, view, onView, analyticsOpen, onToggleAnalytics,
  activeCount, listedCount, pendingReviews, onFilterPendingReviews,
  period, onPeriod, onLast30Days, periodIncomplete, countsUnknown,
}: Props) {
  const id = useId();
  const conta = (value: number) => (countsUnknown ? "—" : value);
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

      {/* À vista, e não no painel de filtros fechado: é o período que decide o
          que o banco devolve, e a lista inteira depende dele. */}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`${id}-de`} className="text-xs text-muted-foreground">Criado de</Label>
          <Input
            id={`${id}-de`} type="date" className="mt-1 h-9 w-[9.5rem]"
            value={period.from} max={period.to || undefined}
            onChange={(event) => onPeriod({ ...period, from: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor={`${id}-ate`} className="text-xs text-muted-foreground">Até</Label>
          <Input
            id={`${id}-ate`} type="date" className="mt-1 h-9 w-[9.5rem]"
            value={period.to} min={period.from || undefined}
            onChange={(event) => onPeriod({ ...period, to: event.target.value })}
          />
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={onLast30Days}>
          Últimos 30 dias
        </Button>
      </div>
      {periodIncomplete && (
        <p role="alert" className="text-xs text-destructive">
          Preencha as duas datas, com o início antes do fim.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><strong className="tabular-nums text-primary">{conta(activeCount)}</strong> ativos</span>
        <span aria-hidden>·</span>
        <span><strong className="tabular-nums text-foreground">{conta(listedCount)}</strong> na listagem</span>
        {/* Filtrar por "aguardando gerente" sem saber quantos são levaria a uma
            listagem vazia sem explicação: o botão espera a resposta. */}
        <button
          type="button"
          onClick={onFilterPendingReviews}
          disabled={countsUnknown}
          className="inline-flex items-center gap-1 rounded transition-colors hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileCheck2 className="h-3 w-3" aria-hidden />
          <strong className="tabular-nums text-warning">{conta(pendingReviews)}</strong> aguardando gerente
        </button>
      </div>
    </div>
  );
}
