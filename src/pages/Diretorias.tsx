import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, LoadingState, PageHeader } from "@/components/shared";
import { FunilDeVendasPanel } from "@/components/dashboard/FunilDeVendasPanel";
import { agruparPorDiretoria, carregarEquipesPorDiretoria, type Diretoria, type EquipeDaDiretoria, type Numeros } from "@/components/diretorias/data";
import { brl, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { cn } from "@/lib/utils";

/** Mês corrente no calendário de São Paulo, no formato do `<input type="month">`. */
const mesAtual = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);

const COLUNAS: { chave: keyof Numeros; rotulo: string; dinheiro?: boolean }[] = [
  { chave: "leads", rotulo: "Leads" },
  { chave: "legado", rotulo: "Legado" },
  { chave: "proposta", rotulo: "Proposta" },
  { chave: "negocio", rotulo: "Negócio" },
  { chave: "vendas", rotulo: "Vendas" },
  { chave: "vgv", rotulo: "VGV", dinheiro: true },
  { chave: "off", rotulo: "Off" },
];

// Rateio com três corretores dá dízima: uma casa basta (0,3).
const valor = (n: number, dinheiro?: boolean) => (dinheiro ? brl(n, { cents: true }) : num(Math.round(n * 10) / 10));
// Zero em vermelho (pedido de 19/10/2026): quem não produziu salta aos olhos.
const ZERO_EM_VERMELHO = "font-semibold text-destructive";

/**
 * Equipes por diretoria (pedido de 19/10/2026): o funil da diretoria do
 * Dashboard e, embaixo, cada diretoria com as equipes e os números do mês de
 * cada corretor. Admin, sócio e diretor (`menu.diretorias`); o banco recorta o
 * diretor às equipes que ele dirige.
 */
export default function Diretorias() {
  const campo = useId();
  const [mes, setMes] = useState(mesAtual);
  const mesDoBanco = /^\d{4}-\d{2}$/.test(mes) ? `${mes}-01` : `${mesAtual()}-01`;
  const consulta = useQuery({
    queryKey: ["diretorias", mesDoBanco],
    queryFn: () => carregarEquipesPorDiretoria(mesDoBanco),
    staleTime: 60_000,
  });
  const diretorias = useMemo(() => agruparPorDiretoria(consulta.data ?? []), [consulta.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Diretorias"
        icon={Network}
        description="Funil da diretoria e, por equipe, os números do mês de cada corretor."
        actions={(
          <div className="flex items-center gap-2">
            <Label htmlFor={campo} className="text-sm">Mês</Label>
            <Input id={campo} type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-40" />
          </div>
        )}
      />

      <Card className="p-4 sm:p-5">
        <FunilDeVendasPanel month={mesDoBanco} />
      </Card>

      {consulta.isPending ? (
        <LoadingState variant="list" rows={6} label="Carregando as equipes…" />
      ) : consulta.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {describeError(consulta.error, "Não consegui carregar as equipes por diretoria.")}
        </p>
      ) : diretorias.length === 0 ? (
        <EmptyState icon={Network} title="Nenhuma equipe no seu acesso" description="Equipes ativas com diretor aparecem aqui." />
      ) : (
        diretorias.map((d) => <BlocoDaDiretoria key={d.id ?? "sem"} diretoria={d} />)
      )}
    </div>
  );
}

function BlocoDaDiretoria({ diretoria }: { diretoria: Diretoria }) {
  return (
    <section className="space-y-3" aria-label={`Diretoria ${diretoria.nome}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-bold">
          {diretoria.id ? `Diretoria ${diretoria.nome}` : diretoria.nome}
        </h2>
        <dl className="flex flex-wrap gap-2 text-xs">
          <Resumo rotulo="Corretores" texto={num(diretoria.corretores)} />
          {COLUNAS.map((c) => (
            <Resumo key={c.chave} rotulo={c.rotulo} texto={valor(diretoria.total[c.chave], c.dinheiro)} zero={diretoria.total[c.chave] === 0} />
          ))}
        </dl>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {diretoria.equipes.map((e) => <TabelaDaEquipe key={e.id} equipe={e} />)}
      </div>
    </section>
  );
}

function Resumo({ rotulo, texto, zero }: { rotulo: string; texto: string; zero?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className={cn("font-bold tabular-nums", zero && ZERO_EM_VERMELHO)}>{texto}</dd>
    </div>
  );
}

function TabelaDaEquipe({ equipe }: { equipe: EquipeDaDiretoria }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="font-semibold">{equipe.nome}</h3>
        {equipe.gerente && <span className="text-xs text-muted-foreground">Gerente: {equipe.gerente}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Corretores da equipe {equipe.nome} no mês</caption>
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="p-2 text-left">#</th>
              <th scope="col" className="p-2 text-left">Corretor</th>
              {COLUNAS.map((c) => <th key={c.chave} scope="col" className="p-2 text-right">{c.rotulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {equipe.corretores.map((c, i) => (
              <tr key={c.id} className="border-t border-border/60">
                <td className="p-2 tabular-nums text-muted-foreground">{i + 1}º</td>
                <td className="max-w-[12rem] truncate p-2 font-medium" title={c.nome}>{c.nome}</td>
                {COLUNAS.map((col) => (
                  <td
                    key={col.chave}
                    className={cn(
                      "whitespace-nowrap p-2 text-right tabular-nums",
                      c[col.chave] === 0 ? ZERO_EM_VERMELHO : col.chave === "vendas" || col.chave === "vgv" ? "font-bold text-success" : col.chave === "off" ? "text-destructive" : "",
                    )}
                  >
                    {valor(c[col.chave], col.dinheiro)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/30 font-semibold">
            <tr>
              <td className="p-2" colSpan={2}>Total da equipe</td>
              {COLUNAS.map((c) => (
                <td key={c.chave} className={cn("whitespace-nowrap p-2 text-right tabular-nums", equipe.total[c.chave] === 0 && ZERO_EM_VERMELHO)}>
                  {valor(equipe.total[c.chave], c.dinheiro)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}
