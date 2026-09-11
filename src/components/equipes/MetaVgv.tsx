import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { describeError } from "@/lib/supabaseError";
import { goalPeriods, parseGoal } from "@/components/equipes/metas";

export type MetaDaPessoa = {
  id: string;
  name: string;
  monthly_goal?: number | null;
  yearly_goal?: number | null;
  /** Metas do mês que NÃO são de VGV, já formatadas ("Vendas 3 · Visitas 10"). */
  other_goals?: string | null;
};

/**
 * Meta de VGV do mês e do ano.
 *
 * Estava na linha do organograma, em `Equipes.tsx`. Saiu de lá porque o cartão
 * passou a mostrar só nome e foto (pedido do cliente em 10/09/2026) e a meta
 * PRECISAVA continuar editável em algum lugar — some do cartão, aparece na
 * ficha. A lógica é a mesma, inclusive a conferência de linha devolvida.
 */
export function MetaVgv({ pessoa, onSaved }: { pessoa: MetaDaPessoa; onSaved: () => void }) {
  const errorId = useId();
  const queryClient = useQueryClient();
  const [monthly, setMonthly] = useState(String(pessoa.monthly_goal ?? 0));
  const [yearly, setYearly] = useState(String(pessoa.yearly_goal ?? 0));
  const [saving, setSaving] = useState(false);
  const parsedMonthly = parseGoal(monthly);
  const parsedYearly = parseGoal(yearly);
  const invalid = parsedMonthly === null || parsedYearly === null;
  const dirty = parsedMonthly !== (pessoa.monthly_goal ?? 0) || parsedYearly !== (pessoa.yearly_goal ?? 0);

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    const periods = goalPeriods();
    const targets = [
      { period_type: "month", period: periods.month, target: parsedMonthly },
      { period_type: "year", period: periods.year, target: parsedYearly },
    ];
    let failure: { code?: string; message?: string } | null = null;
    for (const goal of targets) {
      const existing = await supabase
        .from("goals")
        .select("id")
        .eq("scope", "profile")
        .eq("profile_id", pessoa.id)
        .eq("period_type", goal.period_type)
        .eq("period", goal.period)
        .eq("metric", "vgv")
        .maybeSingle();
      if (existing.error) {
        failure = existing.error;
        break;
      }
      const result = existing.data
        ? await supabase.from("goals").update({ target: goal.target }).eq("id", existing.data.id).select("id")
        : await supabase.from("goals").insert({
            scope: "profile",
            profile_id: pessoa.id,
            period_type: goal.period_type,
            period: goal.period,
            metric: "vgv",
            target: goal.target,
          }).select("id");
      if (result.error) {
        failure = result.error;
        break;
      }
      // Update que não casa linha nenhuma volta sem erro (a RLS `goals_write`
      // só aceita admin e diretor). Sem esta conferência o toast verde apareceria
      // para quem não gravou nada.
      if (!result.data?.length) {
        failure = { code: "42501", message: "Você não tem permissão para gravar a meta desta equipe." };
        break;
      }
    }
    setSaving(false);
    if (failure) return toast({ title: "Erro ao salvar meta", description: describeError(failure, "Não foi possível salvar a meta."), variant: "destructive" });
    toast({ title: "Meta salva" });
    // A faixa do Pipeline e o Dashboard leem a meta por `["dashboard","sales-goal"]`.
    // Sem invalidar, eles seguem com o alvo antigo ate a consulta envelhecer.
    void queryClient.invalidateQueries({ queryKey: ["dashboard", "sales-goal"] });
    onSaved();
  };

  return (
    <div className="space-y-1 rounded-lg border border-border/40 bg-secondary/20 p-3">
      {/* `flex-wrap` + `min-w-0` porque a linha tem rótulo, dois campos numéricos
          e um botão: a 375 px ela estourava a lateral. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-eyebrow shrink-0" title="Meta de VGV (R$) para o mês e para o ano correntes">Meta VGV R$</span>
        <Input
          type="number"
          min={0}
          value={monthly}
          onChange={e => setMonthly(e.target.value)}
          placeholder="mês"
          className="h-6 text-xs px-2 min-w-0 flex-1 basis-16"
          aria-label={`Meta mensal de ${pessoa.name}`}
          aria-invalid={parsedMonthly === null}
          aria-describedby={invalid ? errorId : undefined}
        />
        <Input
          type="number"
          min={0}
          value={yearly}
          onChange={e => setYearly(e.target.value)}
          placeholder="ano"
          className="h-6 text-xs px-2 min-w-0 flex-1 basis-16"
          aria-label={`Meta anual de ${pessoa.name}`}
          aria-invalid={parsedYearly === null}
          aria-describedby={invalid ? errorId : undefined}
        />
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          className="h-6 px-2 text-xs"
          aria-label={`Salvar metas de ${pessoa.name}`}
          onClick={save}
          disabled={saving || !dirty || invalid}
        >
          {saving ? "..." : "Salvar meta"}
        </Button>
      </div>
      {invalid && <p id={errorId} className="text-xs text-destructive">Use um número maior ou igual a zero</p>}
      {/* As metas de vendas e visitas existem no banco e não apareciam em tela
          nenhuma. Aqui são só leitura: editá-las é de outra tela, e um campo
          que não grava seria a mentira de novo. */}
      {pessoa.other_goals && (
        <p className="text-xs text-muted-foreground">Meta do mês, fora VGV: {pessoa.other_goals}</p>
      )}
    </div>
  );
}
