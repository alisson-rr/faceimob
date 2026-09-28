import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import type { PersonRecord } from "@/integrations/supabase/newSchema";
import { brl, nomesDeExibicao, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";
import { ALL_MONTHS, type DealRow } from "./data";
import { buildLeadershipReport, loadLeadershipContext, type LeadershipRow } from "./leadershipData";

/**
 * Fundo sólido com texto branco nos destaques (pedido de 28/09/2026, print do
 * sistema anterior). Tons fixos e escuros, não os tokens: o `--success` do
 * escuro é um verde claro onde o branco daria 2:1; estes passam de 4,5:1 com
 * branco nos dois temas.
 */
const SOLIDO = {
  verde: "bg-[#3d7a45] text-white",
  ambar: "bg-[#94702a] text-white",
  vermelho: "bg-[#8e2c2c] text-white",
  azul: "bg-[#2a5288] text-white",
} as const;

export function LeadershipTables({ rows, month }: { rows: LeadershipRow[]; month: string }) {
  return <div className="space-y-4">
    {(["director", "manager"] as const).map(role => {
      const group = rows.filter(row => row.role === role);
      // Primeiro e último nome, sem homônimo na tabela (pedido de 28/09/2026).
      const nome = nomesDeExibicao(group.map(row => row.name));
      const title = role === "director" ? "Diretores" : "Gerentes";
      return <section key={role} className="rounded-xl border border-primary/30 bg-card p-3">
        <h3 className="mb-3 font-display font-bold">{title}</h3>
        {!group.length ? <p className="text-sm text-muted-foreground">Nenhum {role === "director" ? "diretor" : "gerente"} ativo no seu acesso.</p>
          : <div className="overflow-x-auto" role="region" aria-label={`Relatório de ${title.toLowerCase()}`} tabIndex={0}>
            <table className="w-full min-w-[960px] text-sm">
              <caption className="sr-only">Desempenho de {title.toLowerCase()} — {month === ALL_MONTHS ? "todos os meses" : month}</caption>
              {/* Linha de títulos com fundo próprio e texto âmbar, separada das
                  linhas de dado (pedido de 28/09/2026); Vendas e VGV com o verde
                  sólido do print, Off em vermelho. */}
              <thead><tr className="border-b-2 border-gold/60 bg-secondary text-xs font-bold text-gold">
                <th scope="col" className="p-2">Meta<br />Remuneração</th><th scope="col" className="p-2">Meta</th>
                <th scope="col" className="p-2">% batido</th><th scope="col" className="p-2 text-left">{role === "director" ? "Diretor" : "Gerente"}</th>
                <th scope="col" className="p-2">Leads</th><th scope="col" className="p-2">Ágil</th>
                <th scope="col" className="p-2" title="Status 2: Virou Negócio / Negócio fechado">Negócio</th>
                <th scope="col" className={cn("p-2", SOLIDO.verde)}>Vendas</th><th scope="col" className={cn("p-2", SOLIDO.verde)}>VGV</th>
                <th scope="col" className="p-2 text-destructive">Off</th>
              </tr></thead>
              <tbody>{group.map(row => <tr key={row.id} className="border-b border-border/50 text-center tabular-nums last:border-0 odd:bg-secondary/20">
                <td className="p-2">{num(row.compensationGoal)}</td><td className="p-2">{num(row.goal)}</td>
                <td className={cn("p-2 font-bold", row.reached === null ? "text-muted-foreground" : row.reached >= 100 ? SOLIDO.verde : row.reached >= 50 ? SOLIDO.ambar : SOLIDO.vermelho)}>{row.reached === null ? "—" : `${num(Math.round(row.reached))}%`}</td>
                <th scope="row" className="p-2 text-left font-medium">{nome(row.name)}</th>
                <td className={cn("p-2 font-bold", SOLIDO.azul)}>{num(row.leads)}</td><td className="p-2">{num(row.agile)}</td><td className="p-2">{num(row.business)}</td>
                <td className={cn("p-2 font-bold", row.sales ? SOLIDO.verde : SOLIDO.vermelho)}>{num(row.sales)}</td>
                <td className={cn("whitespace-nowrap p-2 font-bold", row.sales ? SOLIDO.verde : SOLIDO.vermelho)}>{brl(row.vgv, { cents: true })}</td>
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
