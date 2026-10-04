import { statusKey } from "@/integrations/supabase/dealStatuses";
import { contaComoVenda } from "@/lib/dealStatus";
import type { DealRow } from "./data";

/**
 * Esteira de crédito do Dashboard pelo Status 2 (pedido de 04/10/2026), nos
 * negócios do mês-base escolhido. É a foto de agora: cada negócio conta onde
 * está hoje.
 *   1. Docs enviadas — Esteira Ágil e Retorno à Esteira Ágil;
 *   2. Aprovados     — Aprov. Total e Aprov. Cond.;
 *   3. Pendentes     — Pendente;
 *   4. Reprovados    — Reprovado;
 *   5. Virou negócio;
 *   6. Convertidos   — venda (fechado ou Status 1 VENDA) que passou pelo CCA.
 */
export type EsteiraDoMes = {
  docs: number;
  aprovados: number;
  pendentes: number;
  reprovados: number;
  virouNegocio: number;
  convertidos: number;
};

const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "");

const FAIXA: Record<string, keyof EsteiraDoMes> = {
  "ESTEIRA AGIL": "docs",
  "RET. ESTEIRA AGIL": "docs",
  "RETORNO A ESTEIRA AGIL": "docs",
  "APROV. TOTAL": "aprovados",
  "APROV. COND.": "aprovados",
  PENDENTE: "pendentes",
  REPROVADO: "reprovados",
  "VIROU NEGOCIO": "virouNegocio",
};

export function esteiraDoMes(
  deals: Pick<DealRow, "id" | "status_detail" | "outcome" | "status_group_code">[],
  ccaDealIds: ReadonlySet<string>,
): EsteiraDoMes {
  const conta: EsteiraDoMes = { docs: 0, aprovados: 0, pendentes: 0, reprovados: 0, virouNegocio: 0, convertidos: 0 };
  for (const deal of deals) {
    if (contaComoVenda(deal)) {
      if (ccaDealIds.has(deal.id)) conta.convertidos += 1;
      continue;
    }
    const faixa = FAIXA[semAcento(statusKey(deal.status_detail))];
    if (faixa) conta[faixa] += 1;
  }
  return conta;
}
