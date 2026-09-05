import { date as fmtDate, dateTime } from "@/lib/format";

/**
 * Os dois estados em que um link público para de abrir sem que ninguém do lado
 * de dentro saiba.
 *
 * `public_links.expires_at` existe desde a 0009 e `locked_until` desde a 0033, e
 * nenhuma tela lia qualquer um dos dois: o link vencia (ou travava por 5 PINs
 * errados) e quem estava do outro lado recebia a mesma frase de PIN errado — de
 * propósito, para a recusa não virar oráculo de slug. O remédio, então, precisa
 * estar na tela de quem administra.
 */

/** Quantos dias a 0062 dá a um link novo — e quantos o botão "Renovar validade" repõe. */
export const LINK_VALIDITY_DAYS = 90;

const DAY_MS = 86_400_000;

export type ExpiryTone = "ok" | "warn" | "bad";

export const linkExpiry = (
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): { tone: ExpiryTone; label: string; days: number | null } => {
  if (!expiresAt) {
    // Link anterior à 0062. Não é "ok": link sem prazo e sem revogação nunca
    // fecha depois de vazar.
    return { tone: "warn", label: "Sem validade — renove para dar prazo", days: null };
  }
  const days = Math.floor((new Date(expiresAt).getTime() - now) / DAY_MS);
  if (days < 0) return { tone: "bad", label: `Vencido em ${fmtDate(expiresAt)} — não abre`, days };
  if (days <= 7) return { tone: "warn", label: `Vence em ${days} dia${days === 1 ? "" : "s"} (${fmtDate(expiresAt)})`, days };
  return { tone: "ok", label: `Vence ${fmtDate(expiresAt)}`, days };
};

/**
 * O link está travado pelo lockout de 5 PINs errados (0033)?
 *
 * Enquanto durar, nem o PIN certo abre — e o gerente do outro lado só vê "PIN
 * incorreto". Sem isto na tela, o admin só descobria por telefone.
 */
export const linkLock = (
  lockedUntil: string | null | undefined,
  failedAttempts: number | null | undefined,
  now: number = Date.now(),
): { locked: boolean; label: string | null } => {
  const until = lockedUntil ? new Date(lockedUntil).getTime() : 0;
  if (until > now) {
    return { locked: true, label: `Travado até ${dateTime(lockedUntil)} — 5 PINs errados` };
  }
  const attempts = failedAttempts ?? 0;
  if (attempts > 0) {
    return {
      locked: false,
      label: `${attempts} PIN${attempts === 1 ? "" : "s"} errado${attempts === 1 ? "" : "s"} desde o último acerto`,
    };
  }
  return { locked: false, label: null };
};
