/**
 * Filtro e ordenação dos negócios — lógica pura, para poder ser testada sem
 * montar a tela.
 *
 * Construtora, corretor e gerente filtram por `id`, não por nome (F06): dois
 * "João Silva" na base colidiam num filtro só, e renomear o perfil fazia o
 * negócio sumir do filtro do próprio dono.
 */
import type { LegacyDealRecord } from "@/integrations/supabase/newSchema";
import { faceimobStatusRank } from "./statuses";

export const ALL = "all";

/**
 * Percentual em pt-BR — o rateio do corretor e as taxas do painel.
 *
 * Eram QUATRO cópias do mesmo `toLocaleString` (cartão, tabela, formulário e
 * painel de indicadores) e duas já divergiam: 50% aparecia como "50%" no cartão
 * e "50,0%" no painel, no número que define comissão. É o cenário que originou
 * o `src/lib/format.ts` (6 formatadores de BRL discordando), reencenado.
 *
 * `toLocaleString` e não `toFixed`: com 3 corretores a 0058 grava 33.333 e
 * 33.334, e `toFixed(1)` devolve "33.3%" — ponto decimal em pt-BR.
 *
 * ponytail: mora aqui porque `src/lib/format.ts` é de outra frente; registrado
 * como pendência — evoluir para `format.ts` quando aquela frente aceitar o
 * helper, e então esta função vira reexport.
 */
export const pct = (value: number | null | undefined, options?: { casas?: number }): string =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: options?.casas ?? 1 })}%`;

export type DealFilterState = {
  search: string;
  stage: string;
  status2: string;
  documentReview: string;
  developerId: string;
  brokerId: string;
  managerId: string;
  month: string;
  client: string;
  client2: string;
  cpf: string;
  cpf2: string;
};

export const EMPTY_FILTERS: DealFilterState = {
  search: "",
  stage: ALL,
  status2: ALL,
  documentReview: ALL,
  developerId: ALL,
  brokerId: ALL,
  managerId: ALL,
  month: ALL,
  client: "",
  client2: "",
  cpf: "",
  cpf2: "",
};

export const hasActiveFilter = (filters: DealFilterState): boolean =>
  (Object.keys(EMPTY_FILTERS) as (keyof DealFilterState)[]).some(
    (key) => filters[key] !== EMPTY_FILTERS[key],
  );

const includes = (value: string | null | undefined, needle: string) =>
  (value || "").toLowerCase().includes(needle.toLowerCase());

/** Só dígitos: o CPF é digitado com e sem pontuação. */
const digits = (value: string | null | undefined) => (value || "").replace(/\D/g, "");

/** Mês do negócio: o `month_base` manda; sem ele, o mês de criação.
 *
 *  `Pick` e não `LegacyDealRecord`: o formulário do modal (`SaveLegacyDealInput`)
 *  precisa da MESMA conta para saber se o mês está congelado, e um `as` só para
 *  satisfazer a assinatura seria cast na fronteira errada. */
export const dealMonth = (deal: Pick<LegacyDealRecord, "month_base" | "created_at">): string =>
  deal.month_base || (deal.created_at ? `${deal.created_at.slice(5, 7)}/${deal.created_at.slice(0, 4)}` : "");

/** Participante do negócio em qualquer slot — o filtro não pergunta "é o 1?". */
const participantIds = (deal: LegacyDealRecord) => [
  deal.broker1_id, deal.broker2_id, deal.broker3_id,
];
const managerIds = (deal: LegacyDealRecord) => [
  deal.manager1_id, deal.manager2_id, deal.manager3_id,
];

export function applyDealFilters(
  deals: LegacyDealRecord[],
  filters: DealFilterState,
): LegacyDealRecord[] {
  const term = filters.search.trim();
  const cpf = digits(filters.cpf);
  const cpf2 = digits(filters.cpf2);

  return deals.filter((deal) => {
    if (term && !(
      includes(deal.client, term) ||
      includes(deal.client2, term) ||
      includes(deal.project, term) ||
      includes(deal.broker1, term) ||
      includes(deal.code, term)
    )) return false;

    if (filters.developerId !== ALL && deal.developer_id !== filters.developerId) return false;
    if (filters.brokerId !== ALL && !participantIds(deal).includes(filters.brokerId)) return false;
    if (filters.managerId !== ALL && !managerIds(deal).includes(filters.managerId)) return false;
    if (filters.stage !== ALL && deal.stage !== filters.stage) return false;
    if (filters.status2 !== ALL && deal.status !== filters.status2) return false;
    if (filters.documentReview !== ALL && deal.document_review_status !== filters.documentReview) return false;
    if (filters.month !== ALL && dealMonth(deal) !== filters.month) return false;
    if (filters.client && !includes(deal.client, filters.client)) return false;
    if (filters.client2 && !includes(deal.client2, filters.client2)) return false;
    if (cpf && !digits(deal.cpf).includes(cpf)) return false;
    if (cpf2 && !digits(deal.cpf2).includes(cpf2)) return false;
    return true;
  });
}

/** Construtora primeiro, depois a ordem do catálogo de Status 2. */
export const sortDeals = (deals: LegacyDealRecord[]): LegacyDealRecord[] =>
  [...deals].sort((a, b) => {
    const byDeveloper = (a.developer || "").localeCompare(b.developer || "", "pt-BR");
    if (byDeveloper !== 0) return byDeveloper;
    return faceimobStatusRank(a.status) - faceimobStatusRank(b.status);
  });

/** Colunas por onde a tabela aceita ordenar. `padrao` = `sortDeals`. */
export type DealSortKey = "padrao" | "client" | "developer" | "vgv" | "days" | "month";

/** Comparação de uma coluna, sempre ascendente — a direção é aplicada depois. */
const SORT_VALUE: Record<Exclude<DealSortKey, "padrao">, (deal: LegacyDealRecord) => string | number> = {
  client: (deal) => deal.client || "",
  developer: (deal) => deal.developer || "",
  vgv: (deal) => deal.deal_value || 0,
  days: (deal) => deal.days_in_pipeline || 0,
  // "12/2025" ordena antes de "01/2026" só se virar AAAAMM — comparar o texto
  // "MM/AAAA" colocaria dezembro do ano passado depois de janeiro deste.
  month: (deal) => {
    const [mm, yyyy] = dealMonth(deal).split("/");
    return yyyy && mm ? Number(`${yyyy}${mm}`) : 0;
  },
};

/**
 * Ordenação da tabela por coluna.
 *
 * A ordem era fixa (construtora, depois catálogo de Status 2) e não havia como
 * responder "quais são os maiores VGV do mês?" nem "o que está parado há mais
 * tempo?" sem exportar o CSV e abrir no Excel — com 15 linhas por página, era
 * paginar 32 negócios olhando um por um.
 *
 * Empate volta para `sortDeals`, para a lista não embaralhar entre renders.
 */
export function sortDealsBy(
  deals: LegacyDealRecord[],
  key: DealSortKey,
  ascending: boolean,
): LegacyDealRecord[] {
  if (key === "padrao") return sortDeals(deals);
  const value = SORT_VALUE[key];
  const direction = ascending ? 1 : -1;
  return sortDeals(deals).sort((a, b) => {
    const left = value(a);
    const right = value(b);
    const compared = typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right as string, "pt-BR")
      : Number(left) - Number(right);
    return compared * direction;
  });
}

/**
 * O que o fechamento do mês vai fazer com o período escolhido.
 *
 * A conta mora aqui, e não no diálogo, porque ela precisa bater com o `where`
 * da RPC `close_month_and_season` (`update deals ... where outcome = 'open'`) e
 * é o número que o operador lê antes de um ato que a tela não desfaz.
 *
 * O predicado errado era `deal.active`, que é `outcome not in (lost,
 * cancelled)` — ou seja, INCLUI a venda. Em 08/2026 (18 abertos, 7 vendidos, 1
 * perdido) o diálogo prometia "25 propostas migram" e a RPC movia 18, com os 7
 * ganhos contados de novo na linha de baixo: as duas linhas somavam 33 num mês
 * de 26 negócios. Aqui elas PARTICIONAM o mês — `migram + congelam` é sempre o
 * total do período.
 */
export function monthClosePreview(deals: LegacyDealRecord[], period: string) {
  const doMes = deals.filter((deal) => dealMonth(deal) === period);
  const migram = doMes.filter((deal) => deal.outcome === "open");
  return {
    total: doMes.length,
    migram: migram.length,
    congelam: doMes.length - migram.length,
    vgvVendido: doMes
      .filter((deal) => deal.outcome === "won")
      .reduce((total, deal) => total + (deal.deal_value || 0), 0),
  };
}

/**
 * Meses fechados que ainda têm proposta ABERTA no período — a incoerência que
 * nenhuma tela mostrava.
 *
 * `close_month_and_season` migra todo `outcome = 'open'` para o mês seguinte
 * ANTES de inserir em `closed_months`: um mês fechado com proposta aberta só
 * existe quando a linha entrou por fora da RPC (importação, correção por SQL).
 * Medido na homologação em 02/09/2026: 06/2026 está nesse estado, com 1
 * negócio que ninguém consegue mover — o gatilho recusa e a tela não dizia por
 * quê.
 */
export function inconsistentClosedMonths(
  deals: Pick<LegacyDealRecord, "month_base" | "created_at" | "outcome">[],
  closedMonths: string[],
): { month: string; abertos: number }[] {
  const closed = new Set(closedMonths);
  const abertos = new Map<string, number>();
  for (const deal of deals) {
    if (deal.outcome !== "open") continue;
    const month = dealMonth(deal);
    if (closed.has(month)) abertos.set(month, (abertos.get(month) ?? 0) + 1);
  }
  return [...abertos.entries()].map(([month, count]) => ({ month, abertos: count }));
}
