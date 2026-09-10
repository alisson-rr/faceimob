import confetti from "canvas-confetti";
import { parseHslToken, type ConfettiPreset } from "@/lib/engagement/celebrations";

/**
 * Confete sobre `canvas-confetti`.
 *
 * Três presets, um por peso de comemoração: `burst` (pontual, sai de um
 * elemento), `rain` (venda, cai da borda de cima) e `fireworks` (meta).
 *
 * As cores saem dos tokens do tema a cada disparo — não são fixas — porque o
 * mesmo confete precisa funcionar no claro e no escuro. O `canvas-confetti` só
 * entende hex (ele passa a string por um `hexToRgb` próprio), então o token
 * `"214 72% 62%"` é convertido antes.
 *
 * `prefers-reduced-motion` desliga tudo: o `<MotionConfig reducedMotion="user">`
 * do AppLayout cobre o framer-motion, mas o canvas é desenhado fora do React e
 * precisa checar por conta própria.
 */

/** Ponto normalizado (0–1, y de cima para baixo) ou o elemento de origem. */
export type ConfettiOrigin = { x: number; y: number } | Element | null | undefined;

const TOKENS = ["--primary", "--highlight", "--success", "--gold"];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** `undefined` quando nenhum token resolveu: aí vale a paleta da biblioteca. */
function palette(): string[] | undefined {
  const style = getComputedStyle(document.documentElement);
  const colors = TOKENS
    .map((token) => parseHslToken(style.getPropertyValue(token)))
    .filter((hex): hex is string => Boolean(hex));
  return colors.length ? colors : undefined;
}

function toPoint(origin: ConfettiOrigin): { x: number; y: number } {
  if (!origin) return { x: 0.5, y: 0.4 };
  if (origin instanceof Element) {
    const rect = origin.getBoundingClientRect();
    return {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    };
  }
  return origin;
}

/** Cada rajada agendada também leva a trava nativa da biblioteca. */
function shoot(options: confetti.Options, colors: string[] | undefined) {
  void confetti({ disableForReducedMotion: true, colors, ...options });
}

export function fireConfetti(preset: ConfettiPreset, origin?: ConfettiOrigin): void {
  if (preset === "none") return;
  if (typeof window === "undefined" || prefersReducedMotion()) return;

  const colors = palette();

  if (preset === "burst") {
    shoot({ particleCount: 45, spread: 62, startVelocity: 28, scalar: 0.8, ticks: 140, origin: toPoint(origin) }, colors);
    return;
  }

  if (preset === "rain") {
    // Três levas caindo da borda de cima, alternando o lado de saída, para a
    // chuva durar o tempo do card de venda sem virar uma parede de papel.
    [0, 350, 700].forEach((delay, i) => {
      window.setTimeout(() => {
        shoot(
          {
            particleCount: 90,
            spread: 120,
            startVelocity: 32,
            gravity: 0.9,
            ticks: 260,
            scalar: 0.9,
            origin: { x: i === 1 ? 0.5 : i === 0 ? 0.25 : 0.75, y: -0.1 },
          },
          colors,
        );
      }, delay);
    });
    return;
  }

  // fireworks: rajadas em pontos aleatórios por ~2,4 s.
  const end = Date.now() + 2400;
  const timer = window.setInterval(() => {
    if (Date.now() > end) {
      window.clearInterval(timer);
      return;
    }
    shoot(
      {
        particleCount: 40,
        spread: 360,
        startVelocity: 26,
        ticks: 180,
        scalar: 0.9,
        origin: { x: 0.15 + Math.random() * 0.7, y: 0.2 + Math.random() * 0.4 },
      },
      colors,
    );
  }, 320);
}
