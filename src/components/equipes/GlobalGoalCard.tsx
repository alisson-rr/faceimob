import { useState, type FormEvent } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, SectionCard } from "@/components/shared";
import { toast } from "@/hooks/use-toast";
import { brl, num } from "@/lib/format";
import { describeError } from "@/lib/supabaseError";
import {
  getGlobalMonthlyGoal,
  monthInputToPeriodIso,
  upsertGlobalMonthlyGoal,
} from "@/integrations/supabase/newSchema";

type Metric = "sales" | "vgv";

const FIELDS: { metric: Metric; label: string; step: number; show: (v: number | null) => string }[] = [
  { metric: "sales", label: "Vendas (quantidade)", step: 1, show: num },
  { metric: "vgv", label: "VGV (R$)", step: 0.01, show: (v) => brl(v, { cents: true }) },
];

/** Campo vazio não é zero: só grava o que a pessoa digitou, e meta negativa não existe. */
const parseTarget = (raw: string): number | null => {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const loadGlobalGoals = async (periodIso: string) => {
  const [sales, vgv] = await Promise.all([
    getGlobalMonthlyGoal("sales", periodIso),
    getGlobalMonthlyGoal("vgv", periodIso),
  ]);
  return { sales, vgv };
};

/**
 * Meta global do mês (`goals`, scope 'global') — a que o Dashboard lê.
 *
 * Quem monta decide quem vê: a RLS `goals_write` aceita admin e diretor, e a
 * tela de Equipes já tem essa regra em `canEdit`.
 */
export function GlobalGoalCard() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  // Só o que foi digitado; o resto é derivado do valor carregado. Assim trocar
  // de mês ou salvar zera o rascunho sem precisar sincronizar estado com efeito.
  const [edits, setEdits] = useState<Partial<Record<Metric, string>>>({});
  const [saving, setSaving] = useState(false);

  const periodIso = monthInputToPeriodIso(month);
  const goals = useQuery({
    queryKey: ["goals", "global", periodIso],
    queryFn: periodIso ? () => loadGlobalGoals(periodIso) : skipToken,
  });

  const fields = FIELDS.map((field) => {
    const raw = edits[field.metric];
    const parsed = raw === undefined ? undefined : parseTarget(raw);
    const stored = goals.data?.[field.metric];
    return {
      ...field,
      value: raw ?? String(stored ?? ""),
      invalid: parsed === null,
      pending: typeof parsed === "number" && parsed !== stored ? parsed : null,
    };
  });
  const toSave = fields.flatMap((f) => (f.pending === null ? [] : [{ metric: f.metric, target: f.pending }]));
  const canSave = !!periodIso && goals.isSuccess && toSave.length > 0 && fields.every((f) => !f.invalid) && !saving;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || !periodIso) return;
    setSaving(true);
    try {
      for (const { metric, target } of toSave) {
        await upsertGlobalMonthlyGoal(metric, periodIso, target);
      }
      setEdits({});
      await queryClient.invalidateQueries({ queryKey: ["goals", "global", periodIso] });
      // O Dashboard guarda a meta por 60 s (`staleTime` do App); sem isto quem
      // salva e abre o painel em seguida ainda vê "—".
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "sales-goal"] });
      toast({ title: "Meta global salva" });
    } catch (error: unknown) {
      toast({ title: "Erro ao salvar meta global", description: describeError(error, "Não foi possível salvar a meta global."), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Meta global do mês"
      description="É a meta que o Dashboard mostra para toda a operação. Sem cadastro, o painel exibe —."
      icon={Target}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="meta-global-mes" className="text-xs">Mês</Label>
          <Input
            id="meta-global-mes"
            type="month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setEdits({}); }}
            className="h-9 w-44"
            aria-invalid={periodIso === null}
            aria-describedby={periodIso === null ? "meta-global-mes-erro" : undefined}
          />
          {periodIso === null && (
            <p id="meta-global-mes-erro" className="text-xs text-destructive">Informe um mês válido</p>
          )}
        </div>
      }
    >
      {goals.isError ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar a meta global"
          description={describeError(goals.error, "Não foi possível carregar a meta global.")}
          action={<Button variant="outline" onClick={() => goals.refetch()}>Tentar de novo</Button>}
        />
      ) : (
        <form onSubmit={save} aria-label="Meta global do mês" className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:items-end">
          {fields.map(({ metric, label, step, show, value, invalid }) => {
            const id = `meta-global-${metric}`;
            return (
              <div key={metric} className="space-y-1.5">
                <Label htmlFor={id} className="text-xs">{label}</Label>
                <Input
                  id={id}
                  type="number"
                  min={0}
                  step={step}
                  inputMode={step === 1 ? "numeric" : "decimal"}
                  value={value}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [metric]: e.target.value }))}
                  disabled={!goals.isSuccess}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${id}-erro ${id}-cadastrado` : `${id}-cadastrado`}
                />
                {invalid && (
                  <p id={`${id}-erro`} className="text-xs text-destructive">Use um número maior ou igual a zero</p>
                )}
                <p id={`${id}-cadastrado`} className="text-xs text-muted-foreground tabular-nums">
                  Cadastrado: {goals.isSuccess ? show(goals.data[metric]) : "…"}
                </p>
              </div>
            );
          })}
          <Button type="submit" disabled={!canSave} className="sm:mb-6">
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </form>
      )}
    </SectionCard>
  );
}
