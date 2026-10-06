import type { LinhaDoPainel } from "./gestaoDeAnuncios";

/**
 * Simulador de verba diária (pedido de 03/10/2026): chegar a um alvo por dia
 * com mais leads SEM reiniciar a fase de aprendizado da Meta. Cada campanha
 * muda no máximo 20% por vez — o banco só pede o aviso de aprendizado a partir
 * de 30% (`meta_action_precisa_aprendizado`), então a realocação nunca o abre.
 * Para escalar além disso, repete-se o degrau depois de 48 h.
 *
 * Estratégias:
 *  - mais_leads: sobe primeiro quem tem o menor CPL, corta primeiro o pior, e
 *    ainda tira verba de quem está acima do CPL médio para quem está abaixo.
 *    Campanha sem CPL (gastou sem lead, ou nem gastou) não ganha verba.
 *  - proporcional: todas no mesmo percentual, dentro dos 20%.
 *
 * Contas em centavos inteiros: o teto de 20% nunca escapa por arredondamento.
 * Leads por dia são estimativa (verba ÷ CPL do período), não promessa.
 */
export const LIMITE_SEM_APRENDIZADO = 0.2;

/** Degrau de ±20%: no máximo o limite, em centavos, para nunca passar dele no arredondamento. */
export function verbaDoDegrau(atual: number, sentido: 1 | -1): number {
  const centavos = Math.round(atual * 100) * (1 + sentido * LIMITE_SEM_APRENDIZADO);
  return (sentido === 1 ? Math.floor(centavos) : Math.ceil(centavos)) / 100;
}

export type Estrategia = "mais_leads" | "proporcional";

export const ROTULO_DA_ESTRATEGIA: Record<Estrategia, string> = {
  mais_leads: "Mais leads (verba para o menor CPL)",
  proporcional: "Proporcional (todas no mesmo %)",
};

export type Ajuste = {
  id: string;
  name: string;
  de: number;
  para: number;
  variacao: number;
  cpl: number | null;
};

export type Simulacao = {
  ajustes: Ajuste[];
  /** Ativas com verba diária que o simulador pode mexer. */
  campanhas: number;
  /** Ativas que ficam de fora: verba total ou nível de verba não sincronizado. */
  foraDoSimulador: number;
  totalAtual: number;
  totalNovo: number;
  /** O máximo e o mínimo alcançáveis hoje sem passar dos 20% em nenhuma. */
  teto: number;
  piso: number;
  leadsAtuais: number | null;
  leadsNovos: number | null;
  cplAtual: number | null;
  cplNovo: number | null;
};

/** `semDados`: ainda não gastou no período — sem CPL, mas também sem prova de que é ruim. */
type Item = {
  id: string; name: string; de: number; min: number; max: number; para: number; cpl: number | null; semDados: boolean;
};

const podeMexer = (l: LinhaDoPainel) =>
  l.ativa && (l.dailyBudget ?? 0) > 0 && (l.metaBudgetLevel === "campaign" || l.metaBudgetLevel === "adset");

function estimativa(itens: Item[], verba: (i: Item) => number) {
  const comCpl = itens.filter((i) => i.cpl !== null && i.cpl > 0);
  if (comCpl.length === 0) return { leads: null, cpl: null };
  const gasto = comCpl.reduce((t, i) => t + verba(i), 0);
  // Centavos ÷ R$ por lead = leads × 100; centavos ÷ (leads × 100) = R$ por lead.
  const leads100 = comCpl.reduce((t, i) => t + verba(i) / (i.cpl ?? 1), 0);
  return { leads: leads100 / 100, cpl: leads100 > 0 ? gasto / leads100 : null };
}

export function simularVerba(linhas: LinhaDoPainel[], alvoPorDia: number, estrategia: Estrategia): Simulacao {
  const ativas = linhas.filter((l) => l.ativa);
  const itens: Item[] = ativas.filter(podeMexer).map((l) => {
    const de = Math.round((l.dailyBudget ?? 0) * 100);
    return {
      id: l.id,
      name: l.name,
      de,
      min: Math.ceil(de * (1 - LIMITE_SEM_APRENDIZADO)),
      max: Math.floor(de * (1 + LIMITE_SEM_APRENDIZADO)),
      para: de,
      cpl: l.resultados > 0 && l.custoPorResultado !== null ? l.custoPorResultado : null,
      semDados: l.investido <= 0,
    };
  });

  const totalAtual = itens.reduce((t, i) => t + i.de, 0);
  const alvo = Math.round(Math.max(0, alvoPorDia) * 100);
  // Melhor CPL primeiro; quem gastou sem lead por último. Sem dados fica fora
  // da realocação e só é cortado se o alvo pedir corte e não houver outro.
  const ordem = itens.filter((i) => !i.semDados).sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity));
  const neutros = itens.filter((i) => i.semDados);

  if (estrategia === "proporcional") {
    const fator = totalAtual > 0 ? alvo / totalAtual : 1;
    for (const i of itens) i.para = Math.min(i.max, Math.max(i.min, Math.round(i.de * fator)));
  } else {
    let falta = alvo - totalAtual;
    if (falta > 0) {
      for (const i of ordem) {
        if (i.cpl === null || falta <= 0) continue;
        const sobe = Math.min(i.max - i.para, falta);
        i.para += sobe;
        falta -= sobe;
      }
    } else if (falta < 0) {
      for (const i of [...ordem].reverse().concat(neutros)) {
        if (falta >= 0) break;
        const corta = Math.min(i.para - i.min, -falta);
        i.para -= corta;
        falta += corta;
      }
    }

    // Realocação: do pior para o melhor, só cruzando o CPL médio (a verba de
    // quem gastou sem lead entra na média) — não tira de uma campanha boa para
    // dar a outra quase igual.
    const leadsHoje = estimativa(ordem, (i) => i.de).leads;
    const media = leadsHoje ? ordem.reduce((t, i) => t + i.de, 0) / 100 / leadsHoje : null;
    if (media !== null) {
      let a = 0;
      let z = ordem.length - 1;
      while (a < z) {
        const melhor = ordem[a];
        const pior = ordem[z];
        if (melhor.cpl === null || melhor.cpl >= media) break;
        if (pior.cpl !== null && pior.cpl <= media) break;
        const sobe = melhor.max - melhor.para;
        const desce = pior.para - pior.min;
        if (sobe <= 0) { a++; continue; }
        if (desce <= 0) { z--; continue; }
        const move = Math.min(sobe, desce);
        melhor.para += move;
        pior.para -= move;
      }
    }
  }

  const sobemSemCpl = estrategia === "mais_leads";
  const teto = itens.reduce((t, i) => t + (sobemSemCpl && i.cpl === null ? i.de : i.max), 0);
  const antes = estimativa(itens, (i) => i.de);
  const depois = estimativa(itens, (i) => i.para);

  return {
    ajustes: itens
      .filter((i) => i.para !== i.de)
      .map((i) => ({ id: i.id, name: i.name, de: i.de / 100, para: i.para / 100, variacao: (i.para - i.de) / i.de, cpl: i.cpl }))
      // Cortes primeiro: executados nessa ordem, a conta nunca gasta acima do alvo no meio do caminho.
      .sort((x, y) => (x.para - x.de) - (y.para - y.de)),
    campanhas: itens.length,
    foraDoSimulador: ativas.length - itens.length,
    totalAtual: totalAtual / 100,
    totalNovo: itens.reduce((t, i) => t + i.para, 0) / 100,
    teto: teto / 100,
    piso: itens.reduce((t, i) => t + i.min, 0) / 100,
    leadsAtuais: antes.leads,
    leadsNovos: depois.leads,
    cplAtual: antes.cpl,
    cplNovo: depois.cpl,
  };
}
