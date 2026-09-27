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

/**
 * "Alan Teixeira de Oliveira" -> "Alan Oliveira". Nome de exibicao do Game
 * (pedido de 26/09/2026): placar, podio e comemoracao nao cabem o nome inteiro.
 * So exibicao — ordenar, comparar e casar pessoa continua no nome completo.
 */
export const primeiroEUltimoNome = (nome: string | null | undefined): string => {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  return partes.length > 2 ? `${partes[0]} ${partes[partes.length - 1]}` : partes.join(" ");
};

const CONECTIVOS = new Set(["da", "das", "de", "do", "dos", "e"]);

/** "Ana Beta da Silva" -> "Ana B. Silva": o degrau entre o curto e o inteiro. */
const comIniciais = (nome: string): string => {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(" ");
  const meio = partes.slice(1, -1)
    .filter((parte) => !CONECTIVOS.has(parte.toLowerCase()))
    .map((parte) => `${parte[0].toUpperCase()}.`);
  return [partes[0], ...meio, partes[partes.length - 1]].join(" ");
};

/**
 * Nome de exibicao do Game, sem homonimo na mesma lista (pedido de 26/09/2026).
 *
 * Cada nome comeca curto (`primeiroEUltimoNome`). Quem colide com OUTRA pessoa
 * da lista sobe para as iniciais do meio ("Ana B. Silva" / "Ana Z. Silva") e,
 * se ainda colidir, para o nome inteiro. A lista e o escopo que a tela mostra:
 * xara fora dela nao encurta ninguem.
 */
export const nomesDeExibicao = (nomes: Iterable<string | null | undefined>): ((nome: string | null | undefined) => string) => {
  const distintos = [...new Set(Array.from(nomes, (nome) => (nome ?? "").trim().replace(/\s+/g, " ")))];
  const rotulo = new Map(distintos.map((nome) => [nome, primeiroEUltimoNome(nome)]));

  for (const proximo of [comIniciais, (nome: string) => nome]) {
    const uso = new Map<string, number>();
    for (const r of rotulo.values()) uso.set(r, (uso.get(r) ?? 0) + 1);
    for (const nome of distintos) {
      if ((uso.get(rotulo.get(nome) ?? "") ?? 0) > 1) rotulo.set(nome, proximo(nome));
    }
  }

  return (nome) => {
    const chave = (nome ?? "").trim().replace(/\s+/g, " ");
    return rotulo.get(chave) ?? primeiroEUltimoNome(chave);
  };
};

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

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * `YYYY-MM-01` do mes da data, no fuso LOCAL. O caminho antigo (`setDate(1)` +
 * `toISOString()`) converte para UTC e, depois das 21h em Brasilia, ja devolve o
 * dia seguinte: `gte(period, "2026-09-02")` deixava de fora o aporte que acabou
 * de ser gravado em 2026-09-01.
 */
export const monthStart = (value: Date = new Date()): string =>
  `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-01`;

/**
 * Mes digitado ou vindo de planilha -> `YYYY-MM-01`, ou `null` se nao for mes.
 * Aceita `2026-08`, `2026-08-01`, `08/2026`, `01/08/2026` e a celula de data que
 * o Excel entrega como texto (`Sat Aug 01 2026 00:00:00 GMT-0300`).
 */
export const parseMonthStart = (text: string | null | undefined): string | null => {
  const value = (text ?? "").trim();
  const iso = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(value);
  const br = /^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/.exec(value);
  const parts = iso ? [Number(iso[1]), Number(iso[2])] : br ? [Number(br[2]), Number(br[1])] : null;
  if (parts) {
    const [y, m] = parts;
    return m >= 1 && m <= 12 ? `${y}-${pad2(m)}-01` : null;
  }
  // So o formato textual do Excel cai aqui: `new Date("1")` seria 2001-01-01.
  if (!/[A-Za-z]/.test(value) || !/\d{4}/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : monthStart(parsed);
};

/**
 * "R$ 5.000,50", "5.000", "5000.5" -> numero, ou `null` se nao for valor.
 * Virgula e decimal; ponto e milhar quando ha virgula ou quando agrupa de 3 em 3.
 */
export const parseBrl = (text: string | null | undefined): number | null => {
  // `\s` ja cobre o espaco duro (U+00A0) que o Excel poe entre "R$" e o numero.
  const raw = (text ?? "").replace(/R\$|\s/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, "") : raw;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
};
