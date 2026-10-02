import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { KpiCard, KpiGrid } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dealsForLeader } from "@/components/pipeline/filters";
import type { DealPeriod } from "@/components/pipeline/DealsToolbar";
import type { LegacyDealRecord, PersonRecord } from "@/integrations/supabase/newSchema";
import { brl, num } from "@/lib/format";
import { bareStatus, contaComoVenda } from "@/lib/dealStatus";
import { currentMonthRange } from "@/lib/currentMonthRange";
import { useCurrentSeasonId } from "@/hooks/useGameRanking";
import { listScoredDealIds } from "@/integrations/supabase/game";
import { dealMonth } from "@/components/pipeline/filters";

export type PipelinePanelData = {
  deals: LegacyDealRecord[];
  people: PersonRecord[];
  period: DealPeriod;
  loading: boolean;
  error: boolean;
  onOpen: (deal: LegacyDealRecord) => void;
};

export function ResultadosDoPipeline({ deals, people, loading, error, onOpen }: PipelinePanelData) {
  const { user, roles, isAdmin } = useAuth();
  const [scope, setScope] = useState("all");
  const [limit, setLimit] = useState(20);
  const director = !isAdmin && roles.includes("director");
  const manager = !isAdmin && !director && roles.includes("manager");
  const ownId = user?.id ?? "";
  const monthRange = currentMonthRange();
  const monthLabel = monthRange.from.slice(5, 7) + "/" + monthRange.from.slice(0, 4);
  const monthDeals = deals.filter((deal) => dealMonth(deal) === monthLabel);
  const scoped = isAdmin ? monthDeals
    : director ? dealsForLeader(monthDeals, people, scope === "all" || scope === "own" ? ownId : scope, scope !== "all")
      : manager ? dealsForLeader(monthDeals, people, ownId, true)
        : monthDeals.filter((d) => [d.broker1_id, d.broker2_id, d.broker3_id].includes(ownId));
  const season = useCurrentSeasonId();
  const scored = useQuery({
    queryKey: ["game", "scored-deals", season.data ?? null, ownId, monthRange.from, monthRange.to],
    queryFn: () => listScoredDealIds(season.data as string, ownId, monthRange),
    enabled: Boolean(season.data && ownId),
    staleTime: 30_000,
  });
  // Venda = fechado ou Status 1 VENDA (Em contrato…), a mesma regra da Dashboard.
  const sales = scoped.filter(contaComoVenda);
  const proposals = monthDeals.filter((d) =>
    [d.broker1_id, d.broker2_id, d.broker3_id].includes(ownId)
    && d.outcome === "open"
    && !contaComoVenda(d)
    && scored.data?.has(d.id),
  );
  const vgv = sales.reduce((sum, d) => {
    if (isAdmin || director || manager) return sum + d.deal_value;
    const brokers = [
      { id: d.broker1_id, share: d.broker1_share },
      { id: d.broker2_id, share: d.broker2_share },
      { id: d.broker3_id, share: d.broker3_share },
    ].filter((p) => p.id);
    const share = brokers.find((p) => p.id === ownId)?.share ?? 100 / Math.max(1, brokers.length);
    return sum + d.deal_value * share / 100;
  }, 0);
  const managers = people.filter((p) => p.id !== ownId && p.director_id === ownId && p.roles.includes("manager"));
  const scopeName = isAdmin ? "Empresa" : director ? "Sua diretoria" : manager ? "Sua equipe" : "Seus resultados";
  return <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3" aria-label="Resultados e propostas">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="font-display font-bold">{scopeName}</h3>
        <p className="text-xs text-muted-foreground">Mês vigente · {monthLabel}</p></div>
      {director && <Select value={scope} onValueChange={(v) => { setScope(v); setLimit(20); }}>
        <SelectTrigger className="w-full sm:w-64" aria-label="Gerência do painel"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">Toda a diretoria</SelectItem><SelectItem value="own">Equipe própria</SelectItem>
          {managers.map((m) => <SelectItem key={m.id} value={m.id}>Equipe de {m.name}</SelectItem>)}
        </SelectContent>
      </Select>}
    </div>
    {error || scored.isError ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar os resultados e propostas do game.</p>
      : loading || scored.isPending ? <p role="status" className="text-sm text-muted-foreground">Carregando resultados do mês…</p>
      : <>
        <KpiGrid cols={4}>
          <KpiCard label="Negócios" value={num(scoped.length)} />
          <KpiCard label="Propostas em andamento" value={num(proposals.length)} />
          <KpiCard label="Vendas" value={num(sales.length)} />
          <KpiCard label={isAdmin || director || manager ? "VGV vendido" : "Seu VGV vendido"} value={brl(vgv)} variant="highlight" />
        </KpiGrid>
        <details className="rounded-lg border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">Suas propostas que pontuaram ({proposals.length})</summary>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {proposals.slice(0, limit).map((d) => <button type="button" key={d.id} onClick={() => onOpen(d)}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/30 p-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span><span className="block font-semibold">{d.client}</span><span className="text-muted-foreground">{d.broker1} · {d.project || "Sem empreendimento"}</span></span>
              <span>{bareStatus(d.status)}</span><span className="font-semibold tabular-nums">{brl(d.deal_value)}</span>
            </button>)}
            {!proposals.length && <p className="text-xs text-muted-foreground">Nenhuma proposta sua pontuou no game neste mês.</p>}
            {proposals.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + 20)}>Mostrar mais propostas</Button>}
          </div>
        </details>
      </>}
  </section>;
}
