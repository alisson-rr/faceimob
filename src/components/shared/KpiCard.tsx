import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { labelToken, tone as colorTone } from "@/lib/tone";

type DeltaTone = "success" | "danger" | "neutral";

export interface KpiDelta {
  /** Texto ja formatado: "+12%", "-3 negocios", "estavel". */
  label: string;
  direction: "up" | "down" | "flat";
  /**
   * Subir nem sempre e bom (perdas, distratos). Sem `tone`, "up" e verde e
   * "down" e vermelho; passe `tone` quando a leitura for ao contrario.
   */
  tone?: DeltaTone;
}

export interface KpiCardProps {
  label: string;
  /** Numero ja formatado (use `brl`/`num` de `@/lib/format`). */
  value: ReactNode;
  delta?: KpiDelta;
  icon?: LucideIcon;
  /** `highlight` marca o indicador que a tela quer que seja lido primeiro. */
  variant?: "default" | "highlight";
  /** Linha de apoio abaixo do valor ("meta: 40", "ultimos 7 dias"). */
  hint?: ReactNode;
  /**
   * Cor fixa do cartão: borda, fundo e brilho na cor, rótulo colorido (régua
   * da Dashboard, pedido de 28/09/2026). Ausente = o visual de sempre, com a
   * cor tirada do rótulo. `preto` é fundo preto com texto branco nos dois temas.
   */
  cor?: KpiCor;
  className?: string;
}

export type KpiCor = "azul" | "cinza" | "preto" | "vermelho" | "verde";

const TOKEN_DA_COR: Record<Exclude<KpiCor, "preto">, string> = {
  azul: "primary",
  cinza: "silver",
  vermelho: "destructive",
  verde: "success",
};

const deltaTone: Record<DeltaTone, string> = {
  success: "text-success",
  danger: "text-destructive",
  neutral: "text-muted-foreground",
};

const deltaIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: ArrowRight };

/**
 * Cartao de indicador. O numero vai em fonte display com `tabular-nums`: sem
 * isso o valor "pula" de largura a cada atualizacao do realtime.
 *
 * A direcao do delta e dita pela SETA, nao so pela cor — daltonismo e tela em
 * escala de cinza precisam ler a mesma coisa.
 *
 * ENXUGADO EM 05/09/2026 (pedido do cliente: "um pouco poluído"). O que saiu, e
 * por quê — em todos os casos a informação ficou, o enfeite é que foi embora:
 *
 *  · o quadradinho colorido atrás do ícone. São sete cartões lado a lado na
 *    régua do Dashboard: sete manchas azuis competindo entre si e com o número,
 *    que é o que se veio ler. O ícone continua, em cinza;
 *  · a sombra colorida no hover e o `-translate-y`. Passar o mouse pela régua
 *    fazia sete cartões pularem, um a um. Hover agora é só a borda;
 *  · a sombra permanente do `highlight`. Destaque virou UMA coisa — a borda —
 *    em vez de borda + sombra + ícone âmbar ao mesmo tempo. Quando tudo se
 *    destaca, nada se destaca.
 *
 * A folga cai um passo abaixo de `sm` (pedido do cliente, 10/09/2026: "card
 * gigante"). A regua empilha em UMA coluna no celular: com 20 px de folga e
 * dois respiros de 12 px, sete cartoes somavam 896 px de rolagem antes do
 * primeiro grafico. Do `sm` para cima nada muda.
 */
export function KpiCard({ label, value, delta, icon: Icon, variant = "default", hint, cor, className }: KpiCardProps) {
  if (cor) return <KpiCardColorido {...{ label, value, delta, icon: Icon, hint, cor, className }} />;
  const isHighlight = variant === "highlight";
  const DeltaIcon = delta ? deltaIcon[delta.direction] : null;
  const tone = delta ? (delta.tone ?? (delta.direction === "up" ? "success" : delta.direction === "down" ? "danger" : "neutral")) : "neutral";

  return (
    <div
      style={{ borderTopColor: colorTone(isHighlight ? "gold" : labelToken(label)), backgroundImage: `linear-gradient(135deg, ${colorTone(isHighlight ? "gold" : labelToken(label), 0.12)}, transparent 80%)` }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-t-4 bg-card p-4 shadow-sm transition-colors duration-200 sm:p-5",
        isHighlight ? "border-highlight/50" : "border-border hover:border-border/80",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-eyebrow">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      </div>

      {/* Destaque = borda âmbar + NÚMERO em ouro (12/09/2026). O ícone voltou a
          cinza: ícone e número âmbar no mesmo cartão eram dois pontos de cor
          disputando o olho. `gold`, e não `highlight`, porque é texto. */}
      <p
        className={cn(
          "mt-2 font-display text-3xl font-bold leading-none tracking-tight tabular-nums sm:mt-3",
          isHighlight ? "text-gold" : "text-foreground",
        )}
      >
        {value}
      </p>

      {(delta || hint) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mt-3">
          {delta && DeltaIcon && (
            <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", deltaTone[tone])}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta.label}
            </span>
          )}
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  );
}

/** O cartão com `cor`: mesma estrutura, a cor em volta dele inteiro. */
function KpiCardColorido({ label, value, delta, icon: Icon, hint, cor, className }: Omit<KpiCardProps, "variant"> & { cor: KpiCor }) {
  const DeltaIcon = delta ? deltaIcon[delta.direction] : null;
  const tone = delta ? (delta.tone ?? (delta.direction === "up" ? "success" : delta.direction === "down" ? "danger" : "neutral")) : "neutral";
  const preto = cor === "preto";
  const token = preto ? null : TOKEN_DA_COR[cor];

  return (
    <div
      style={token ? {
        borderColor: colorTone(token, 0.75),
        backgroundImage: `linear-gradient(160deg, ${colorTone(token, 0.2)}, ${colorTone(token, 0.05)} 85%)`,
        boxShadow: `0 0 14px -4px ${colorTone(token, 0.55)}`,
      } : { boxShadow: "0 0 12px -4px rgba(255,255,255,0.35)" }}
      className={cn(
        "relative overflow-hidden rounded-2xl border-2 p-4 transition-colors duration-200 sm:p-5",
        preto ? "border-white/40 bg-black text-white" : "bg-card text-foreground",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {/* 12 px e não `.text-eyebrow` (11 px): a cor vem por `style`, e o
            `.text-eyebrow` fixa a dele (index.css). */}
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: token ? colorTone(token) : "#fff" }}
        >
          {label}
        </p>
        {Icon && <Icon className={cn("h-4 w-4 shrink-0", preto ? "text-white/70" : "text-muted-foreground")} aria-hidden />}
      </div>
      <p className="mt-2 font-display text-3xl font-bold leading-none tracking-tight tabular-nums sm:mt-3">{value}</p>
      {(delta || hint) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 sm:mt-3">
          {delta && DeltaIcon && (
            <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular-nums", deltaTone[tone])}>
              <DeltaIcon className="h-3.5 w-3.5" aria-hidden />
              {delta.label}
            </span>
          )}
          {hint && <span className={cn("text-xs", preto ? "text-white/75" : "text-muted-foreground")}>{hint}</span>}
        </div>
      )}
    </div>
  );
}
