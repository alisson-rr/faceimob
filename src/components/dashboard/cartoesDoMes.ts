import { statusKey, type DealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import { ALL_MONTHS, previousMonth, type DealRow } from "./data";

/**
 * O que os cartões do topo da Dashboard contam pelo Status 1/Status 2 (pedido
 * de 28/09/2026). Vendas e VGV continuam por `outcome` (`statsOf`), como nos
 * rankings; estes saem do catálogo:
 *   · produção  = Status 1 PROPOSTA + Status 1 LEGADO;
 *   · negócios  = só o Status 2 "Virou Negócio";
 *   · perdas    = Status 1 OFF — o grupo já traz "18. QUEDA" e "OFF", que
 *                 acontecem no mesmo mês;
 *   · distratos = Status 1 DISTRATO, que vem depois do mês fechado e por isso
 *                 o cartão mostra o do mês ANTERIOR.
 * Grupo pelo `code` do catálogo (imutável, 0149), não pelo rótulo editável.
 */
export type ContagemDoMes = {
  propostas: number;
  legado: number;
  producao: number;
  negocios: number;
  perdas: number;
  distratos: number;
};

const semAcento = (texto: string) => texto.normalize("NFD").replace(/\p{M}/gu, "");

export function contarDoMes(rows: DealRow[], catalog: Pick<DealStatusCatalog, "groupById">): ContagemDoMes {
  const contagem: ContagemDoMes = { propostas: 0, legado: 0, producao: 0, negocios: 0, perdas: 0, distratos: 0 };
  for (const deal of rows) {
    const code = deal.status_group_id ? catalog.groupById.get(deal.status_group_id)?.code : undefined;
    if (code === "PROPOSTA") contagem.propostas += 1;
    if (code === "LEGADO") contagem.legado += 1;
    if (code === "OFF") contagem.perdas += 1;
    if (code === "DISTRATO") contagem.distratos += 1;
    if (semAcento(statusKey(deal.status)) === "VIROU NEGOCIO") contagem.negocios += 1;
  }
  contagem.producao = contagem.propostas + contagem.legado;
  return contagem;
}

/**
 * Os números do mês escolhido e os do mês anterior (para o comparativo), mais
 * os distratos do mês anterior e do anterior a ele (o comparativo do cartão de
 * distratos). Em "todos os meses" não há anterior: comparativos e distratos do
 * mês anterior somem.
 */
export function cartoesDoPeriodo(
  deals: DealRow[],
  mes: string,
  catalog: Pick<DealStatusCatalog, "groupById">,
) {
  const doMes = (m: string | null) => (m ? contarDoMes(deals.filter((deal) => deal.month_base === m), catalog) : null);
  if (mes === ALL_MONTHS) {
    return { atual: contarDoMes(deals, catalog), anterior: null, distratosAnterior: null, distratosAntesDoAnterior: null };
  }
  const anterior = previousMonth(mes);
  const antesDoAnterior = anterior ? previousMonth(anterior) : null;
  const contagemAnterior = doMes(anterior);
  return {
    atual: doMes(mes) as ContagemDoMes,
    anterior: contagemAnterior,
    distratosAnterior: contagemAnterior?.distratos ?? null,
    distratosAntesDoAnterior: doMes(antesDoAnterior)?.distratos ?? null,
  };
}
