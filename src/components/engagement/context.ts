import { createContext, useContext } from "react";
import type { CelebrationKind } from "@/lib/engagement/celebrations";
import type { ConfettiOrigin } from "./Confetti";

/**
 * Contexto da camada de engajamento — fica separado do `EngagementLayer` para
 * que os componentes que ele monta (o card de venda, o aviso de lead) possam
 * consumir `celebrate` sem import circular.
 */

export type CelebrationPayload = {
  /** Identidade do evento: chave de animação do card e do toast. */
  id?: string;
  /** Linha principal — nome do corretor, do lead, da meta. */
  title?: string;
  detail?: string;
  /** `rank_up`: posição anterior e nova. */
  from?: number;
  to?: number;
  /** De onde o confete sai (elemento clicado ou ponto normalizado). */
  origin?: ConfettiOrigin;
};

export type Celebrate = (kind: CelebrationKind, payload?: CelebrationPayload) => void;

export const CelebrationContext = createContext<Celebrate>(() => {});

/**
 * Único jeito de comemorar. Som, confete e visual saem da tabela `CELEBRATION`
 * — nenhuma tela toca som ou dispara confete direto.
 *
 * ```tsx
 * const celebrate = useCelebration();
 * celebrate("lead_claimed", { title: lead.full_name });
 * ```
 */
export function useCelebration(): Celebrate {
  return useContext(CelebrationContext);
}
