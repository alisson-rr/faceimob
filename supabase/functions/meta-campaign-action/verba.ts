import { deCentavos, paraCentavos } from "../_shared/metaInsights.ts";

/**
 * Verba da campanha como a Meta a devolve AGORA, e a escala proporcional de ABO.
 *
 * Puro (o único import também é puro), para o vitest carregar: é dinheiro de
 * verdade e o erro do sistema antigo foi exatamente aqui — gravar o valor cheio
 * em cada conjunto (2 conjuntos com R$ 100 viravam R$ 200 por dia).
 *
 * Tudo em centavos inteiros, como a Meta recebe: converter para reais e voltar
 * no meio da conta é onde o arredondamento some com um centavo.
 */

/** Mínimo por conjunto que a escala respeita: R$ 1,00. Abaixo disso a Meta
 *  recusa, e um conjunto zerado deixaria de veicular sem ninguém ter decidido. */
export const MINIMO_CENTAVOS = 100;

export type ConjuntoAoVivo = {
  id?: string;
  name?: string;
  status?: string;
  daily_budget?: unknown;
  lifetime_budget?: unknown;
};

export type ConjuntoComVerba = { id: string; nome: string | null; daily_budget_centavos: number };

/** Centavos inteiros a partir do texto em centavos da Meta ("12345"); null sem valor. */
function centavos(v: unknown): number | null {
  const reais = deCentavos(v);
  return reais === null ? null : paraCentavos(reais);
}

/**
 * Onde está a verba, pela campanha lida agora: na campanha (CBO), verba total
 * (lifetime, que não se muda por aqui) ou nos conjuntos (ABO). O que o banco
 * diz em `meta_budget_level` pode ter um dia de atraso; quem manda é a Meta.
 */
export function verbaDaCampanha(
  c: { daily_budget?: unknown; lifetime_budget?: unknown },
): { nivel: "campaign"; centavos: number } | { nivel: "lifetime" } | { nivel: "adset" } {
  const diaria = centavos(c.daily_budget) ?? 0;
  if (diaria > 0) return { nivel: "campaign", centavos: diaria };
  if ((centavos(c.lifetime_budget) ?? 0) > 0) return { nivel: "lifetime" };
  return { nivel: "adset" };
}

/**
 * Em ABO, os conjuntos que a escala mexe: status próprio ACTIVE (o do conjunto,
 * não o effective_status, que vira CAMPAIGN_PAUSED com a campanha pausada) e
 * verba diária. A verba da campanha é a soma deles.
 *
 * Conjunto ativo com verba total: lança. Escalar só os de verba diária mudaria a
 * proporção entre eles sem ninguém ter pedido.
 */
export function conjuntosComVerba(adsets: ConjuntoAoVivo[]): ConjuntoComVerba[] {
  const ativos = adsets.filter(
    (a): a is ConjuntoAoVivo & { id: string } => a.status === "ACTIVE" && typeof a.id === "string" && a.id !== "",
  );
  if (ativos.some((a) => (centavos(a.daily_budget) ?? 0) === 0 && (centavos(a.lifetime_budget) ?? 0) > 0)) {
    throw new RangeError("Conjunto ativo com verba total: mude no Gerenciador de Anúncios.");
  }
  return ativos.flatMap((a) => {
    const diaria = centavos(a.daily_budget) ?? 0;
    return diaria > 0 ? [{ id: a.id, nome: a.name ?? null, daily_budget_centavos: diaria }] : [];
  });
}

/**
 * A verba nova da campanha repartida entre os conjuntos na MESMA proporção de
 * antes, em centavos, com mínimo de 100 por conjunto e a soma fechando no total.
 *
 * Quem ficaria abaixo do mínimo fica no mínimo, e os outros dividem o resto na
 * proporção deles. O centavo que sobra do arredondamento vai para quem teve a
 * maior fração (maior resto), e o empate fica com o primeiro da lista.
 *
 * Lança, em vez de devolver algo "perto": lista vazia, valor que não é inteiro
 * positivo, ou total que não cobre o mínimo de todos.
 */
export function escalarConjuntos(
  conjuntos: { id: string; daily_budget_centavos: number }[],
  totalNovoCentavos: number,
): { id: string; de: number; para: number }[] {
  if (conjuntos.length === 0) throw new RangeError("Nenhum conjunto ativo com verba diária para escalar.");
  if (!Number.isSafeInteger(totalNovoCentavos) || totalNovoCentavos <= 0) {
    throw new RangeError("Verba nova inválida: esperado um valor em centavos maior que zero.");
  }
  if (conjuntos.some((c) => !Number.isSafeInteger(c.daily_budget_centavos) || c.daily_budget_centavos <= 0)) {
    throw new RangeError("Conjunto sem verba diária válida: nada foi escalado.");
  }
  if (totalNovoCentavos < MINIMO_CENTAVOS * conjuntos.length) {
    throw new RangeError(
      `A verba nova não cobre o mínimo de R$ 1,00 por conjunto (${conjuntos.length} conjuntos ativos).`,
    );
  }

  // Cada volta prende no mínimo quem ficaria abaixo dele. O último livre nunca
  // cai abaixo (o total cobre o mínimo de todos), então a lista de livres não esvazia.
  const noMinimo = new Set<number>();
  let livres = conjuntos.map((_, i) => i);
  for (;;) {
    const peso = livres.reduce((s, i) => s + conjuntos[i].daily_budget_centavos, 0);
    const resto = totalNovoCentavos - MINIMO_CENTAVOS * noMinimo.size;
    const abaixo = livres.filter((i) => resto * conjuntos[i].daily_budget_centavos < MINIMO_CENTAVOS * peso);
    if (abaixo.length === 0) break;
    abaixo.forEach((i) => noMinimo.add(i));
    livres = livres.filter((i) => !noMinimo.has(i));
  }

  const peso = livres.reduce((s, i) => s + conjuntos[i].daily_budget_centavos, 0);
  const resto = totalNovoCentavos - MINIMO_CENTAVOS * noMinimo.size;
  // Conta inteira (piso e resto da divisão), sem fração de ponto flutuante.
  const cotas = livres.map((i) => {
    const produto = resto * conjuntos[i].daily_budget_centavos;
    if (!Number.isSafeInteger(produto)) throw new RangeError("Valores grandes demais para escalar com exatidão.");
    return { i, piso: Math.floor(produto / peso), fracao: produto % peso };
  });

  const para = conjuntos.map(() => MINIMO_CENTAVOS);
  for (const c of cotas) para[c.i] = c.piso;
  let sobra = resto - cotas.reduce((s, c) => s + c.piso, 0);
  for (const c of [...cotas].sort((a, b) => b.fracao - a.fracao || a.i - b.i)) {
    if (sobra <= 0) break;
    para[c.i] = c.piso + 1;
    sobra--;
  }

  return conjuntos.map((c, i) => ({ id: c.id, de: c.daily_budget_centavos, para: para[i] }));
}
