import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { LegacyDealRecord, PersonRecord } from "@/integrations/supabase/newSchema";
import { cn } from "@/lib/utils";
import { ALL, dealsForLeader } from "./filters";

export function DirectorPipelineCards({ people, deals, selected, onSelect, onPanel, loading, error }: {
  people: PersonRecord[]; deals: LegacyDealRecord[]; selected: string;
  onSelect: (id: string) => void; onPanel: () => void; loading: boolean; error: boolean;
}) {
  const directors = useMemo(() => people.filter((p) => p.active && p.roles.includes("director"))
    .map((p) => ({ ...p, proposals: dealsForLeader(deals, people, p.id).filter((d) => d.outcome === "open").length })), [people, deals]);
  return <section aria-label="Pipeline por diretor" className="rounded-2xl border border-primary/30 bg-card p-4 shadow-md">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display font-bold">Propostas por diretor</h2>
      <div className="flex gap-2">
        {selected !== ALL && <Button variant="outline" size="sm" onClick={() => onSelect(ALL)}>Todos os diretores</Button>}
        <Button variant="ghost" size="sm" onClick={onPanel}>Ver painel</Button>
      </div>
    </div>
    <p className="mb-3 text-xs text-muted-foreground">Propostas em andamento no período selecionado. Clique para abrir o Pipeline da diretoria.</p>
    {error ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar as diretorias e propostas.</p>
      : loading ? <p role="status" className="text-sm text-muted-foreground">Carregando diretorias…</p>
      : directors.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum diretor ativo cadastrado.</p>
      : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {directors.map((p) => <button key={p.id} type="button" aria-pressed={selected === p.id}
          onClick={() => onSelect(p.id)}
          className={cn("flex items-center gap-3 rounded-xl border border-primary/35 bg-gradient-to-br from-primary/15 to-card p-4 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === p.id && "border-primary ring-2 ring-primary/50")}>
          <Avatar><AvatarImage src={p.avatar_url ?? undefined} alt="" /><AvatarFallback>{p.name.slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{p.name}</span><span className="text-xs text-muted-foreground">Diretoria</span></span>
          <span className="text-center"><span className="block text-2xl font-bold tabular-nums text-primary">{p.proposals}</span><span className="text-xs text-muted-foreground">{p.proposals === 1 ? "proposta" : "propostas"}</span></span>
        </button>)}
      </div>}
  </section>;
}
