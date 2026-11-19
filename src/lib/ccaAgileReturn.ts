import { bareStatus } from "./dealStatus";

const key = (value?: string | null) => bareStatus(value ?? "").normalize("NFD").replace(/\p{M}/gu, "");
export const isCcaAgileStage = (name: string) => key(name) === "ESTEIRA AGIL";
/** 0348: decide o Status 2 (a coluna do card), não o status do caso — o caso
 *  da 1ª tentativa ficou `under_review` com o Status 2 ainda da agência. */
export const canReturnCcaToAgile = (deal: { status?: string; dealStatus?: string | null }) =>
  key(deal.dealStatus) === "AG. RET. AGENCIA";
