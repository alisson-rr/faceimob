import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/shared";
import { brl, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import { atribuicaoSuspeita, listQualidadePorCampanha, percentual } from "@/integrations/supabase/qualidadeCampanha";

const JANELAS = [7, 30, 90] as const;

const pct = (parte: number, total: number) => {
  const p = percentual(parte, total);
  return p === null ? "—" : `${p}%`;
};

/**
 * Qualidade por campanha (0267): o leitor vê quanto cada campanha gastou e
 * até onde os leads dela chegaram. A medida de qualidade é a análise de
 * crédito; "qualificados" (entregues pelo robô) é a leitura rápida.
 */
export function QualidadePorCampanha() {
  const [dias, setDias] = useState<number>(30);
  const lista = useQuery({
    queryKey: ["qualidade-por-campanha", dias],
    queryFn: () => listQualidadePorCampanha(dias),
  });
  const campanhas = lista.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Leads criados na janela e o que aconteceu com eles depois. Qualificado = o robô entregou ao grupo.
          Análise = entrou na esteira de crédito. Candidatos a corretor ficam de fora.
        </p>
        <Select value={String(dias)} onValueChange={(v) => setDias(Number(v))}>
          <SelectTrigger className="h-8 w-40" aria-label="Janela"><SelectValue /></SelectTrigger>
          <SelectContent>
            {JANELAS.map((d) => <SelectItem key={d} value={String(d)}>Últimos {d} dias</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {lista.isPending && <LoadingState variant="list" rows={4} label="Calculando a qualidade das campanhas…" />}
      {lista.isError && (
        <p className="text-sm text-destructive">{describeError(lista.error, "Não foi possível carregar a qualidade das campanhas.")}</p>
      )}
      {!lista.isPending && !lista.isError && campanhas.length === 0 && (
        <EmptyState title="Sem campanhas na janela" description="Nenhum gasto nem lead de campanha nesse período." />
      )}

      {campanhas.length > 0 && (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campanha</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">CPL</TableHead>
                <TableHead className="text-right">Atendidos</TableHead>
                <TableHead className="text-right">Qualificados</TableHead>
                <TableHead className="text-right">Em análise</TableHead>
                <TableHead className="text-right">Aprovadas</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campanhas.map((c) => (
                <TableRow key={c.campaign_id ?? "sem-campanha"}>
                  <TableCell className="max-w-64">
                    <p className="truncate font-medium">{c.campanha}</p>
                    {atribuicaoSuspeita(c) && (
                      <Badge variant="outline" className="mt-1 gap-1 border-warning/40 text-warning">
                        <AlertTriangle className="h-3 w-3" /> conferir atribuição ({c.nomes_distintos} nomes · {c.formularios} formulários)
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(c.gasto)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.leads)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(c.cpl)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.atendidos)} <span className="text-xs text-muted-foreground">{pct(c.atendidos, c.leads)}</span></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num(c.qualificados)} <span className="text-xs text-muted-foreground">{pct(c.qualificados, c.leads)}</span>
                    {c.custo_qualificado !== null && <p className="text-xs text-muted-foreground">{brl(c.custo_qualificado)} cada</p>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {num(c.em_analise)} <span className="text-xs text-muted-foreground">{pct(c.em_analise, c.leads)}</span>
                    {c.custo_analise !== null && <p className="text-xs text-muted-foreground">{brl(c.custo_analise)} cada</p>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.aprovadas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.vendas)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
