import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Crown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { num } from "@/lib/format";
import { podiumToken, type PodiumToken } from "@/lib/tone";
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
 * Movimento: entrada com stagger de baixo para cima e coroa balançando. Quem
 * pediu menos movimento no sistema recebe o pódio parado — `useReducedMotion`
 * corta as animações do framer-motion.
 *
 * O 1º lugar (12/09/2026) tem degrau em ouro cheio e brilho âmbar PARADO em
 * volta da foto; o pulso infinito saiu. Prata e bronze não mudaram.
 */

export type PodiumEntry = {
  id: string;
  name: string;
  points: number;
  avatarUrl?: string | null;
  /** Linha de apoio: equipe, gerência, métricas curtas. */
  detail?: ReactNode;
  /**
   * Colocação real, quando ela não é a posição na lista.
   *
   * O ranking congelado de uma temporada fechada chega filtrado pelo escopo de
   * quem olha: o primeiro degrau pode ser o 5º da casa. Sem isto o cartão
   * coroava como 1º quem a tabela ao lado numerava "#5". Ausente = a posição
   * na lista, que é o caso do ranking vivo.
   */
  place?: number;
};

export interface PodiumProps {
  /** Já ordenado do 1º ao 3º. Aceita menos de três. */
  entries: PodiumEntry[];
  size?: "sm" | "md";
  /** Torna cada degrau clicável (a faixa do Pipeline abre o recado do dia). */
  onSelect?: (entry: PodiumEntry) => void;
  className?: string;
}

/**
 * Altura do degrau por posição na lista (0 = o mais alto). Só altura: a cor sai
 * de `podiumToken`, que é a base 0 declarada em `@/lib/tone` — aqui havia uma
 * segunda tabela posição → token, em base 1, do mesmo feitio do `podiumTone`
 * que já foi apagado do `AppLayout`. Duas bases para a mesma ideia é convite a
 * coroar o segundo colocado de ouro.
 */
const STEP_HEIGHT = [
  { step: "h-20", stepSm: "h-12" },
  { step: "h-14", stepSm: "h-9" },
  { step: "h-10", stepSm: "h-7" },
] as const;

/**
 * `step` carrega a cor do número do degrau junto com o fundo: o degrau de ouro
 * é cheio, e aí o número precisa da tinta `gold-foreground` (4,5:1 nos dois
 * temas), não do `text-gold`, que some sobre o próprio ouro.
 */
const TONE_CLASS: Record<PodiumToken | "plain", { ring: string; text: string; step: string }> = {
  gold: { ring: "ring-gold", text: "text-gold", step: "border-gold bg-gold text-gold-foreground" },
  silver: { ring: "ring-silver", text: "text-silver", step: "border-silver/40 bg-silver/15 text-silver" },
  bronze: { ring: "ring-bronze", text: "text-bronze", step: "border-bronze/40 bg-bronze/15 text-bronze" },
  /** Colocação fora do trio: nada de medalha, só o número. */
  plain: { ring: "ring-border", text: "text-muted-foreground", step: "border-border bg-muted/40 text-muted-foreground" },
};

/**
 * Colocação a escrever no degrau: a congelada quando existe, senão a da lista.
 * Coroa, medalha e altura seguem daí — 5º lugar não recebe ouro.
 */
const placeOf = (entry: PodiumEntry, index: number) => entry.place ?? index + 1;
const toneOf = (place: number) => TONE_CLASS[podiumToken(place - 1) ?? "plain"];

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
  const config = STEP_HEIGHT[place];
  const colocacao = placeOf(entry, place);
  const tone = toneOf(colocacao);
  const first = colocacao === 1;
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
        {/* O brilho vai num invólucro, não no Avatar: `.glow-highlight` e o
            `ring` do Tailwind escrevem os dois em `box-shadow`, e o anel de
            ouro do 1º lugar sumiria sob o brilho. */}
        <span className={cn("block rounded-full", first && "glow-highlight")}>
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
        {num(points)}
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
        <span className={cn("font-display font-bold", size === "sm" ? "text-sm" : "text-lg")}>
          {colocacao}º
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
        <li key={entry.id} className="min-w-0" aria-label={`${placeOf(entry, place)}º lugar: ${entry.name}, ${num(entry.points)} pontos`}>
          <Step entry={entry} place={place} size={size} onSelect={onSelect} still={still} />
        </li>
      ))}
    </ol>
  );
}
