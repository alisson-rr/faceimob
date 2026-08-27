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

/** Mês do negócio: o `month_base` manda; sem ele, o mês de criação. */
export const dealMonth = (deal: LegacyDealRecord): string =>
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
