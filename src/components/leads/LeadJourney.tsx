import { ArrowRight, Check, Circle, Flag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FUNNEL_STAGES,
  funnelStageLabel,
  type LeadFunnelStage,
  type LeadRecord,
  type LeadTone,
} from "@/integrations/supabase/leads";

const MAIN_PATH_ORDER: LeadFunnelStage[] = [
  "new", "first_contact", "warm", "hot", "scheduled_visit", "gathering_docs", "qualified",
];
const MAIN_PATH = MAIN_PATH_ORDER.map((key) => FUNNEL_STAGES.find((stage) => stage.key === key) as (typeof FUNNEL_STAGES)[number]);

const toneSurface: Record<LeadTone, string> = {
  info: "border-info/45 bg-info/10 text-info",
  warning: "border-warning/55 bg-warning/15 text-warning",
  danger: "border-destructive/55 bg-destructive/15 text-destructive",
  success: "border-success/55 bg-success/15 text-success",
  highlight: "border-highlight/60 bg-highlight/15 text-foreground",
  neutral: "border-border bg-muted/50 text-muted-foreground",
};

const currentSurface: Record<LeadTone, string> = {
  info: "border-info bg-info/20 shadow-[0_0_18px_-8px_hsl(var(--info))]",
  warning: "border-warning bg-warning/20 shadow-[0_0_18px_-8px_hsl(var(--warning))]",
  danger: "border-destructive bg-destructive/20 shadow-[0_0_18px_-8px_hsl(var(--destructive))]",
  success: "border-success bg-success/20 shadow-[0_0_18px_-8px_hsl(var(--success))]",
  highlight: "border-highlight bg-highlight/20 shadow-[0_0_18px_-8px_hsl(var(--highlight))]",
  neutral: "border-foreground/30 bg-muted",
};

/** Jornada comercial: mostra direção, próximo passo e conversão como destino. */
export function LeadJourney({
  lead,
  writable,
  onMove,
  onConvert,
}: {
  lead: LeadRecord;
  writable: boolean;
  onMove: (stage: LeadFunnelStage) => void;
  onConvert: () => void;
}) {
  const stage = FUNNEL_STAGES.find((item) => item.key === lead.funnel_stage) ?? FUNNEL_STAGES[0];
  const rawIndex = MAIN_PATH.findIndex((item) => item.key === lead.funnel_stage);
  // "Aguardando resposta" é um desvio de atenção depois da conversa inicial,
  // não um avanço comercial. Na régua ele permanece nesse ponto até retomar.
  const currentIndex = lead.funnel_stage === "no_response"
    ? MAIN_PATH.findIndex((item) => item.key === "first_contact")
    : Math.max(rawIndex, 0);
  const converted = lead.status === "converted" || Boolean(lead.converted_deal_id);
  const closed = lead.status === "lost" || lead.status === "discarded";
  const next = lead.funnel_stage === "no_response"
    ? MAIN_PATH.find((item) => item.key === "first_contact")
    : MAIN_PATH[currentIndex + 1];

  return (
    <section
      aria-labelledby="lead-journey-title"
      className={cn(
        "overflow-hidden rounded-2xl border bg-card/70",
        closed ? "border-destructive/50" : converted ? "border-success/60" : "border-border",
      )}
    >
      <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p id="lead-journey-title" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-highlight" aria-hidden />
            Caminho para converter
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {converted
              ? "Conversão concluída: este lead já virou negócio."
              : closed
                ? "Atendimento encerrado. Reabra o lead antes de continuar a jornada."
                : <><span className="font-semibold text-foreground">Agora:</span> {stage.guidance}</>}
          </p>
        </div>
        {!converted && !closed && next && (
          <Button size="sm" variant={stage.tone === "warning" ? "highlight" : "tintSuccess"}
            onClick={() => onMove(next.key)} disabled={!writable}>
            Próximo: {next.label} <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="overflow-x-auto px-3 py-4">
        <ol className="flex min-w-max items-stretch gap-1" aria-label="Etapas até a conversão">
          {MAIN_PATH.map((item, index) => {
            const done = converted || index < currentIndex;
            const current = !converted && lead.funnel_stage !== "no_response" && index === currentIndex;
            return (
              <li key={item.key} className="flex items-center">
                <button
                  type="button"
                  disabled={!writable || closed}
                  aria-current={current ? "step" : undefined}
                  aria-label={`${item.label}. ${item.guidance}`}
                  onClick={() => onMove(item.key)}
                  className={cn(
                    "group flex w-36 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-all",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    done ? "border-success/45 bg-success/10 text-success"
                      : current ? currentSurface[item.tone]
                        : "border-border bg-background/50 text-muted-foreground",
                    writable && !closed && "hover:-translate-y-0.5 hover:border-foreground/30",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                    {done ? <Check className="h-3.5 w-3.5" />
                      : current ? <Circle className="h-3.5 w-3.5 fill-current" />
                        : <Circle className="h-3.5 w-3.5" />}
                    {done ? "Concluído" : current ? "Você está aqui" : `Passo ${index + 1}`}
                  </span>
                  <span className="text-xs font-semibold leading-tight text-foreground">{item.label}</span>
                </button>
                <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
              </li>
            );
          })}
          <li className="flex items-center">
            {writable ? (
              <button
                type="button"
                disabled={converted || closed}
                onClick={onConvert}
                className={cn(
                  "flex w-40 flex-col gap-1 rounded-xl border px-3 py-2 text-left transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  converted ? "border-success bg-success/20 text-success"
                    : "border-success/60 bg-success/10 text-success",
                  !converted && !closed && "hover:-translate-y-0.5 hover:bg-success/20",
                )}
                aria-label="Converter este lead em negócio"
              >
                <Destination converted={converted} />
              </button>
            ) : (
              <div className="flex w-40 flex-col gap-1 rounded-xl border border-success/40 bg-success/5 px-3 py-2 text-left text-success opacity-70">
                <Destination converted={converted} />
              </div>
            )}
          </li>
        </ol>
      </div>

      {lead.funnel_stage === "no_response" && !closed && (
        <div className={cn("mx-3 mb-3 rounded-xl border px-3 py-2 text-xs", toneSurface.warning)}>
          <strong>{funnelStageLabel("no_response")}:</strong> não é retrocesso. Marque uma nova tentativa;
          quando o cliente responder, volte para “Conversa iniciada”.
        </div>
      )}
    </section>
  );
}

function Destination({ converted }: { converted: boolean }) {
  return (
    <>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
        {converted ? <Check className="h-3.5 w-3.5" /> : <Flag className="h-3.5 w-3.5" />}
        {converted ? "Concluído" : "Destino"}
      </span>
      <span className="text-xs font-semibold leading-tight text-foreground">Converter em negócio</span>
    </>
  );
}
