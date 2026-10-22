import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { contarLeadsRecebidos } from "@/integrations/supabase/leads";
import { num } from "@/lib/format";
import { leadKeys } from "./data";

/**
 * Leads de hoje, da semana e do mês e o "Ver por corretor". A régua de KPIs
 * (total, fila, em atendimento…) saiu em 03/10/2026: ocupava a tela do celular.
 * Mesmo bloco na tela de Leads e na aba Leads do Pipeline. Desde 22/10/2026 a
 * conta sai do banco (`leads_recebidos`, 0299), pelo corretor escolhido, com
 * perdidos e descartados — o total de leads do mês.
 */
export function LeadsIndicadores({
  broker, onBroker, brokers, canViewQueue,
}: {
  broker: string;
  onBroker: (broker: string) => void;
  /** Vazio esconde o seletor. */
  brokers: PersonRecord[];
  canViewQueue: boolean;
}) {
  // Sob `leadKeys.records`: o Realtime de leads já recarrega a conta.
  const recebidos = useQuery({
    queryKey: [...leadKeys.records, "recebidos", broker],
    queryFn: () => contarLeadsRecebidos(broker),
    staleTime: 30_000,
  });
  const porPeriodo = recebidos.data;

  return (
    <>
      <section aria-label="Leads recebidos" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 lg:flex-row lg:items-center">
        <div className="grid flex-1 grid-cols-3 gap-3">
          {([["Hoje", porPeriodo?.hoje], ["Esta semana", porPeriodo?.semana], ["Este mês", porPeriodo?.mes]] as const).map(([rotulo, valor]) => (
            <div key={rotulo} className="rounded-xl border border-primary/25 bg-primary/5 px-2 py-1.5 sm:px-3 sm:py-2">
              <p className="text-eyebrow">Leads · {rotulo}</p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">{valor === undefined ? "…" : num(valor)}</p>
              {/* Detalhe do mês (22/10/2026): descartados em vermelho e o resto em atendimento. */}
              {rotulo === "Este mês" && porPeriodo && (
                <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                  <span className="text-destructive">Descartados {num(porPeriodo.mesDescartados)}</span>
                  {" · "}
                  Em atendimento {num(porPeriodo.mes - porPeriodo.mesDescartados)}
                </p>
              )}
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
    </>
  );
}
