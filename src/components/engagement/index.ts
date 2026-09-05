/**
 * Camada de engajamento: som, confete, comemorações e pódio.
 *
 * Uso mínimo, no `AppLayout`:
 *
 * ```tsx
 * <EngagementLayer>…</EngagementLayer>   // provider + avisos globais
 * <SoundToggle />                        // no header, antes do RoleSwitcher
 * ```
 *
 * Em qualquer tela:
 *
 * ```tsx
 * const celebrate = useCelebration();
 * celebrate("lead_claimed", { title: lead.full_name });
 * ```
 */
export { EngagementLayer } from "./EngagementLayer";
export { SoundToggle } from "./SoundToggle";
export { SoundPreview } from "./SoundPreview";
export { Podium, type PodiumEntry, type PodiumProps } from "./Podium";
export { useCelebration, type Celebrate, type CelebrationPayload } from "./context";
export { fireConfetti, type ConfettiOrigin } from "./Confetti";
export { buildScores, buildFrozenScores, UNKNOWN_PERSON, type BrokerScore } from "./ranking";
export type { CelebrationKind } from "@/lib/engagement/celebrations";
