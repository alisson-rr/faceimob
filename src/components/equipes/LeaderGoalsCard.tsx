import { useMemo, useState, type FormEvent } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, LoadingState, SectionCard } from "@/components/shared";
import { usePeople } from "@/components/pipeline/data";
import { supabase } from "@/integrations/supabase/client";
import {
  monthInputToPeriodIso,
  saveLeaderMonthlyGoal,
  validateGoalTarget,
  type LeaderGoalMetric,
} from "@/integrations/supabase/newSchema";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { dbError, describeError } from "@/lib/supabaseError";

const METRICAS: { metric: LeaderGoalMetric; label: string }[] = [
  { metric: "sales_comp", label: "Meta remuneração" },
  { metric: "sales", label: "Meta" },
];

type Chave = `${string}:${LeaderGoalMetric}`;
const chave = (profileId: string, metric: LeaderGoalMetric): Chave => `${profileId}:${metric}`;

/** Vazio apaga a meta do mês; o resto passa pela mesma validação da gravação. */
const lerCampo = (raw: string, metric: LeaderGoalMetric): { valor: number | null; erro: string | null } => {
  if (raw.trim() === "") return { valor: null, erro: null };
  const valor = Number(raw);
  return { valor, erro: validateGoalTarget(metric, valor) };
};

async function carregarMetas(periodIso: string): Promise<Map<Chave, number>> {
  const { data, error } = await supabase
    .from("goals")
    .select("profile_id,metric,target")
    .eq("scope", "profile")
    .eq("period_type", "month")
    .eq("period", periodIso)
    .in("metric", ["sales", "sales_comp"]);
  if (error) throw dbError("goals", error);
  return new Map((data ?? []).flatMap((row) =>
    row.profile_id ? [[chave(row.profile_id, row.metric as LeaderGoalMetric), Number(row.target)] as const] : []));
}

/**
 * Meta e Meta Remuneração de cada diretor e gerente, mês a mês (pedido de
 * 28/09/2026: "preciso inserir todos os meses e podem ser diferentes"). São as
 * duas primeiras colunas do "Relatório de diretores e gerentes" da Visão
 * Geral, que lê `goals` scope 'profile' — sem cadastro ele mostra "—".
 *
 * Quem monta decide quem vê: a `goals_write` aceita admin, e diretor sobre
 * quem ele enxerga — o mesmo `canEdit` da tela de Equipes.
 */
export function LeaderGoalsCard({ recolhivel = false }: { recolhivel?: boolean } = {}) {
  const queryClient = useQueryClient();
  // Meta remuneração só o admin grava (0161, pedido de 29/09/2026). O diretor
  // vê o valor, mas o campo fica só leitura — a policy recusaria de todo jeito.
  const { isAdmin } = useAuth();
  const podeEditar = (metric: LeaderGoalMetric) => metric !== "sales_comp" || isAdmin;
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  // Só o que foi digitado; o valor salvo vem da consulta. Trocar de mês ou
  // salvar zera o rascunho sem sincronizar estado com efeito.
  const [edits, setEdits] = useState<Partial<Record<Chave, string>>>({});
  const [saving, setSaving] = useState(false);

  const periodIso = monthInputToPeriodIso(month);
  const people = usePeople();
  const metas = useQuery({
    queryKey: ["goals", "leaders", periodIso],
    queryFn: periodIso ? () => carregarMetas(periodIso) : skipToken,
  });

  const lideres = useMemo(() => (people.data ?? [])
    .filter((person) => person.active && (person.roles.includes("director") || person.roles.includes("manager")))
    .sort((a, b) => Number(b.roles.includes("director")) - Number(a.roles.includes("director"))
      || a.name.localeCompare(b.name, "pt-BR")), [people.data]);

  const campos = lideres.flatMap((pessoa) => METRICAS.map(({ metric }) => {
    const k = chave(pessoa.id, metric);
    const salvo = metas.data?.get(k) ?? null;
    const raw = podeEditar(metric) ? edits[k] : undefined;
    const lido = raw === undefined ? null : lerCampo(raw, metric);
    return {
      k, pessoa, metric,
      value: raw ?? (salvo === null ? "" : String(salvo)),
      erro: lido?.erro ?? null,
      mudou: lido !== null && !lido.erro && lido.valor !== salvo ? { valor: lido.valor } : null,
    };
  }));
  const pendentes = campos.filter((campo) => campo.mudou);
  const podeSalvar = !!periodIso && metas.isSuccess && pendentes.length > 0 && campos.every((c) => !c.erro) && !saving;

  const salvar = async (event: FormEvent) => {
    event.preventDefault();
    if (!podeSalvar || !periodIso) return;
    setSaving(true);
    try {
      for (const campo of pendentes) {
        await saveLeaderMonthlyGoal(campo.pessoa.id, campo.metric, periodIso, campo.mudou!.valor);
      }
      setEdits({});
      toast({ title: "Metas do mês salvas", variant: "success" });
    } catch (error: unknown) {
      toast({ title: "Não foi possível salvar as metas", description: describeError(error, "Tente de novo em instantes."), variant: "destructive" });
    } finally {
      // Também na falha: o que entrou antes do erro já está no banco.
      await queryClient.invalidateQueries({ queryKey: ["goals", "leaders", periodIso] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "leadership-report"] });
      setSaving(false);
    }
  };

  const carregando = people.isPending || metas.isPending;
  const falha = people.error ?? metas.error;

  return (
    <SectionCard
      title="Metas de diretores e gerentes"
      description={isAdmin
        ? "Meta e Meta remuneração (em vendas) de cada gestor no mês. Aparecem no relatório da Visão Geral; campo vazio = sem meta (—)."
        : "Meta (em vendas) de cada gestor no mês; a Meta remuneração só o administrador define. Campo vazio = sem meta (—)."}
      icon={Target}
      recolhivel={recolhivel}
    >
      <div className="mb-4 flex flex-col items-center gap-1.5">
        <Label htmlFor="meta-lideres-mes" className="text-xs">Mês</Label>
        <Input
          id="meta-lideres-mes" type="month" value={month} className="h-9 w-44"
          onChange={(e) => { setMonth(e.target.value); setEdits({}); }}
          aria-invalid={periodIso === null}
        />
      </div>
      {falha ? (
        <EmptyState
          icon={AlertTriangle} tone="danger" title="Não consegui carregar as metas"
          description={describeError(falha, "Tente carregar de novo.")}
          action={<Button variant="outline" onClick={() => { void people.refetch(); void metas.refetch(); }}>Tentar de novo</Button>}
        />
      ) : carregando && periodIso ? (
        <LoadingState variant="list" rows={4} label="Carregando as metas…" />
      ) : !lideres.length ? (
        <p className="text-sm text-muted-foreground">Nenhum diretor ou gerente ativo no seu acesso.</p>
      ) : (
        <form onSubmit={salvar} aria-label="Metas de diretores e gerentes">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="p-2 text-left">Gestor</th>
                  {METRICAS.map(({ metric, label }) => <th key={metric} scope="col" className="p-2">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {lideres.map((pessoa) => (
                  <tr key={pessoa.id} className="border-b border-border/50 last:border-0">
                    <th scope="row" className="p-2 text-left font-medium">
                      {pessoa.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {pessoa.roles.includes("director") ? "Diretor" : "Gerente"}
                      </span>
                    </th>
                    {METRICAS.map(({ metric, label }) => {
                      const campo = campos.find((c) => c.k === chave(pessoa.id, metric))!;
                      const id = `meta-${pessoa.id}-${metric}`;
                      return (
                        <td key={metric} className="p-2 text-center">
                          <Label htmlFor={id} className="sr-only">{label} de {pessoa.name}</Label>
                          <Input
                            id={id} type="number" min={1} step={1} inputMode="numeric" placeholder="—"
                            className="mx-auto h-9 w-24 text-center tabular-nums"
                            value={campo.value}
                            readOnly={!podeEditar(metric)}
                            title={podeEditar(metric) ? undefined : "Só o administrador define a Meta remuneração"}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [campo.k]: e.target.value }))}
                            aria-invalid={Boolean(campo.erro)}
                            aria-describedby={campo.erro ? `${id}-erro` : undefined}
                          />
                          {campo.erro && <p id={`${id}-erro`} className="mt-1 text-xs text-destructive">{campo.erro}</p>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="submit" disabled={!podeSalvar}>{saving ? "Salvando…" : "Salvar metas do mês"}</Button>
          </div>
        </form>
      )}
    </SectionCard>
  );
}
