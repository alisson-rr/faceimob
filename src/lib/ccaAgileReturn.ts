import { bareStatus } from "./dealStatus";

const key = (value?: string | null) => bareStatus(value ?? "").normalize("NFD").replace(/\p{M}/gu, "");
export const isCcaAgileStage = (name: string) => key(name) === "ESTEIRA AGIL";
export const canReturnCcaToAgile = (deal: { status: string; dealStatus?: string | null }) =>
  deal.status === "sent_to_agency" && key(deal.dealStatus) === "AG. RET. AGENCIA";
