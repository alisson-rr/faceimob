import { statusKey, type DealStatusCatalog } from "@/integrations/supabase/dealStatuses";
import { ALL_MONTHS, noFunil, previousMonth, type DealRow } from "./data";

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

/**
 * "Negócios por etapa" pelo Status 2 (pedido de 28/09/2026): uma linha por
 * Status 2 que tem negócio no período, do maior para o menor, sem as zeradas;
 * no empate vale a ordem do cadastro de status. O conjunto é o de sempre — vendas + em aberto (`noFunil`) —, então o
 * total fecha com o que o bloco já dizia no rodapé. Status fora do catálogo
 * vira linha própria no fim, em vez de sumir do total.
 */
export function linhasDoStatus2(
  rows: DealRow[],
  catalog: Pick<DealStatusCatalog, "statuses" | "indexByKey">,
): { label: string; value: number }[] {
  const linhas = new Map<string, { label: string; value: number; ordem: number }>();
  for (const deal of rows) {
    if (!noFunil(deal)) continue;
    const chave = statusKey(deal.status);
    const indice = catalog.indexByKey.get(chave);
    const entrada = indice === undefined ? null : catalog.statuses[indice];
    const id = entrada ? entrada.id : `fora:${chave}`;
    const linha = linhas.get(id) ?? {
      label: entrada ? entrada.label || entrada.value : chave || "Sem Status 2",
      value: 0,
      ordem: indice ?? catalog.statuses.length,
    };
    linha.value += 1;
    linhas.set(id, linha);
  }
  return [...linhas.values()]
    .sort((a, b) => b.value - a.value || a.ordem - b.ordem || a.label.localeCompare(b.label, "pt-BR"))
    .map(({ label, value }) => ({ label, value }));
}
