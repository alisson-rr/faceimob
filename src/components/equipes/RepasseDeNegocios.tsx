import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoadingState } from "@/components/shared";
import { supabase } from "@/integrations/supabase/client";
import { listSelectableBrokers } from "@/integrations/supabase/newSchema";
import { describeError } from "@/lib/supabaseError";
import { brl } from "@/lib/format";

// RPCs da 0327, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type NegocioDeInativo = {
  deal_id: string; code: string | null; cliente: string | null; etapa: string | null; status_detail: string | null;
  vgv: number | null; corretor_id: string; corretor_nome: string; corretor_status: string; outros_corretores: number;
};

const SITUACAO: Record<string, string> = { terminated: "desligado", suspended: "suspenso" };

/**
 * Repasse de carteira (pedido de 10/11/2026): os negócios abertos de cada
 * corretor que saiu, para escolher um corretor ativo e passar de uma vez. A
 * regra (só aberto, rateio, gerente da equipe nova, histórico) está toda em
 * `repassar_negocios`; aqui só se escolhe o quê e para quem.
 */
export function RepasseDeNegocios() {
  const negocios = useQuery({
    queryKey: ["repasse", "negocios-de-inativos"],
    queryFn: async (): Promise<NegocioDeInativo[]> => {
      const { data, error } = await untyped.rpc("negocios_de_corretores_inativos");
      if (error) throw error;
      return (data ?? []) as NegocioDeInativo[];
    },
  });
  const ativos = useQuery({ queryKey: ["repasse", "corretores-ativos"], queryFn: listSelectableBrokers });

  const porCorretor = useMemo(() => {
    const grupos = new Map<string, { nome: string; status: string; negocios: NegocioDeInativo[] }>();
    for (const n of negocios.data ?? []) {
      const g = grupos.get(n.corretor_id) ?? { nome: n.corretor_nome, status: n.corretor_status, negocios: [] };
      g.negocios.push(n);
      grupos.set(n.corretor_id, g);
    }
    return [...grupos.entries()];
  }, [negocios.data]);

  if (negocios.isPending) return <LoadingState variant="list" rows={3} label="Carregando negócios de corretores inativos…" />;
  if (negocios.isError) {
    return <p className="text-sm text-destructive">{describeError(negocios.error, "Não consegui carregar os negócios.")}</p>;
  }
  if (porCorretor.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum corretor desligado ou suspenso tem negócio aberto no pipeline.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Negócios <b>abertos</b> de quem está desligado ou suspenso. Ganhos e perdidos ficam com quem vendeu. O corretor
        novo entra no lugar do antigo no rateio, o gerente passa a ser o da equipe dele e o repasse fica no histórico.
      </p>
      {porCorretor.map(([id, grupo]) => (
        <GrupoDoCorretor key={id} corretorId={id} {...grupo} ativos={ativos.data ?? []} />
      ))}
    </div>
  );
}

function GrupoDoCorretor({ corretorId, nome, status, negocios, ativos }: {
  corretorId: string; nome: string; status: string; negocios: NegocioDeInativo[];
  ativos: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(negocios.map((n) => n.deal_id)));
  const [destino, setDestino] = useState<string>("");
  const [confirmando, setConfirmando] = useState(false);
  const nomeDestino = ativos.find((a) => a.id === destino)?.name ?? "";
  const escolhidos = negocios.filter((n) => marcados.has(n.deal_id));

  const repassar = useMutation({
    mutationFn: async () => {
      const { data, error } = await untyped.rpc("repassar_negocios", {
        p_de: corretorId, p_para: destino, p_deal_ids: escolhidos.map((n) => n.deal_id),
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: async (feitos) => {
      setConfirmando(false);
      toast.success(`${feitos} ${feitos === 1 ? "negócio passado" : "negócios passados"} para ${nomeDestino}`);
      // O Pipeline relê ao abrir; aqui só a lista do repasse precisa voltar.
      await qc.invalidateQueries({ queryKey: ["repasse"] });
    },
    onError: (e) => toast.error("Não foi possível repassar", { description: describeError(e, "Tente de novo.") }),
  });

  const alternar = (dealId: string, marcar: boolean) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (marcar) novo.add(dealId); else novo.delete(dealId);
      return novo;
    });

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          {nome}
          <Badge variant="outline">{SITUACAO[status] ?? status}</Badge>
          <span className="text-muted-foreground font-normal">
            {negocios.length} {negocios.length === 1 ? "negócio aberto" : "negócios abertos"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <ul className="divide-y divide-border/40 rounded-md border border-border/40">
          {negocios.map((n) => (
            <li key={n.deal_id} className="flex items-start gap-3 p-2 text-sm">
              <Checkbox
                id={`repasse-${n.deal_id}`} className="mt-0.5"
                checked={marcados.has(n.deal_id)}
                onCheckedChange={(v) => alternar(n.deal_id, v === true)}
              />
              <label htmlFor={`repasse-${n.deal_id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="font-medium">{n.cliente || "Cliente sem nome"}</span>
                {n.code && <span className="text-muted-foreground"> · {n.code}</span>}
                <span className="block text-xs text-muted-foreground">
                  {[n.etapa, n.status_detail, n.vgv ? brl(n.vgv) : null].filter(Boolean).join(" · ")}
                  {n.outros_corretores > 0 && ` · com mais ${n.outros_corretores} corretor(es)`}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger className="w-64" aria-label={`Corretor ativo que recebe os negócios de ${nome}`}>
              <SelectValue placeholder="Passar para…" />
            </SelectTrigger>
            <SelectContent>
              {ativos.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm" className="gap-1"
            disabled={!destino || escolhidos.length === 0 || repassar.isPending}
            onClick={() => setConfirmando(true)}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden />
            Repassar {escolhidos.length} {escolhidos.length === 1 ? "negócio" : "negócios"}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmando} onOpenChange={(aberto) => { if (!repassar.isPending) setConfirmando(aberto); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Passar {escolhidos.length} {escolhidos.length === 1 ? "negócio" : "negócios"} para {nomeDestino}?</AlertDialogTitle>
            <AlertDialogDescription>
              {nome} sai do rateio desses negócios e {nomeDestino} entra no lugar, com o gerente e o diretor da equipe
              dele. Para desfazer, é preciso trocar o corretor na ficha de cada negócio.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={repassar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={repassar.isPending} onClick={(e) => { e.preventDefault(); repassar.mutate(); }}>
              {repassar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Repassar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
