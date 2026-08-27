/**
 * Formatacao pt-BR — fonte unica.
 *
 * Havia 6 formatadores de BRL (uns com centavos, outros sem) e 5 de data
 * espalhados pelas telas: o mesmo VGV aparecia "R$ 1.200.000" no Dashboard e
 * "R$ 1.200.000,00" no painel de campanha. Aqui o padrao e um so; quem precisa
 * de centavos pede.
 *
 * `null`/`undefined`/`NaN` viram travessao em vez de "R$ NaN" — dado ausente e
 * um estado legitimo em quase toda tela do CRM.
 */

const EMPTY = "—";

const currency = (fractionDigits: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

const brlWhole = currency(0);
const brlCents = currency(2);

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Valor em reais. Sem centavos por padrao — VGV e meta sao numeros grandes. */
export const brl = (value: number | null | undefined, options?: { cents?: boolean }): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return (options?.cents ? brlCents : brlWhole).format(value);
};

/** Inteiro com separador de milhar (leads, pontos, contagens). */
export const num = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY;
  return value.toLocaleString("pt-BR");
};

/**
 * `YYYY-MM-DD` do Postgres e tratado como data local, nao UTC. `new Date("2026-08-21")`
 * vira meia-noite UTC e imprime 20/08 no fuso do Brasil — um dia a menos em toda
 * data de check-in e de negocio.
 */
const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/** 21/08/2026 */
export const date = (value: string | number | Date | null | undefined): string => {
  const parsed = toDate(value);
  return parsed ? dateFmt.format(parsed) : EMPTY;
};

/** 21/08/2026 14:30 — composto a partir dos dois formatadores porque o
 *  `Intl` com data+hora juntos insere virgula ("21/08/2026, 14:30"). */
export const dateTime = (value: string | number | Date | null | undefined): string => {
  const parsed = toDate(value);
  return parsed ? `${dateFmt.format(parsed)} ${timeFmt.format(parsed)}` : EMPTY;
};
