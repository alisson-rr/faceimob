import { bareStatus } from "./dealStatus";

/** Pendências internas: a coluna do CCA muda, o status comercial é preservado. */
export function isIndependentCcaStage(name?: string | null): boolean {
  const key = bareStatus(name ?? "").normalize("NFD").replace(/\p{M}/gu, "");
  return key === "RESOLVER P/ ASSINAR BANCO" || key === "AGUARDANDO DEMANDA MINIMA";
}
