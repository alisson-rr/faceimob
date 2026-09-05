import { useId } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STATUSES, type DistributionGroup, type LeadSource } from "@/integrations/supabase/leads";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import type { LeadFilterState } from "./model";

/**
 * Busca e filtros. Os campos têm rótulo — visível no caso da busca via
 * `aria-label`, porque o placeholder some assim que o corretor digita e o
 * leitor de tela fica sem nome nenhum para o campo (X04).
 *
 * Corretor e grupo só aparecem para quem tem mais de uma opção para escolher:
 * o corretor comum vê apenas os próprios leads (RLS), e um select com um item
 * só é ruído. É a mesma razão de "Sem corretor" existir — para o gestor, "na
 * fila" é um recorte de verdade.
 */
export function LeadFilters({
  filters, onChange, sources, brokers = [], groups = [],
}: {
  filters: LeadFilterState;
  onChange: (next: LeadFilterState) => void;
  sources: LeadSource[];
  /** Corretores que este usuário alcança; vazio esconde o filtro. */
  brokers?: PersonRecord[];
  groups?: DistributionGroup[];
}) {
  const searchId = useId();
  const statusId = useId();
  const sourceId = useId();
  const brokerId = useId();
  const groupId = useId();

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <div className="relative min-w-[200px] flex-1">
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

      {brokers.length > 0 && (
        <div className="sm:w-48">
          <label htmlFor={brokerId} className="sr-only">Filtrar por corretor</label>
          <Select value={filters.broker} onValueChange={(broker) => onChange({ ...filters, broker })}>
            <SelectTrigger id={brokerId}><SelectValue placeholder="Corretor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os corretores</SelectItem>
              {brokers.map((broker) => (
                <SelectItem key={broker.id} value={broker.id}>{broker.name}</SelectItem>
              ))}
              <SelectItem value="none">Sem corretor (na fila)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {groups.length > 1 && (
        <div className="sm:w-48">
          <label htmlFor={groupId} className="sr-only">Filtrar por grupo de distribuição</label>
          <Select value={filters.group} onValueChange={(group) => onChange({ ...filters, group })}>
            <SelectTrigger id={groupId}><SelectValue placeholder="Grupo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os grupos</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
              ))}
              <SelectItem value="none">Sem grupo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
