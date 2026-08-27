import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Crown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Pódio 2-1-3 do ranking (ata 14/07: "ranking com animações para os 3
 * primeiros").
 *
 * Uma implementação só para as duas telas que mostram o mesmo dado — a
 * Gamificação e a faixa do Pipeline —, que antes repetiam a configuração de
 * medalha com cores fixas de tema escuro. As cores são os tokens `gold`,
 * `silver` e `bronze`, os mesmos do pódio do header.
 *
 * Movimento: entrada com stagger de baixo para cima, coroa balançando e brilho
 * contínuo apenas no 1º. Quem pediu menos movimento no sistema recebe o pódio
 * parado — `useReducedMotion` corta as animações do framer-motion e o
 * `animate-glow-pulse` já cai no bloco `@media` de `index.css`.
 */

export type PodiumEntry = {
  id: string;
  name: string;
  points: number;
  avatarUrl?: string | null;
  /** Linha de apoio: equipe, gerência, métricas curtas. */
  detail?: ReactNode;
};

export interface PodiumProps {
  /** Já ordenado do 1º ao 3º. Aceita menos de três. */
  entries: PodiumEntry[];
  size?: "sm" | "md";
  /** Torna cada degrau clicável (a faixa do Pipeline abre o recado do dia). */
  onSelect?: (entry: PodiumEntry) => void;
  className?: string;
}

/** Posição no pódio → token de cor e altura do degrau. */
const PLACE = [
  { label: "1º", tone: "gold", step: "h-20", stepSm: "h-12" },
  { label: "2º", tone: "silver", step: "h-14", stepSm: "h-9" },
  { label: "3º", tone: "bronze", step: "h-10", stepSm: "h-7" },
] as const;

const TONE_CLASS: Record<string, { ring: string; text: string; step: string }> = {
  gold: { ring: "ring-gold", text: "text-gold", step: "border-gold/40 bg-gold/15" },
  silver: { ring: "ring-silver", text: "text-silver", step: "border-silver/40 bg-silver/15" },
  bronze: { ring: "ring-bronze", text: "text-bronze", step: "border-bronze/40 bg-bronze/15" },
};

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * Contagem animada. Parte do valor anterior, não de zero: quando o realtime
 * soma 10 pontos, o número anda de 120 para 130 em vez de recomeçar do chão.
 */
function useCountUp(target: number, animate: boolean) {
  const [value, setValue] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (!animate) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const duration = 900;
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(origin + (target - origin) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return value;
}

function Step({
  entry,
  place,
  size,
  onSelect,
  still,
}: {
  entry: PodiumEntry;
  place: number;
  size: "sm" | "md";
  onSelect?: (entry: PodiumEntry) => void;
  still: boolean;
}) {
  const config = PLACE[place];
  const tone = TONE_CLASS[config.tone];
  const first = place === 0;
  const points = useCountUp(entry.points, !still);

  const body = (
    <>
      <div className="relative">
        {first && (
          <motion.span
            aria-hidden
            className="absolute -top-5 left-1/2 -translate-x-1/2 text-gold"
            animate={still ? undefined : { rotate: [-8, 8, -8], y: [0, -2, 0] }}
            transition={still ? undefined : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <Crown className={size === "sm" ? "h-4 w-4" : "h-6 w-6"} />
          </motion.span>
        )}
        {/* O brilho contínuo vai num invólucro, não no Avatar: `animate-glow-pulse`
            e o `ring` do Tailwind escrevem os dois em `box-shadow`, e o anel de
            ouro do 1º lugar sumia sob a animação. */}
        <span className={cn("block rounded-full", first && !still && "animate-glow-pulse")}>
          <Avatar
            className={cn(
              "ring-2 ring-offset-2 ring-offset-card",
              tone.ring,
              size === "sm"
                ? first ? "h-14 w-14" : "h-11 w-11"
                : first ? "h-20 w-20" : "h-16 w-16",
            )}
          >
            <AvatarImage src={entry.avatarUrl || undefined} alt="" />
            <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
              {initials(entry.name)}
            </AvatarFallback>
          </Avatar>
        </span>
      </div>

      <p className={cn("mt-2 max-w-full truncate font-semibold text-foreground", size === "sm" ? "text-xs" : "text-sm")}>
        {entry.name}
      </p>
      {entry.detail && <p className="max-w-full truncate text-xs text-muted-foreground">{entry.detail}</p>}
      <p className={cn("font-display font-bold tabular-nums", tone.text, size === "sm" ? "text-lg" : "text-2xl")}>
        {points}
        <span className="ml-1 text-xs font-medium text-muted-foreground">pts</span>
      </p>
    </>
  );

  return (
    <motion.div
      className="flex min-w-0 flex-col items-center justify-end"
      initial={still ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: (2 - place) * 0.12, type: "spring", stiffness: 200, damping: 18 }}
    >
      {onSelect ? (
        <button
          type="button"
          onClick={() => onSelect(entry)}
          className="interactive ease-premium flex min-w-0 flex-col items-center rounded-2xl px-2 pt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-col items-center px-2 pt-6">{body}</div>
      )}

      <div
        className={cn(
          "mt-2 grid w-full place-items-center rounded-t-xl border border-b-0",
          tone.step,
          size === "sm" ? config.stepSm : config.step,
        )}
      >
        <span className={cn("font-display font-bold", tone.text, size === "sm" ? "text-sm" : "text-lg")}>
          {config.label}
        </span>
      </div>
    </motion.div>
  );
}

export function Podium({ entries, size = "md", onSelect, className }: PodiumProps) {
  const still = useReducedMotion() ?? false;
  if (!entries.length) return null;

  // Ordem visual do pódio: o 2º à esquerda, o 1º ao centro, o 3º à direita.
  const layout: { entry: PodiumEntry; place: number }[] = [
    entries[1] && { entry: entries[1], place: 1 },
    entries[0] && { entry: entries[0], place: 0 },
    entries[2] && { entry: entries[2], place: 2 },
  ].filter(Boolean) as { entry: PodiumEntry; place: number }[];

  return (
    <ol className={cn("grid grid-cols-3 items-end gap-2 sm:gap-4", className)}>
      {layout.map(({ entry, place }) => (
        <li key={entry.id} className="min-w-0" aria-label={`${PLACE[place].label} lugar: ${entry.name}, ${entry.points} pontos`}>
          <Step entry={entry} place={place} size={size} onSelect={onSelect} still={still} />
        </li>
      ))}
    </ol>
  );
}
