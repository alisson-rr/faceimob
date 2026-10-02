import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import type { LeadRecord } from "@/integrations/supabase/leads";
import { num } from "@/lib/format";
import { LeadsSummary } from "./LeadsSummary";
import { leadsPorPeriodo, type LeadMetrics } from "./model";

/**
 * Leads de hoje, da semana e do mês, o "Ver por corretor" e a régua de KPIs.
 * Mesmo bloco na tela de Leads e na aba Leads do Pipeline: `leads` já chega
 * recortado pelo corretor escolhido, para os números falarem dele.
 */
export function LeadsIndicadores({
  leads, metrics, broker, onBroker, brokers, canViewQueue,
}: {
  leads: LeadRecord[];
  metrics: LeadMetrics;
  broker: string;
  onBroker: (broker: string) => void;
  /** Vazio esconde o seletor. */
  brokers: PersonRecord[];
  canViewQueue: boolean;
}) {
  // A base importada da Leadfy (0188) chega com a data original e não é
  // "lead recebido" de hoje nem da semana.
  const porPeriodo = useMemo(
    () => leadsPorPeriodo(leads.filter((lead) => !lead.external_id?.startsWith("leadfy:"))),
    [leads],
  );

  return (
    <>
      <section aria-label="Leads recebidos" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:flex-row lg:items-center">
        <div className="grid flex-1 grid-cols-3 gap-3">
          {([["Hoje", porPeriodo.hoje], ["Esta semana", porPeriodo.semana], ["Este mês", porPeriodo.mes]] as const).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2">
              <p className="text-eyebrow">Leads · {rotulo}</p>
              <p className="text-2xl font-bold tabular-nums">{num(valor)}</p>
            </div>
          ))}
        </div>
        {brokers.length > 0 && (
          <div className="w-full lg:w-64">
            <label htmlFor="leads-corretor" className="text-eyebrow">Ver por corretor</label>
            <Select value={broker} onValueChange={onBroker}>
              <SelectTrigger id="leads-corretor" className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="all">Todos os corretores</SelectItem>
                {canViewQueue && <SelectItem value="none">Sem corretor (fila)</SelectItem>}
                {brokers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      <LeadsSummary metrics={metrics} canViewQueue={canViewQueue} />
    </>
  );
}
