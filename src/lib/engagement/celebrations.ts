/**
 * Regras puras da camada de engajamento.
 *
 * Aqui não há React, DOM nem Supabase: é a tabela única que diz o que cada
 * comemoração toca e desenha, mais as três decisões que precisavam de teste —
 * agrupar as vendas do mesmo negócio, detectar subida no ranking e ler a cor
 * de um token HSL.
 */

import type { SoundName } from "./audio";

export type CelebrationKind =
  | "lead_new"
  | "lead_claimed"
  | "checkin"
  | "rank_up"
  | "sale"
  | "goal";

export type ConfettiPreset = "none" | "burst" | "rain" | "fireworks";

/** `none` = o gatilho já tem visual próprio (o popup de lead, por exemplo). */
export type CelebrationVisual = "none" | "toast" | "card";

/**
 * A tabela. Um kind = um som, um confete e um visual — mudar o efeito de uma
 * comemoração é mudar uma linha aqui, não caçar `playX()` espalhado pelas telas.
 */
export const CELEBRATION: Record<
  CelebrationKind,
  { sound: SoundName; confetti: ConfettiPreset; visual: CelebrationVisual }
> = {
  lead_new:     { sound: "leadNew",     confetti: "none",      visual: "none"  },
  lead_claimed: { sound: "leadClaimed", confetti: "burst",     visual: "toast" },
  checkin:      { sound: "checkin",     confetti: "none",      visual: "toast" },
  rank_up:      { sound: "rankUp",      confetti: "burst",     visual: "toast" },
  sale:         { sound: "sale",        confetti: "rain",      visual: "card"  },
  goal:         { sound: "goal",        confetti: "fireworks", visual: "toast" },
};

// ── venda: um negócio, uma comemoração ───────────────────────────────────────

export type SaleEvent = { id: string; profileId: string; refId: string | null };

export type SaleBatch = { key: string; eventIds: string[]; profileIds: string[] };

/**
 * Agrupa os eventos `venda` por negócio (`ref_id`).
 *
 * O trigger `deals_award_points` grava uma linha em `game_events` por corretor
 * do rateio, então um negócio com três corretores chegava como três eventos —
 * três fanfarras sobrepostas e o nome do card trocando no meio. Um negócio =
 * um lote = um som e um card com todos os nomes.
 *
 * Evento sem `ref_id` (correção manual do admin) não tem negócio para agrupar:
 * vira um lote só dele, senão dois ajustes viravam uma comemoração só.
 */
export function groupSaleEvents(events: SaleEvent[]): SaleBatch[] {
  const batches: SaleBatch[] = [];
  const byKey = new Map<string, SaleBatch>();

  for (const event of events) {
    const key = event.refId ?? `event:${event.id}`;
    let batch = byKey.get(key);
    if (!batch) {
      batch = { key, eventIds: [], profileIds: [] };
      byKey.set(key, batch);
      batches.push(batch);
    }
    if (!batch.eventIds.includes(event.id)) batch.eventIds.push(event.id);
    if (!batch.profileIds.includes(event.profileId)) batch.profileIds.push(event.profileId);
  }

  return batches;
}

/** "Ana" · "Ana e Bruno" · "Ana, Bruno e Carlos". Sem nome resolvido: "Equipe". */
export function joinNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return "Equipe";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} e ${clean[clean.length - 1]}`;
}

// ── ranking: só o próprio usuário, só quando sobe ────────────────────────────

/**
 * Compara a posição do usuário entre dois rankings já ordenados (lista de
 * `profile_id`, do 1º ao último) e devolve o salto quando ele sobe.
 *
 * Devolve `null` quando não dá para afirmar que subiu: sem usuário, ausente de
 * um dos dois lados (primeira carga tem `previous` vazio) ou posição igual/pior.
 * Descer não comemora, e entrar no ranking pela primeira vez também não — não
 * há "de onde" para mostrar.
 */
export function detectRankUp(
  previous: string[],
  next: string[],
  profileId: string | null | undefined,
): { from: number; to: number } | null {
  if (!profileId) return null;

  const from = previous.indexOf(profileId) + 1;
  const to = next.indexOf(profileId) + 1;
  if (from === 0 || to === 0) return null;

  return to < from ? { from, to } : null;
}

// ── cor: token do tema → hex, que é o que o canvas-confetti aceita ───────────

/**
 * Converte `H S% L%` (o formato dos tokens em `index.css`) para hex.
 *
 * O `canvas-confetti` só entende hex — ele passa a string por um `hexToRgb`
 * próprio, então `hsl(var(--primary))` sairia preto. Como o valor do token
 * muda entre tema claro e escuro, a leitura é feita a cada disparo.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * Math.min(1, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Lê `"214 72% 62%"` como veio do `getComputedStyle`. Formato inesperado → null. */
export function parseHslToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = raw.trim().replace(/,/g, " ").split(/\s+/);
  if (parts.length < 3) return null;
  const [h, s, l] = parts.map((part) => Number.parseFloat(part));
  if (![h, s, l].every(Number.isFinite)) return null;
  return hslToHex(h, s, l);
}
