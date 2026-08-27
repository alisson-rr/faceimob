import { useId } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STATUSES, type LeadSource } from "@/integrations/supabase/leads";
import type { LeadFilterState } from "./model";

/**
 * Busca e filtros. Os três campos têm rótulo — visível no caso da busca via
 * `aria-label`, porque o placeholder some assim que o corretor digita e o
 * leitor de tela fica sem nome nenhum para o campo (X04).
 */
export function LeadFilters({
  filters, onChange, sources,
}: {
  filters: LeadFilterState;
  onChange: (next: LeadFilterState) => void;
  sources: LeadSource[];
}) {
  const searchId = useId();
  const statusId = useId();
  const sourceId = useId();

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <label htmlFor={searchId} className="sr-only">Buscar lead</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={searchId}
          className="pl-10"
          placeholder="Buscar por nome, e-mail, telefone ou campanha…"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
        />
      </div>

      <div className="sm:w-52">
        <label htmlFor={statusId} className="sr-only">Filtrar por status</label>
        <Select value={filters.status} onValueChange={(status) => onChange({ ...filters, status })}>
          <SelectTrigger id={statusId}><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {LEAD_STATUSES.map((status) => (
              <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="sm:w-48">
        <label htmlFor={sourceId} className="sr-only">Filtrar por origem</label>
        <Select value={filters.source} onValueChange={(source) => onChange({ ...filters, source })}>
          <SelectTrigger id={sourceId}><SelectValue placeholder="Origem" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            {sources.map((source) => (
              <SelectItem key={source.id} value={source.id}>{source.label}</SelectItem>
            ))}
            <SelectItem value="none">Sem origem</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
