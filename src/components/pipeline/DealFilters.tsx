import { useId } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { ALL, type DealFilterState } from "./filters";
import { FACEIMOB_STATUSES } from "./statuses";
import type { PipelineStage } from "./stages";

interface Props {
  filters: DealFilterState;
  onChange: (patch: Partial<DealFilterState>) => void;
  onClear: () => void;
  onClose: () => void;
  stages: PipelineStage[];
  developers: { id: string; name: string }[];
  brokers: PersonRecord[];
  managers: PersonRecord[];
  months: string[];
}

/**
 * Painel de filtros do Pipeline.
 *
 * Sem estado próprio: o resultado filtrado é usado pela tabela, pelo kanban e
 * pelo painel de indicadores ao mesmo tempo, então o estado vive um nível acima.
 *
 * Todo campo tem rótulo visível ligado por `htmlFor` (achado X04). Placeholder
 * não é rótulo: some assim que se digita, e o Select passa a mostrar o valor
 * escolhido — quem chegasse depois não tinha como saber o que aquele campo
 * filtra.
 */
export function DealFilters({
  filters, onChange, onClear, onClose, stages, developers, brokers, managers, months,
}: Props) {
  const id = useId();
  const field = (name: string) => `${id}-${name}`;

  return (
    <section className="rounded-2xl border border-border bg-card p-4 lg:w-[520px] lg:flex-shrink-0">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Filtrar negócio</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Fechar filtros">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={field("stage")}>Etapa</Label>
          <Select value={filters.stage} onValueChange={(v) => onChange({ stage: v })}>
            <SelectTrigger id={field("stage")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as etapas</SelectItem>
              {stages.map((stage) => (
                <SelectItem key={stage.id} value={stage.code}>{stage.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("status2")}>Status 2</Label>
          <Select value={filters.status2} onValueChange={(v) => onChange({ status2: v })}>
            <SelectTrigger id={field("status2")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ALL}>Todos os Status 2</SelectItem>
              {FACEIMOB_STATUSES.map((status) => (
                <SelectItem key={status.label} value={status.label}>{status.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("review")}>Conferência documental</Label>
          <Select value={filters.documentReview} onValueChange={(v) => onChange({ documentReview: v })}>
            <SelectTrigger id={field("review")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as conferências</SelectItem>
              <SelectItem value="draft">Em preparação</SelectItem>
              <SelectItem value="pending">Aguardando gerente</SelectItem>
              <SelectItem value="returned">Devolvido para correção</SelectItem>
              <SelectItem value="approved">Conferido</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("month")}>Mês-base</Label>
          <Select value={filters.month} onValueChange={(v) => onChange({ month: v })}>
            <SelectTrigger id={field("month")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ALL}>Todos os meses</SelectItem>
              {months.map((month) => <SelectItem key={month} value={month}>{month}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("developer")}>Construtora</Label>
          <Select value={filters.developerId} onValueChange={(v) => onChange({ developerId: v })}>
            <SelectTrigger id={field("developer")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as construtoras</SelectItem>
              {developers.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("manager")}>Gerente</Label>
          <Select value={filters.managerId} onValueChange={(v) => onChange({ managerId: v })}>
            <SelectTrigger id={field("manager")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ALL}>Todos os gerentes</SelectItem>
              {managers.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("broker")}>Corretor</Label>
          <Select value={filters.brokerId} onValueChange={(v) => onChange({ brokerId: v })}>
            <SelectTrigger id={field("broker")} className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={ALL}>Todos os corretores</SelectItem>
              {brokers.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor={field("client")}>Nome do cliente</Label>
          <Input id={field("client")} className="mt-1" value={filters.client}
                 onChange={(e) => onChange({ client: e.target.value })} />
        </div>

        <div>
          <Label htmlFor={field("client2")}>Nome do 2º cliente</Label>
          <Input id={field("client2")} className="mt-1" value={filters.client2}
                 onChange={(e) => onChange({ client2: e.target.value })} />
        </div>

        <div>
          <Label htmlFor={field("cpf")}>CPF do cliente</Label>
          <Input id={field("cpf")} className="mt-1" inputMode="numeric" value={filters.cpf}
                 onChange={(e) => onChange({ cpf: e.target.value })} />
        </div>

        <div>
          <Label htmlFor={field("cpf2")}>CPF do 2º cliente</Label>
          <Input id={field("cpf2")} className="mt-1" inputMode="numeric" value={filters.cpf2}
                 onChange={(e) => onChange({ cpf2: e.target.value })} />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X className="mr-1 h-3 w-3" /> Limpar filtros
        </Button>
      </div>
    </section>
  );
}
