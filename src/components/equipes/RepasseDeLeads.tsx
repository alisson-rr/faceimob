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
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { listSelectableBrokers } from "@/integrations/supabase/newSchema";
import { describeError } from "@/lib/supabaseError";

// RPCs da 0343, ainda fora do `types.ts` gerado.
const untyped = supabase as unknown as SupabaseClient;

type LeadDeInativo = {
  lead_id: string; cliente: string | null; telefone: string | null; campanha: string | null; status: string;
  criado_em: string; corretor_id: string; corretor_nome: string; corretor_status: string;
};

const SITUACAO: Record<string, string> = { terminated: "desligado", suspended: "suspenso" };
const STATUS_LEAD: Record<string, string> = { assigned: "aguardando contato", attending: "em atendimento", in_progress: "em andamento" };

/**
 * Repasse de leads de quem saiu (pedido de 18/11/2026), no mesmo molde do
 * repasse de negócios: os leads em atendimento de cada corretor inativo, para
 * escolher um corretor ativo e passar de uma vez. A regra está em
 * `repassar_leads` (0343), que usa o `reassign_lead` de sempre.
 */
export function RepasseDeLeads() {
  const leads = useQuery({
    queryKey: ["repasse", "leads-de-inativos"],
    queryFn: async (): Promise<LeadDeInativo[]> => {
      const { data, error } = await untyped.rpc("leads_de_corretores_inativos");
      if (error) throw error;
      return Array.isArray(data) ? (data as LeadDeInativo[]) : [];
    },
  });
  const ativos = useQuery({ queryKey: ["repasse", "corretores-ativos"], queryFn: listSelectableBrokers });

  const porCorretor = useMemo(() => {
    const grupos = new Map<string, { nome: string; status: string; leads: LeadDeInativo[] }>();
    for (const l of leads.data ?? []) {
      const g = grupos.get(l.corretor_id) ?? { nome: l.corretor_nome, status: l.corretor_status, leads: [] };
      g.leads.push(l);
      grupos.set(l.corretor_id, g);
    }
    return [...grupos.entries()];
  }, [leads.data]);

  if (leads.isPending) return <LoadingState variant="list" rows={3} label="Carregando leads de corretores inativos…" />;
  if (leads.isError) {
    return <p className="text-sm text-destructive">{describeError(leads.error, "Não consegui carregar os leads.")}</p>;
  }
  if (porCorretor.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum corretor desligado ou suspenso tem lead em atendimento.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Leads <b>em atendimento</b> de quem está desligado ou suspenso. O lead vai direto para o corretor escolhido, sem
        cronômetro de atendimento, e o repasse fica no histórico do lead.
      </p>
      {porCorretor.map(([id, grupo]) => (
        <GrupoDoCorretor key={id} corretorId={id} {...grupo} ativos={ativos.data ?? []} />
      ))}
    </div>
  );
}

function GrupoDoCorretor({ corretorId, nome, status, leads, ativos }: {
  corretorId: string; nome: string; status: string; leads: LeadDeInativo[];
  ativos: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  // Começa sem nenhum marcado (18/11/2026): passar a carteira inteira de uma
  // vez sobrecarregava quem recebe. Escolhe-se quantos, ou um a um.
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  const [quantos, setQuantos] = useState("");
  const [destino, setDestino] = useState<string>("");
  const [confirmando, setConfirmando] = useState(false);
  const nomeDestino = ativos.find((a) => a.id === destino)?.name ?? "";
  const escolhidos = leads.filter((l) => marcados.has(l.lead_id));
  const todos = escolhidos.length === leads.length;

  const repassar = useMutation({
    mutationFn: async () => {
      const { data, error } = await untyped.rpc("repassar_leads", {
        p_de: corretorId, p_para: destino, p_lead_ids: escolhidos.map((l) => l.lead_id),
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: async (feitos) => {
      setConfirmando(false);
      toast.success(`${feitos} ${feitos === 1 ? "lead passado" : "leads passados"} para ${nomeDestino}`);
      await qc.invalidateQueries({ queryKey: ["repasse"] });
      await qc.invalidateQueries({ queryKey: ["leads"] });
    },
    onError: (e) => toast.error("Não foi possível repassar", { description: describeError(e, "Tente de novo.") }),
  });

  const alternar = (leadId: string, marcar: boolean) =>
    setMarcados((atual) => {
      const novo = new Set(atual);
      if (marcar) novo.add(leadId); else novo.delete(leadId);
      return novo;
    });

  return (
    <Card className="border-border/50">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          {nome}
          <Badge variant="outline">{SITUACAO[status] ?? status}</Badge>
          <span className="text-muted-foreground font-normal">
            {leads.length} {leads.length === 1 ? "lead em atendimento" : "leads em atendimento"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.min(Math.max(Number.parseInt(quantos, 10) || 0, 0), leads.length);
              setMarcados(new Set(leads.slice(0, n).map((l) => l.lead_id)));
            }}
          >
            <label htmlFor={`quantos-${corretorId}`}>Quantos passar</label>
            <Input
              id={`quantos-${corretorId}`} type="number" inputMode="numeric" min={1} max={leads.length}
              className="h-8 w-24 text-xs" placeholder="ex.: 50"
              value={quantos} onChange={(e) => setQuantos(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" className="h-8 text-xs" disabled={!quantos}>
              Marcar os primeiros
            </Button>
          </form>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={todos && leads.length > 0}
              onCheckedChange={(v) => setMarcados(v === true ? new Set(leads.map((l) => l.lead_id)) : new Set())}
            />
            Marcar todos
          </label>
          <span className="tabular-nums">{escolhidos.length} de {leads.length} marcados</span>
        </div>
        <ul className="max-h-80 divide-y divide-border/40 overflow-y-auto rounded-md border border-border/40">
          {leads.map((l) => (
            <li key={l.lead_id} className="flex items-start gap-3 p-2 text-sm">
              <Checkbox
                id={`repasse-lead-${l.lead_id}`} className="mt-0.5"
                checked={marcados.has(l.lead_id)}
                onCheckedChange={(v) => alternar(l.lead_id, v === true)}
              />
              <label htmlFor={`repasse-lead-${l.lead_id}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="font-medium">{l.cliente || "Lead sem nome"}</span>
                {l.telefone && <span className="text-muted-foreground"> · {l.telefone}</span>}
                <span className="block text-xs text-muted-foreground">
                  {[l.campanha, STATUS_LEAD[l.status] ?? l.status, new Date(l.criado_em).toLocaleDateString("pt-BR")]
                    .filter(Boolean).join(" · ")}
                </span>
              </label>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={destino} onValueChange={setDestino}>
            <SelectTrigger className="w-64" aria-label={`Corretor ativo que recebe os leads de ${nome}`}>
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
            Repassar {escolhidos.length} {escolhidos.length === 1 ? "lead" : "leads"}
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmando} onOpenChange={(aberto) => { if (!repassar.isPending) setConfirmando(aberto); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Passar {escolhidos.length} {escolhidos.length === 1 ? "lead" : "leads"} para {nomeDestino}?</AlertDialogTitle>
            <AlertDialogDescription>
              Os leads saem da carteira de {nome} e vão direto para {nomeDestino}, sem cronômetro. Para desfazer, é
              preciso repassar cada lead de novo pela ficha.
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
