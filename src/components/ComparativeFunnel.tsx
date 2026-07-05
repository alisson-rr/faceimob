import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type FunnelStep = {
  key: string;
  label: string;
  value: number;
  targetPct: number; // meta % em relação a leads (100 para leads)
};

type Props = {
  title: string;
  color: string; // tailwind gradient class, ex.: "from-primary/80 to-primary/30"
  steps: FunnelStep[];
  subtitle?: string;
};

export function Funnel({ title, subtitle, color, steps }: Props) {
  const leads = steps.find((s) => s.key === "leads")?.value || 0;
  return (
    <Card className="border-border/60">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider">{title}</h3>
          {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
        </div>
        <div className="space-y-1.5">
          {steps.map((s, i) => {
            const width = 100 - i * 15; // afunila visualmente
            const actualPct = leads > 0 ? Math.round((s.value / leads) * 100) : 0;
            const ok = s.key === "leads" ? true : actualPct >= s.targetPct;
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div className="w-24 text-[11px] text-muted-foreground shrink-0">
                  <div className="font-medium text-foreground">{s.label}</div>
                  <div className="text-[9px]">meta {s.targetPct}%</div>
                </div>
                <div className="flex-1">
                  <div className="h-7 rounded-md bg-muted/40 relative overflow-hidden">
                    <div
                      className={cn("h-full bg-gradient-to-r rounded-md flex items-center justify-between px-2 transition-all", color)}
                      style={{ width: `${width}%` }}
                    >
                      <span className="text-[11px] font-bold text-white/95 drop-shadow">{s.value}</span>
                      <span className={cn("text-[10px] font-semibold px-1 rounded",
                        ok ? "bg-emerald-500/30 text-emerald-100" : "bg-rose-500/30 text-rose-100"
                      )}>
                        {actualPct}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ComparativeFunnel({
  daily,
  pipeline,
}: {
  daily: FunnelStep[];
  pipeline: FunnelStep[];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Funnel title="Daily (declarado)" subtitle="dados dos preenchimentos diários" color="from-blue-500 to-blue-500/40" steps={daily} />
      <Funnel title="Pipeline (real)" subtitle="dados do CRM" color="from-emerald-500 to-emerald-500/40" steps={pipeline} />
    </div>
  );
}
