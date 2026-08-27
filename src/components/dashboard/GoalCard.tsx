import { AlertTriangle, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, SectionCard, StatusBadge } from "@/components/shared";
import { num } from "@/lib/format";
import { displayMonthToIso } from "@/integrations/supabase/newSchema";
import { ALL_MONTHS } from "./data";

export interface GoalCardProps {
  month: string;
  vendas: number;
  /** `null` = nao ha linha em `goals` para o periodo. */
  goal: number | null | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

/** Meta batida, no ritmo (>=60%) ou abaixo — o rotulo escrito acompanha a cor. */
const reading = (pct: number) =>
  pct >= 100
    ? { tone: "success" as const, label: "Meta batida", bar: "bg-success" }
    : pct >= 60
      ? { tone: "warning" as const, label: "No ritmo", bar: "bg-warning" }
      : { tone: "danger" as const, label: "Abaixo da meta", bar: "bg-destructive" };

/**
 * Meta global de vendas do mes (`goals`, scope 'global', metric 'sales').
 *
 * Sem a linha cadastrada a tela nao mostra "—": ainda nao existe UI de meta, e
 * um travessao seco deixa quem esta olhando sem saber se e defeito ou falta de
 * cadastro. O estado vazio diz exatamente o que inserir.
 */
export function GoalCard({ month, vendas, goal, isLoading, error, onRetry }: GoalCardProps) {
  const periodo = month === ALL_MONTHS ? null : month;

  const body = () => {
    if (isLoading) return <LoadingState variant="block" label="Carregando a meta do mês…" />;

    if (error) {
      return (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar a meta"
          description={error}
          action={
            <Button variant="outline" onClick={onRetry}>
              Tentar de novo
            </Button>
          }
        />
      );
    }

    if (!periodo) {
      return (
        <EmptyState
          icon={Target}
          title="A meta é mensal"
          description="Escolha um mês no filtro do topo para comparar o realizado com a meta cadastrada."
        />
      );
    }

    if (goal === null || goal === undefined || goal <= 0) {
      return (
        <EmptyState
          icon={Target}
          title={`Sem meta cadastrada para ${periodo}`}
          description="Ainda não há tela para cadastrar meta. Até existir, a linha entra por SQL no Supabase:"
          action={
            <pre className="max-w-full overflow-x-auto rounded-xl border border-border bg-muted px-4 py-3 text-left text-xs text-muted-foreground">
              {`insert into goals (scope, period_type, period, metric, target)\nvalues ('global', 'month', '${displayMonthToIso(periodo)}', 'sales', 14);`}
            </pre>
          }
        />
      );
    }

    const pct = Math.round((vendas / goal) * 100);
    const status = reading(pct);
    const faltam = Math.max(0, goal - vendas);

    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-eyebrow">Atingimento</p>
            <p className="font-display text-5xl font-bold leading-none tracking-tight tabular-nums text-foreground">
              {num(pct)}
              <span className="ml-1 text-2xl text-muted-foreground">%</span>
            </p>
          </div>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>

        <div>
          <div
            className="h-3 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.min(100, pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Meta de vendas de ${periodo}: ${vendas} de ${goal}`}
          >
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-premium ${status.bar}`}
              style={{ width: `${Math.min(100, Math.max(pct, pct > 0 ? 3 : 0))}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              <strong className="font-semibold text-foreground">{num(vendas)}</strong> de {num(goal)} vendas
            </span>
            <span className="tabular-nums">
              {faltam === 0 ? "Meta cumprida" : `Faltam ${num(faltam)} para bater a meta`}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <SectionCard
      title="Meta do mês"
      description={periodo ? `Vendas realizadas × meta de ${periodo}` : "Vendas realizadas × meta cadastrada"}
      icon={Target}
    >
      {body()}
    </SectionCard>
  );
}
