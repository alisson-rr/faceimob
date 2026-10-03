import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { dateTime, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";

// RPCs da 0210, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type Linha = {
  profile_id: string;
  full_name: string;
  recebidos: number;
  atendidos: number;
  perdidos: number;
  realocados: number;
  resposta_media_seg: number | null;
  prazo_min_seg: number | null;
  prazo_max_seg: number | null;
};

type Perda = {
  lead_id: string;
  cliente: string;
  roleta: string | null;
  recebido_em: string;
  prazo_em: string;
  perdido_em: string;
  prazo_seg: number;
};

/** "AAAA-MM-DD" no fuso de São Paulo. */
const diaSP = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const minutos = (seg: number | null | undefined) => {
  if (seg == null) return "—";
  const m = seg / 60;
  return `${Number.isInteger(m) ? m : m.toFixed(1).replace(".", ",")} min`;
};

/**
 * Relatório da roleta (pedido de 03/10/2026): quantos leads cada corretor
 * pegou, atendeu e perdeu no prazo, e — por perda — quando chegou, o prazo que
 * valeu e quando saiu. É o que responde "quantos eu perdi?" e "perdi antes dos
 * 10 minutos?". Alcance pela 0210: admin vê todos, gestor a equipe, corretor a
 * si mesmo.
 */
export default function RelatorioRoleta() {
  const id = useId();
  const hoje = diaSP(new Date());
  const [inicio, setInicio] = useState(`${hoje.slice(0, 8)}01`);
  const [fim, setFim] = useState(hoje);
  const [aberto, setAberto] = useState<Linha | null>(null);
  const periodoValido = Boolean(inicio && fim && inicio <= fim);

  const relatorio = useQuery({
    queryKey: ["leads", "relatorio-roleta", inicio, fim],
    queryFn: async (): Promise<Linha[]> => {
      const { data, error } = await untyped.rpc("relatorio_da_roleta", { p_inicio: inicio, p_fim: fim });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
    enabled: periodoValido,
  });

  const perdas = useQuery({
    queryKey: ["leads", "perdas-roleta", aberto?.profile_id, inicio, fim],
    queryFn: async (): Promise<Perda[]> => {
      const { data, error } = await untyped.rpc("perdas_na_roleta", {
        p_profile: aberto?.profile_id, p_inicio: inicio, p_fim: fim,
      });
      if (error) throw error;
      return (data ?? []) as Perda[];
    },
    enabled: Boolean(aberto) && periodoValido,
  });

  const linhas = relatorio.data ?? [];
  const total = linhas.reduce(
    (t, l) => ({ recebidos: t.recebidos + l.recebidos, perdidos: t.perdidos + l.perdidos }),
    { recebidos: 0, perdidos: 0 },
  );

  return (
    <div className="space-y-6">
      <Link to="/leads" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Leads
      </Link>
      <PageHeader
        icon={Timer}
        eyebrow="Operação"
        title="Roleta por corretor"
        description="Leads que cada corretor recebeu, atendeu e perdeu no prazo. Clique no corretor para ver cada perda."
      />

      <Card className="flex flex-wrap items-end gap-4 p-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-inicio`}>De</Label>
          <Input id={`${id}-inicio`} type="date" value={inicio} max={fim} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-fim`}>Até</Label>
          <Input id={`${id}-fim`} type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} />
        </div>
        {relatorio.data && (
          <p className="text-sm text-muted-foreground">
            {num(total.recebidos)} entregas da roleta · {num(total.perdidos)} perdidas no prazo
          </p>
        )}
      </Card>

      {!periodoValido ? (
        <p role="alert" className="text-sm text-destructive">Escolha um período com início antes do fim.</p>
      ) : relatorio.isError ? (
        <p role="alert" className="text-sm text-destructive">{describeError(relatorio.error, "Não consegui carregar o relatório.")}</p>
      ) : relatorio.isPending ? (
        <LoadingState variant="block" rows={3} label="Carregando o relatório…" />
      ) : linhas.length === 0 ? (
        <EmptyState icon={Timer} title="Nenhum lead da roleta no período" description="Mude as datas para ver outro período." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="p-3 font-medium">Corretor</th>
                <th scope="col" className="p-3 text-right font-medium">Recebidos</th>
                <th scope="col" className="p-3 text-right font-medium">Atendidos</th>
                <th scope="col" className="p-3 text-right font-medium">Perdidos no prazo</th>
                <th scope="col" className="p-3 text-right font-medium">Realocados</th>
                <th scope="col" className="p-3 text-right font-medium">Resposta média</th>
                <th scope="col" className="p-3 text-right font-medium">Prazo que valeu</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.profile_id} className="border-b border-border last:border-0">
                  <th scope="row" className="p-3 text-left font-medium">
                    <button type="button" className="text-left hover:text-primary hover:underline" onClick={() => setAberto(l)}>
                      {l.full_name}
                    </button>
                  </th>
                  <td className="p-3 text-right tabular-nums">{num(l.recebidos)}</td>
                  <td className="p-3 text-right tabular-nums">{num(l.atendidos)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {l.perdidos > 0 ? <StatusBadge tone="danger">{num(l.perdidos)}</StatusBadge> : "0"}
                  </td>
                  <td className="p-3 text-right tabular-nums">{num(l.realocados)}</td>
                  <td className="p-3 text-right tabular-nums">{minutos(l.resposta_media_seg)}</td>
                  <td className="p-3 text-right tabular-nums">
                    {l.prazo_min_seg === l.prazo_max_seg
                      ? minutos(l.prazo_min_seg)
                      : `${minutos(l.prazo_min_seg)} a ${minutos(l.prazo_max_seg)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog open={Boolean(aberto)} onOpenChange={(o) => { if (!o) setAberto(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Leads perdidos no prazo · {aberto?.full_name}</DialogTitle>
            <DialogDescription>
              {aberto ? `${num(aberto.perdidos)} de ${num(aberto.recebidos)} recebidos no período.` : ""} O prazo é o
              tempo que o corretor tinha para clicar em "Atender".
            </DialogDescription>
          </DialogHeader>
          {perdas.isError ? (
            <p role="alert" className="text-sm text-destructive">{describeError(perdas.error, "Não consegui carregar as perdas.")}</p>
          ) : perdas.isPending ? (
            <LoadingState variant="list" rows={3} label="Carregando…" />
          ) : (perdas.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead perdido no período.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto text-sm">
              {(perdas.data ?? []).map((p) => (
                <li key={`${p.lead_id}-${p.recebido_em}`} className="py-2">
                  <p className="font-medium">{p.cliente}{p.roleta ? <span className="text-muted-foreground"> · {p.roleta}</span> : null}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    Chegou {dateTime(p.recebido_em)} · prazo de {minutos(p.prazo_seg)} · saiu {dateTime(p.perdido_em)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
