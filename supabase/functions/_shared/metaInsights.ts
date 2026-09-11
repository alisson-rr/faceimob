/**
 * Contagem de resultados e canal das campanhas da Meta — a ÚNICA implementação.
 *
 * A sincronização (meta-sync/montar.ts) e a nota por anúncio
 * (meta-ad-scores/nota.ts) importam daqui; o SQL (meta_metricas) só soma o que
 * foi gravado. O sistema antigo tinha quatro versões desta regra, e uma delas
 * dividia o gasto TOTAL por cada canal.
 *
 * Sem `import` nenhum, de propósito: é isso que deixa o vitest carregar o arquivo.
 */

export type Canal = "formulario" | "whatsapp" | "landing_page" | "misto" | "outro";

export type Contagens = { leads_form: number; conversations: number; lp_leads: number; lp_views: number };

type Acao = { action_type: string; value: string };

function valorDe(actions: Acao[] | undefined, tipo: string): number {
  const n = Number(actions?.find((a) => a.action_type === tipo)?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Os contadores de um dia (ou de um anúncio), cada um com UMA fonte:
 *  - formulário = onsite_conversion.lead_grouped;
 *  - conversa = o MAIOR entre messaging_conversation_started_7d e
 *    total_messaging_connection (contam a mesma conversa: somar duplicaria);
 *  - landing page = offsite_conversion.fb_pixel_lead.
 * `lp_views` (landing_page_view) é só apoio e nunca conta como resultado. O
 * tipo agregado `lead` fica de fora porque soma pixel, formulário e offline.
 */
export function contarResultados(actions?: Acao[]): Contagens {
  return {
    leads_form: valorDe(actions, "onsite_conversion.lead_grouped"),
    conversations: Math.max(
      valorDe(actions, "onsite_conversion.messaging_conversation_started_7d"),
      valorDe(actions, "onsite_conversion.total_messaging_connection"),
    ),
    lp_leads: valorDe(actions, "offsite_conversion.fb_pixel_lead"),
    lp_views: valorDe(actions, "landing_page_view"),
  };
}

const MENSAGEM = /WHATSAPP|MESSENGER|INSTAGRAM_DIRECT/;

function canalDoConjunto(a: { destination_type?: string; optimization_goal?: string }): Canal {
  const destino = a.destination_type ?? "";
  if (MENSAGEM.test(destino)) return "whatsapp";
  if (destino === "WEBSITE") return "landing_page";
  // Conjunto antigo de formulário pode vir sem destination_type.
  const formulario = a.optimization_goal === "LEAD_GENERATION" || a.optimization_goal === "QUALITY_LEAD";
  if (formulario && (destino === "ON_AD" || !destino)) return "formulario";
  return "outro";
}

/** Objetivos antigos que dizem o canal sem ambiguidade. OUTCOME_LEADS pode ser
 *  formulário ou site, então não entra: vira "outro" em vez de palpite. */
const OBJETIVO_LEGADO: Record<string, Canal | undefined> = { MESSAGES: "whatsapp", LEAD_GENERATION: "formulario" };

/**
 * Canal da campanha pelo destination_type e pelo optimization_goal dos conjuntos
 * (nunca pelo nome da campanha). Conjuntos divergentes = "misto". Sem conjunto
 * nenhum (campanha apagada, que só aparece nos insights), decide pelo objetivo.
 */
export function canalDaCampanha(
  adsets: { destination_type?: string; optimization_goal?: string }[],
  objective?: string,
): Canal {
  const canais = new Set(adsets.map(canalDoConjunto));
  if (canais.size > 1) return "misto";
  const [unico] = canais;
  return unico ?? OBJETIVO_LEGADO[objective ?? ""] ?? "outro";
}

/**
 * Resultado da campanha = o contador do canal dela; "misto" = a soma dos três.
 * "outro" = 0: não há lead nem conversa a contar, e o custo por resultado fica
 * sem valor (denominador 0), igual ao SQL.
 */
export function resultadoDoCanal(
  canal: Canal,
  c: Pick<Contagens, "leads_form" | "conversations" | "lp_leads">,
): number {
  switch (canal) {
    case "formulario":
      return c.leads_form;
    case "whatsapp":
      return c.conversations;
    case "landing_page":
      return c.lp_leads;
    case "misto":
      return c.leads_form + c.conversations + c.lp_leads;
    default:
      return 0;
  }
}

/**
 * Centavos da Meta em reais: verba, gasto acumulado e limite da CONTA vêm como
 * texto em centavos ("12345" = R$ 123,45). O `spend` dos insights NÃO: já vem em
 * reais. `null` quando não é um inteiro ≥ 0 — nunca 0 por falta de dado.
 * ponytail: divisor 100 fixo, serve a moedas com centavos (BRL); moeda sem
 * centavos exigiria o offset da conta.
 */
export function deCentavos(v: unknown): number | null {
  const texto = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^\d+$/.test(texto) ? Number(texto) / 100 : null;
}

/** Reais em centavos inteiros, para mandar verba à Meta. É dinheiro de verdade:
 *  negativo ou não-número é recusado, nunca arredondado para algo plausível. */
export function paraCentavos(reais: number): number {
  if (!Number.isFinite(reais) || reais < 0) throw new RangeError("Valor em reais inválido para a Meta.");
  return Math.round(reais * 100);
}

/**
 * Saldo da conta PRÉ-PAGA, lido de `funding_source_details.display_string`.
 *
 * A Meta não tem campo numérico de saldo: só esse texto, cujo formato muda com o
 * idioma do usuário do token ("R$ 1.234,56" ou "R$1,234.56"). O parser é
 * estrito: exatamente um valor em R$, com duas casas decimais, que é o que
 * separa o milhar do decimal nos dois formatos. Qualquer outra coisa devolve
 * `null`, e o estado da conta sai só de account_status e disable_reason — nunca
 * de um número adivinhado. `balance` não serve: na Meta ele é valor A PAGAR.
 */
export function lerSaldoPrePago(display?: string | null): number | null {
  const achados = [...(display ?? "").matchAll(/R\$\s*([\d.,]+)/g)];
  if (achados.length !== 1) return null;
  const valor = achados[0][1].replace(/[.,]$/, "");
  const m =
    /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/.exec(valor) ?? /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/.exec(valor);
  return m ? Number(`${m[1].replace(/[.,]/g, "")}.${m[2]}`) : null;
}
