import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, num } from "@/lib/format";
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { pct } from "./filters";
import { funnelStages, stageSurface, type PipelineStage } from "./stages";

interface Props {
  deals: LegacyDealRecord[];
  stages: PipelineStage[];
}

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border bg-card p-4">
    <h3 className="text-eyebrow mb-3">{title}</h3>
    <div className="space-y-2">{children}</div>
  </section>
);

/**
 * Painel lateral de indicadores. Fora do `Pipeline.tsx` porque é leitura pura —
 * não escreve nada e não precisa de nenhum dos estados da tela.
 */
export function PipelineAnalytics({ deals, stages }: Props) {
  const active = deals.filter((deal) => deal.active);
  const columns = funnelStages(stages);
  const countIn = (code: string) => active.filter((deal) => deal.stage === code).length;

  const vgv = active.reduce((total, deal) => total + (deal.deal_value || 0), 0);
  const closed = deals.filter((deal) => deal.stage === "closed").length;
  const avgTicket = active.length ? vgv / active.length : 0;
  const avgDays = active.length
    ? active.reduce((total, deal) => total + deal.days_in_pipeline, 0) / active.length
    : 0;
  // `active` já contém os fechados (`active` é "não perdido nem cancelado"),
  // então somar `closed` ao denominador contava cada venda duas vezes e a taxa
  // saía sempre menor que a real (9 de 30 virava 23,1% em vez de 30%).
  const closeRate = active.length ? (closed / active.length) * 100 : 0;

  const byBroker = [...active.reduce((map, deal) => {
    const name = deal.broker1 || "Sem corretor";
    map.set(name, (map.get(name) ?? 0) + 1);
    return map;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="w-full space-y-3 lg:w-64 lg:flex-shrink-0">
      <Panel title="Conversão por etapa">
        {columns.slice(0, -1).map((stage, index) => {
          const current = countIn(stage.code);
          const next = countIn(columns[index + 1]?.code ?? "");
          const rate = current > 0 ? Math.round((next / current) * 100) : 0;
          return (
            <div key={stage.id} className="flex items-center gap-2">
              <span className={cn("h-2 w-2 rounded-full", stageSurface(stage.code).dot)} aria-hidden />
              <span className="flex-1 truncate text-xs">{stage.label}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden />
              <span className="text-xs tabular-nums text-muted-foreground">{rate}%</span>
            </div>
          );
        })}
      </Panel>

      <Panel title="Negócios por corretor">
        {byBroker.length === 0 && <p className="text-xs text-muted-foreground">Sem negócios ativos.</p>}
        {byBroker.map(([name, count]) => (
          <div key={name} className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/20 text-xs font-bold text-primary" aria-hidden>
              {name.charAt(0)}
            </span>
            <span className="flex-1 truncate text-xs">{name}</span>
            <span className="text-xs font-bold tabular-nums text-primary">{count}</span>
          </div>
        ))}
      </Panel>

      <Panel title="Indicadores">
        <div><p className="text-xs text-muted-foreground">Ticket médio</p><p className="text-sm font-bold tabular-nums">{brl(avgTicket)}</p></div>
        <div><p className="text-xs text-muted-foreground">Tempo médio</p><p className="text-sm font-bold tabular-nums">{num(Math.round(avgDays))} dias</p></div>
        <div><p className="text-xs text-muted-foreground">Taxa de fechamento</p><p className="text-sm font-bold tabular-nums">{pct(closeRate)}</p></div>
      </Panel>
    </div>
  );
}
