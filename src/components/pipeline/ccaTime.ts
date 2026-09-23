/** Dias completos; datas ausentes/inválidas nunca viram "0 dias". */
export function elapsedDays(since: string | null | undefined, now = Date.now()): number | null {
  const time = since ? Date.parse(since) : NaN;
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / 86_400_000)) : null;
}

export const elapsedLabel = (days: number | null): string =>
  days === null ? "Tempo não informado" : days === 0 ? "Menos de 1 dia" : `${days} ${days === 1 ? "dia" : "dias"}`;
