import { Target } from "lucide-react";
import { SectionCard, StatusBadge } from "@/components/shared";
import { num } from "@/lib/format";
import {
  IDEAL_STAGES,
  idealFunnelSteps,
  stageConversion,
  toFunnelSteps,
  type FunnelCounts,
  type FunnelStep,
} from "@/lib/metrics";
import { tone } from "@/lib/tone";
import { cn } from "@/lib/utils";

// As metas do funil e o catalogo de etapas moram em `@/lib/metrics` (achado
// T07). Reexportados para nao quebrar quem ja importava daqui.
export { IDEAL_STAGES };
export type { FunnelStep };

const asSteps = (input: FunnelStep[] | FunnelCounts): FunnelStep[] =>
  Array.isArray(input) ? input : toFunnelSteps(input);

/** Acima, no alvo (>=80% da meta) ou abaixo. O rotulo escrito acompanha a cor. */
function reading(actualPct: number, targetPct: number) {
  if (targetPct <= 0) return { tone: "neutral" as const, label: "Sem meta" };
  const ratio = actualPct / targetPct;
  if (ratio >= 1) return { tone: "success" as const, label: "Acima da meta" };
  if (ratio >= 0.8) return { tone: "warning" as const, label: "No alvo" };
  return { tone: "danger" as const, label: "Abaixo da meta" };
}

/** Largura de cada degrau do funil, em % da caixa. Da a forma classica. */
const WIDTHS = ["100%", "78%", "58%", "40%"];

/**
 * Funil em degraus.
 *
 * Era um SVG com `preserveAspectRatio="none"` e o texto desenhado dentro do
 * trapezio em `fill="white"` com contorno `rgba(0,0,0,.5)`: o rotulo esticava
 * junto com a caixa e a cor era fixa, entao no tema claro o texto sumia. Agora
 * o degrau e uma caixa tingida com o `accent` e o texto e `foreground` — legivel
 * nos dois temas, e sem esticar.
 */
export function VisualFunnel({
  title,
  subtitle,
  steps,
  accent = tone("primary"),
}: {
  title: string;
  subtitle?: string;
  steps: FunnelStep[];
  accent?: string;
}) {
  const topo = steps[0]?.value ?? 0;

  return (
    <SectionCard title={title} description={subtitle} icon={Target}>
      <ol className="flex flex-col items-center gap-1.5">
        {steps.map((step, index) => {
          const stagePct = stageConversion(steps, index);
          const absPct = topo > 0 ? (step.value / topo) * 100 : 0;
          return (
            <li key={step.key} className="w-full" style={{ maxWidth: WIDTHS[index] ?? WIDTHS[WIDTHS.length - 1] }}>
              <div
                className="relative overflow-hidden rounded-xl border px-3 py-2 text-center"
                style={{ borderColor: accent }}
              >
                <span aria-hidden className="absolute inset-0 opacity-20" style={{ background: accent }} />
                <div className="relative">
                  <p className="font-display text-sm font-bold tabular-nums text-foreground">
                    {step.label} · {num(step.value)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {index === 0
                      ? "base do funil"
                      : `conv. ${stagePct.toFixed(1)}% (meta ${step.targetPct}%) · ${absPct.toFixed(1)}% do topo`}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}

/** Funil denso: uma barra por etapa, com a marca da meta e o rotulo do estado. */
export function CompactFunnel({
  title,
  subtitle,
  steps,
  accent = tone("primary"),
}: {
  title: string;
  subtitle?: string;
  steps: FunnelStep[];
  accent?: string;
}) {
  const topo = steps[0]?.value ?? 0;

  return (
    <SectionCard title={title} description={subtitle} icon={Target}>
      <ul className="flex flex-col gap-2.5">
        {steps.map((step, index) => {
          const stagePct = stageConversion(steps, index);
          const absPct = topo > 0 ? (step.value / topo) * 100 : 0;
          const noAlvo = index === 0 || stagePct >= step.targetPct;
          const barPct = Math.min(100, index === 0 ? 100 : stagePct);
          return (
            <li key={step.key} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 truncate font-semibold text-foreground">{step.label}</span>
              <span className="w-8 shrink-0 text-right font-bold tabular-nums text-foreground">
                {num(step.value)}
              </span>
              <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                {index > 0 && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 border-r-2 border-dashed border-foreground/40"
                    style={{ left: `${Math.min(100, step.targetPct)}%` }}
                  />
                )}
                <span
                  className={cn("block h-full rounded-full", index === 0 ? "" : noAlvo ? "bg-success" : "bg-destructive")}
                  style={{ width: `${barPct}%`, background: index === 0 ? accent : undefined }}
                />
              </span>
              <span
                className={cn(
                  "w-20 shrink-0 text-right font-semibold tabular-nums",
                  index === 0 ? "text-muted-foreground" : noAlvo ? "text-success" : "text-destructive",
                )}
              >
                {index === 0 ? "base 100%" : `${stagePct.toFixed(0)}% / ${step.targetPct}%`}
              </span>
              <span className="hidden w-16 shrink-0 text-right tabular-nums text-muted-foreground md:inline">
                {index === 0 ? "" : `${absPct.toFixed(1)}% topo`}
              </span>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

/** Aderencia etapa-a-etapa: o realizado ao lado da meta, com o estado escrito. */
export function StageComparisonList({ steps }: { steps: FunnelStep[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {steps.map((step, index) => {
        if (index === 0) return null;
        const stagePct = stageConversion(steps, index);
        const status = reading(stagePct, step.targetPct);
        return (
          <li key={step.key} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-40 shrink-0 font-semibold text-foreground">
              {steps[index - 1].label} → {step.label}
            </span>
            {/* A 375 px a barra fica com 20 px e nao informa nada; o numero ao
                lado e o rotulo do estado continuam contando a mesma historia. */}
            <span className="relative hidden h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted sm:block">
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 border-r-2 border-dashed border-primary/70"
                style={{ width: `${Math.min(100, step.targetPct)}%` }}
              />
              <span
                className={cn("block h-full rounded-full", stagePct >= step.targetPct ? "bg-success" : "bg-destructive")}
                style={{ width: `${Math.min(100, stagePct)}%` }}
              />
            </span>
            <span className="w-24 shrink-0 text-right tabular-nums text-foreground">
              {stagePct.toFixed(1)}% <span className="text-muted-foreground">/ {step.targetPct}%</span>
            </span>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </li>
        );
      })}
    </ul>
  );
}

/** Comparativo do diario declarado com o pipeline medido, contra o funil ideal. */
export default function ComparativeFunnel({
  daily,
  pipeline,
}: {
  daily: FunnelStep[] | FunnelCounts;
  pipeline: FunnelStep[] | FunnelCounts;
}) {
  const dSteps = asSteps(daily);
  const pSteps = asSteps(pipeline);
  const topo = Math.max(dSteps[0]?.value ?? 0, pSteps[0]?.value ?? 0, 100);
  const aderencia = (declarado: number, medido: number) =>
    declarado === 0 && medido === 0 ? 100 : medido === 0 ? 0 : Math.min(100, (declarado / medido) * 100);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <VisualFunnel
          title="Ideal"
          subtitle={IDEAL_STAGES.map((stage) => stage.absPct).join(" / ")}
          accent={tone("chart-3")}
          steps={idealFunnelSteps(topo)}
        />
        <VisualFunnel
          title="Diário (declarado)"
          subtitle="o que os gerentes preencheram"
          accent={tone("chart-1")}
          steps={dSteps}
        />
        <VisualFunnel
          title="Pipeline (real)"
          subtitle="o que o CRM mediu"
          accent={tone("chart-2")}
          steps={pSteps}
        />
      </div>

      <SectionCard title="Aderência etapa a etapa" description="Conversão realizada × meta" icon={Target}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="text-eyebrow mb-2">Diário</p>
            <StageComparisonList steps={dSteps} />
          </div>
          <div>
            <p className="text-eyebrow mb-2">Pipeline</p>
            <StageComparisonList steps={pSteps} />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Declarado × medido"
        description="O que o diário informou comparado ao que o CRM registrou"
        icon={Target}
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {dSteps.map((step, index) => {
            const medido = pSteps[index]?.value ?? 0;
            const pct = aderencia(step.value, medido);
            return (
              <li key={step.key} className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-eyebrow">{step.label}</p>
                <p className="mt-1 font-display text-lg font-bold tabular-nums text-foreground">
                  {num(step.value)} <span className="text-xs font-medium text-muted-foreground">vs</span>{" "}
                  {num(medido)}
                </p>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      pct >= 90 ? "bg-success" : pct >= 60 ? "bg-warning" : "bg-destructive",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
                  {pct.toFixed(0)}% de aderência
                </p>
              </li>
            );
          })}
        </ul>
      </SectionCard>
    </div>
  );
}
