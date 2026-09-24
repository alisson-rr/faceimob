import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { brl, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import { ALL_MONTHS, type DealRow } from "./data";
import { buildLeadershipReport, loadLeadershipContext, type LeadershipRow } from "./leadershipData";

export function LeadershipTables({ rows, month }: { rows: LeadershipRow[]; month: string }) {
  return <div className="space-y-4">
    {(["director", "manager"] as const).map(role => {
      const group = rows.filter(row => row.role === role);
      const title = role === "director" ? "Diretores" : "Gerentes";
      return <section key={role} className="rounded-xl border border-primary/30 bg-card p-3">
        <h3 className="mb-3 font-display font-bold">{title}</h3>
        {!group.length ? <p className="text-sm text-muted-foreground">Nenhum {role === "director" ? "diretor" : "gerente"} ativo no seu acesso.</p>
          : <div className="overflow-x-auto" role="region" aria-label={`Relatório de ${title.toLowerCase()}`} tabIndex={0}>
            <table className="w-full min-w-[960px] text-sm">
              <caption className="sr-only">Desempenho de {title.toLowerCase()} — {month === ALL_MONTHS ? "todos os meses" : month}</caption>
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="p-2">Meta<br />Remuneração</th><th scope="col" className="p-2">Meta</th>
                <th scope="col" className="p-2">% batido</th><th scope="col" className="p-2 text-left">{role === "director" ? "Diretor" : "Gerente"}</th>
                <th scope="col" className="bg-primary/15 p-2">Leads</th><th scope="col" className="p-2">Ágil</th>
                <th scope="col" className="p-2" title="Status 2: Virou Negócio / Negócio fechado">Negócio</th>
                <th scope="col" className="bg-success/20 p-2 text-success">Vendas</th><th scope="col" className="bg-success/20 p-2 text-success">VGV</th>
                <th scope="col" className="p-2 text-destructive">Off</th>
              </tr></thead>
              <tbody>{group.map(row => <tr key={row.id} className="border-b border-border/50 text-center tabular-nums last:border-0 odd:bg-secondary/20">
                <td className="p-2">{num(row.compensationGoal)}</td><td className="p-2">{num(row.goal)}</td>
                <td className={cn("p-2 font-semibold", row.reached === null ? "text-muted-foreground" : row.reached >= 100 ? "bg-success/20 text-success" : row.reached >= 50 ? "bg-warning/20 text-warning" : "bg-destructive/15 text-destructive")}>{row.reached === null ? "—" : `${num(Math.round(row.reached))}%`}</td>
                <th scope="row" className="p-2 text-left font-medium">{row.name}</th>
                <td className="bg-primary/10 p-2 font-semibold">{num(row.leads)}</td><td className="p-2">{num(row.agile)}</td><td className="p-2">{num(row.business)}</td>
                <td className={cn("p-2 font-bold", row.sales ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>{num(row.sales)}</td>
                <td className={cn("whitespace-nowrap p-2 font-bold", row.sales ? "bg-success/15 text-success" : "bg-destructive/10 text-destructive")}>{brl(row.vgv, { cents: true })}</td>
                <td className="p-2">{num(row.off)}</td>
              </tr>)}</tbody>
            </table>
          </div>}
      </section>;
    })}
    <p className="text-xs text-muted-foreground">Negócios pelo mês-base e gestores vinculados; leads pela criação e equipe atual. Ágil = Esteira Ágil; Negócio = Virou Negócio ou Negócio fechado; Off = status OFF. Metas não cadastradas aparecem como “—”. {month === ALL_MONTHS && "Selecione um mês para comparar metas."}</p>
  </div>;
}

export function LeadershipReport({ deals, people, month }: { deals: DealRow[]; people: PersonRecord[]; month: string }) {
  const { user } = useAuth();
  const context = useQuery({
    queryKey: ["dashboard", "leadership-report", month, user?.id, people.map(p => [p.id, p.name, p.roles, p.active])],
    queryFn: ({ signal }) => loadLeadershipContext(month, people, signal), enabled: !!user,
  });
  const rows = useMemo(() => context.data ? buildLeadershipReport(deals, context.data, month) : [], [deals, context.data, month]);
  return <SectionCard title="Relatório de diretores e gerentes" description={`Metas, leads e resultados — ${month === ALL_MONTHS ? "todos os meses" : month}`} icon={Users}>
    {context.isError ? <EmptyState icon={AlertTriangle} title="Não consegui carregar o relatório" description={describeError(context.error, "Tente carregar os dados novamente.")} action={<Button onClick={() => void context.refetch()}>Tentar de novo</Button>} />
      : context.isPending ? <LoadingState variant="list" rows={4} label="Carregando o relatório…" /> : <LeadershipTables rows={rows} month={month} />}
  </SectionCard>;
}
