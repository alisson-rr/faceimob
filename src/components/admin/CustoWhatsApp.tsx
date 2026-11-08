import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";
import { describeError } from "@/lib/supabaseError";
import { num } from "@/lib/format";

// RPC da 0323, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type AvisoDoDia = { dia: string; enviados: number; falhas: number; sem_telefone: number; esperando: number };
type CustoDoDia = { dia: string; mensagens: number; cobradas: number; custo: number };
type Custo = { moeda: string | null; dias: CustoDoDia[] };

const PERIODOS = [7, 30, 90] as const;

const dinheiro = (valor: number, moeda: string | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL", maximumFractionDigits: 4 }).format(valor);

const diaCurto = (dia: string) => dia.split("-").reverse().slice(0, 2).join("/");

/**
 * Custo do aviso de lead novo por WhatsApp (pedido de 07/11/2026): o que o CRM
 * mandou (banco) ao lado do que a Meta cobrou (edge `whatsapp-custos`). As duas
 * leituras são independentes: sem a conta do WhatsApp Business cadastrada, a
 * parte do CRM continua aparecendo.
 */
export function CustoWhatsApp() {
  const [dias, setDias] = useState<(typeof PERIODOS)[number]>(30);

  const avisos = useQuery({
    queryKey: ["whatsapp-avisos-por-dia", dias],
    queryFn: async (): Promise<AvisoDoDia[]> => {
      const { data, error } = await untyped.rpc("whatsapp_avisos_por_dia", { p_dias: dias });
      if (error) throw new Error(describeError(error, "Não consegui ler os avisos de WhatsApp."));
      return ((data ?? []) as AvisoDoDia[]).map((l) => ({
        ...l, enviados: Number(l.enviados), falhas: Number(l.falhas),
        sem_telefone: Number(l.sem_telefone), esperando: Number(l.esperando),
      }));
    },
  });

  const custo = useQuery({
    queryKey: ["whatsapp-custos", dias],
    queryFn: async (): Promise<Custo> => {
      const { data, error } = await supabase.functions.invoke("whatsapp-custos", { body: { dias } });
      if (error) throw new Error(await functionErrorMessage(error, "Não consegui ler o custo na Meta."));
      return data as Custo;
    },
    retry: false,
  });

  const linhasAviso = avisos.data ?? [];
  const linhasCusto = custo.data?.dias ?? [];
  const moeda = custo.data?.moeda ?? null;
  const enviados = linhasAviso.reduce((s, l) => s + l.enviados, 0);
  const falhas = linhasAviso.reduce((s, l) => s + l.falhas, 0);
  const semTelefone = linhasAviso.reduce((s, l) => s + l.sem_telefone, 0);
  const custoTotal = linhasCusto.reduce((s, l) => s + l.custo, 0);
  const cobradas = linhasCusto.reduce((s, l) => s + l.cobradas, 0);
  const entregues = linhasCusto.reduce((s, l) => s + l.mensagens, 0);

  const porDia = new Map<string, { aviso?: AvisoDoDia; custo?: CustoDoDia }>();
  for (const l of linhasAviso) porDia.set(l.dia, { ...porDia.get(l.dia), aviso: l });
  for (const l of linhasCusto) porDia.set(l.dia, { ...porDia.get(l.dia), custo: l });
  const diasOrdenados = [...porDia.keys()].sort().reverse();

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
          Custo do aviso de lead por WhatsApp
          <span className="flex gap-1" role="group" aria-label="Período">
            {PERIODOS.map((p) => (
              <Button key={p} size="sm" variant={p === dias ? "default" : "outline"} className="h-7 text-xs"
                aria-pressed={p === dias} onClick={() => setDias(p)}>
                {p} dias
              </Button>
            ))}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Resumo rotulo="Avisos enviados" valor={avisos.isLoading ? "…" : num(enviados)}
            detalhe={falhas || semTelefone ? `${num(falhas)} com falha · ${num(semTelefone)} sem telefone` : "nenhuma falha"} />
          <Resumo rotulo="Entregues (Meta)" valor={custo.data ? num(entregues) : "—"}
            detalhe={custo.data ? `${num(cobradas)} cobradas` : undefined} />
          <Resumo rotulo="Custo no período" valor={custo.data ? dinheiro(custoTotal, moeda) : "—"} />
          <Resumo rotulo="Custo por aviso" valor={custo.data && enviados ? dinheiro(custoTotal / enviados, moeda) : "—"} />
        </dl>

        {avisos.error && <p className="text-xs text-destructive">{(avisos.error as Error).message}</p>}
        {custo.error && <p className="text-xs text-warning">{(custo.error as Error).message}</p>}

        {diasOrdenados.length > 0 && (
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Avisos e custo por dia</caption>
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th scope="col" className="p-2 text-left font-medium">Dia</th>
                  <th scope="col" className="p-2 text-center font-medium">Enviados</th>
                  <th scope="col" className="p-2 text-center font-medium">Falhas</th>
                  <th scope="col" className="p-2 text-center font-medium">Entregues</th>
                  <th scope="col" className="p-2 text-right font-medium">Custo</th>
                </tr>
              </thead>
              <tbody>
                {diasOrdenados.map((dia) => {
                  const { aviso, custo: c } = porDia.get(dia) ?? {};
                  return (
                    <tr key={dia} className="border-b border-border/10">
                      <td className="p-2">{diaCurto(dia)}</td>
                      <td className="p-2 text-center tabular-nums">{aviso?.enviados ?? 0}</td>
                      <td className={`p-2 text-center tabular-nums ${aviso?.falhas ? "text-warning font-semibold" : ""}`}>{aviso?.falhas ?? 0}</td>
                      <td className="p-2 text-center tabular-nums">{c ? c.mensagens : "—"}</td>
                      <td className="p-2 text-right tabular-nums">{c ? dinheiro(c.custo, moeda) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Enviados e falhas vêm do CRM. Entregues e custo vêm da Meta e contam só mensagens de utilidade (o modelo do
          aviso); conversas do SDR e remarketing ficam de fora. A Meta pode levar algumas horas para fechar o dia.
        </p>
      </CardContent>
    </Card>
  );
}

function Resumo({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border border-border/40 p-2">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="text-base font-semibold tabular-nums">{valor}</dd>
      {detalhe && <dd className="text-xs text-muted-foreground">{detalhe}</dd>}
    </div>
  );
}
