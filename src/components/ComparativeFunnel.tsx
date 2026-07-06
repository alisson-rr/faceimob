import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Target } from "lucide-react";

// Funil ideal (conversão etapa-a-etapa):
// Leads 100% → Análise 10% (das leads) → Aprovação 40% (das análises) → Venda 50% (dos aprovados)
export const IDEAL_STAGES = [
  { key: "leads",     label: "Leads",       stagePct: 100, absPct: 100 },
  { key: "analises",  label: "Análises",    stagePct: 10,  absPct: 10  },
  { key: "aprovados", label: "Aprovações",  stagePct: 40,  absPct: 4   },
  { key: "vendas",    label: "Vendas",      stagePct: 50,  absPct: 2   },
] as const;

export type FunnelStep = {
  key: string;
  label: string;
  value: number;
  /** Meta de conversão em relação à etapa anterior (leads = 100) */
  targetPct: number;
};

type FunnelData = { leads: number; analises: number; aprovados: number; vendas: number };

const toSteps = (d: FunnelData): FunnelStep[] => [
  { key: "leads",     label: "Leads",      value: d.leads,     targetPct: 100 },
  { key: "analises",  label: "Análises",   value: d.analises,  targetPct: 10 },
  { key: "aprovados", label: "Aprovações", value: d.aprovados, targetPct: 40 },
  { key: "vendas",    label: "Vendas",     value: d.vendas,    targetPct: 50 },
];

function statusOf(actualPct: number, idealPct: number) {
  if (idealPct <= 0) return { label: "—", cls: "bg-muted/30 text-muted-foreground" };
  const ratio = actualPct / idealPct;
  if (ratio >= 1)   return { label: "🔥 Acima", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
  if (ratio >= 0.8) return { label: "🎯 No alvo", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
  return { label: "⚠️ Abaixo", cls: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
}

/** Funil visual em SVG (trapézios encaixados). */
export function VisualFunnel({
  title,
  subtitle,
  steps,
  accent = "hsl(var(--primary))",
}: {
  title: string;
  subtitle?: string;
  steps: FunnelStep[];
  accent?: string;
}) {
  const leads = steps.find((s) => s.key === "leads")?.value || 0;
  // Larguras dos trapézios seguem o funil IDEAL para dar a forma clássica de funil
  const widths = [100, 62, 38, 22];
  const rowH = 44;
  const gap = 4;
  const totalH = steps.length * rowH + (steps.length - 1) * gap;

  return (
    <Card className="border-border/60 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs uppercase tracking-wider flex items-center justify-between">
          <span className="flex items-center gap-2"><Target className="h-3.5 w-3.5 text-primary" />{title}</span>
          {subtitle && <span className="text-[10px] text-muted-foreground normal-case font-normal">{subtitle}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <svg viewBox={`0 0 100 ${totalH}`} preserveAspectRatio="none" className="w-full" style={{ height: totalH * 4 }}>
          <defs>
            <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
              <stop offset="100%" stopColor={accent} stopOpacity="0.35" />
            </linearGradient>
          </defs>
          {steps.map((s, i) => {
            const top = widths[i];
            const bot = widths[Math.min(i + 1, widths.length - 1)];
            const y = i * (rowH + gap);
            const points = [
              [(100 - top) / 2, y],
              [(100 + top) / 2, y],
              [(100 + bot) / 2, y + rowH],
              [(100 - bot) / 2, y + rowH],
            ]
              .map((p) => p.join(","))
              .join(" ");
            const prev = i === 0 ? s.value : steps[i - 1].value;
            const stagePct = prev > 0 ? (s.value / prev) * 100 : 0;
            const absPct = leads > 0 ? (s.value / leads) * 100 : 0;
            return (
              <g key={s.key}>
                <polygon points={points} fill={`url(#grad-${title})`} stroke={accent} strokeOpacity={0.6} strokeWidth={0.3} />
                <text x="50" y={y + rowH / 2} textAnchor="middle" dominantBaseline="middle"
                      fontSize="4.2" fontWeight="700" fill="white" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.5)", strokeWidth: 0.4 }}>
                  {s.label} · {s.value}
                </text>
                <text x="50" y={y + rowH / 2 + 5} textAnchor="middle" dominantBaseline="middle"
                      fontSize="2.6" fill="white" opacity="0.9">
                  {i === 0 ? "base" : `conv. ${stagePct.toFixed(1)}% (meta ${s.targetPct}%) · ${absPct.toFixed(1)}% do topo`}
                </text>
              </g>
            );
          })}
        </svg>
      </CardContent>
    </Card>
  );
}

/** Lista horizontal Ideal x Real por etapa. */
export function StageComparisonList({ steps }: { steps: FunnelStep[] }) {
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        if (i === 0) return null;
        const prev = steps[i - 1].value;
        const stagePct = prev > 0 ? (s.value / prev) * 100 : 0;
        const st = statusOf(stagePct, s.targetPct);
        return (
          <div key={s.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 font-semibold">{steps[i - 1].label} → {s.label}</span>
            <div className="flex-1 h-2 rounded bg-muted/40 overflow-hidden relative">
              <div className="absolute inset-y-0 left-0 border-r-2 border-dashed border-primary/70" style={{ width: `${Math.min(100, s.targetPct)}%` }} />
              <div className={cn("h-full bg-gradient-to-r", stagePct >= s.targetPct ? "from-emerald-500 to-emerald-400" : "from-rose-500 to-rose-400")}
                   style={{ width: `${Math.min(100, stagePct)}%` }} />
            </div>
            <span className="w-28 text-right tabular-nums">
              {stagePct.toFixed(1)}% <span className="text-muted-foreground">/ {s.targetPct}%</span>
            </span>
            <Badge variant="outline" className={cn("text-[9px] h-4 px-1", st.cls)}>{st.label}</Badge>
          </div>
        );
      })}
    </div>
  );
}

/** Comparativo Diário (declarado) vs Pipeline (real). */
export default function ComparativeFunnel({
  daily,
  pipeline,
}: {
  daily: FunnelStep[] | FunnelData;
  pipeline: FunnelStep[] | FunnelData;
}) {
  const dSteps = Array.isArray(daily) ? daily : toSteps(daily);
  const pSteps = Array.isArray(pipeline) ? pipeline : toSteps(pipeline);
  const dLeads = dSteps[0]?.value || 0;
  const pLeads = pSteps[0]?.value || 0;
  const match = (a: number, b: number) => (a === 0 && b === 0 ? 100 : b === 0 ? 0 : Math.min(100, (a / b) * 100));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <VisualFunnel title="Ideal" subtitle="100 / 10 / 4 / 2" accent="hsl(45 100% 55%)"
          steps={toSteps({ leads: Math.max(dLeads, pLeads, 100), analises: 0, aprovados: 0, vendas: 0 }).map((s, i) => ({
            ...s,
            value: Math.round(Math.max(dLeads, pLeads, 100) * (IDEAL_STAGES[i].absPct / 100)),
          }))} />
        <VisualFunnel title="Daily (declarado)" subtitle="preenchimento dos gerentes" accent="hsl(217 91% 60%)" steps={dSteps} />
        <VisualFunnel title="Pipeline (real)" subtitle="dados do CRM" accent="hsl(142 71% 45%)" steps={pSteps} />
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wider">Aderência etapa-a-etapa vs. Meta</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Daily</p>
            <StageComparisonList steps={dSteps} />
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Pipeline</p>
            <StageComparisonList steps={pSteps} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/30 bg-gradient-to-r from-primary/5 via-transparent to-primary/5">
        <CardContent className="p-3">
          <p className="text-[10px] uppercase text-muted-foreground mb-2">Match Daily × Pipeline (o que foi informado × o que foi metrificado)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {dSteps.map((s, i) => {
              const p = pSteps[i]?.value ?? 0;
              const m = match(s.value, p);
              return (
                <div key={s.key} className="p-2 rounded-lg bg-muted/20 border border-border/40">
                  <p className="text-[10px] uppercase text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-bold">
                    {s.value} <span className="text-muted-foreground text-xs">vs</span> {p}
                  </p>
                  <div className="h-1.5 bg-muted/40 rounded overflow-hidden mt-1">
                    <div className={cn("h-full", m >= 90 ? "bg-emerald-500" : m >= 60 ? "bg-amber-500" : "bg-rose-500")}
                         style={{ width: `${m}%` }} />
                  </div>
                  <p className="text-[10px] text-right mt-0.5">{m.toFixed(0)}% aderência</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
