/**
 * Custo do WhatsApp por dia, a partir do `pricing_analytics` da conta do
 * WhatsApp Business. Puro (sem rede) para ser testado no vitest.
 *
 * `volume` é o que a Meta conta como mensagem entregue e precificada; `cost`
 * vem na moeda da conta. Mensagem grátis (dentro da janela de 24 h) aparece com
 * `pricing_type` diferente de REGULAR e custo zero — por isso as duas colunas.
 *
 * Só a categoria UTILITY entra: é a do modelo do aviso de lead novo. O mesmo
 * número também fala com cliente (SDR = SERVICE, remarketing = MARKETING), e
 * somar tudo poria na conta do aviso o custo de outra frente.
 */
export type PontoMeta = {
  start?: unknown;
  volume?: unknown;
  cost?: unknown;
  pricing_category?: unknown;
  pricing_type?: unknown;
};

export type CustoDoDia = { dia: string; mensagens: number; cobradas: number; custo: number };

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Dia (AAAA-MM-DD) no fuso de São Paulo de um epoch em segundos. */
export const diaEmSaoPaulo = (epoch: number) =>
  new Date(epoch * 1000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function custoPorDia(resposta: unknown): CustoDoDia[] {
  const blocos = (resposta as { pricing_analytics?: { data?: unknown } } | null)?.pricing_analytics?.data;
  const pontos: PontoMeta[] = Array.isArray(blocos)
    ? blocos.flatMap((b) => (Array.isArray((b as { data_points?: unknown })?.data_points)
      ? (b as { data_points: PontoMeta[] }).data_points
      : []))
    : [];

  const dias = new Map<string, CustoDoDia>();
  for (const p of pontos) {
    const inicio = num(p.start);
    if (!inicio || p.pricing_category !== "UTILITY") continue;
    const dia = diaEmSaoPaulo(inicio);
    const linha = dias.get(dia) ?? { dia, mensagens: 0, cobradas: 0, custo: 0 };
    const volume = num(p.volume);
    linha.mensagens += volume;
    if (p.pricing_type === "REGULAR" || p.pricing_type === undefined) linha.cobradas += volume;
    linha.custo += num(p.cost);
    dias.set(dia, linha);
  }
  return [...dias.values()]
    .map((l) => ({ ...l, custo: Math.round(l.custo * 10000) / 10000 }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Custo do MODELO do aviso, por dia, a partir do `template_analytics` da conta
 * (09/11/2026: medir só o aviso de lead novo, sem o relatório da manhã e sem
 * modelo antigo, que também são de utilidade). `cost` vem como lista de
 * `{type, value}`; o gasto é o `amount_spent`.
 */
export type CustoDoModeloDia = CustoDoDia & { lidas: number };

export function custoDoModeloPorDia(resposta: unknown): CustoDoModeloDia[] {
  const blocos = (resposta as { data?: unknown } | null)?.data;
  const pontos = Array.isArray(blocos)
    ? blocos.flatMap((b) => (Array.isArray((b as { data_points?: unknown })?.data_points)
      ? (b as { data_points: Record<string, unknown>[] }).data_points
      : []))
    : [];

  const dias = new Map<string, CustoDoModeloDia>();
  for (const p of pontos) {
    const inicio = num(p.start);
    if (!inicio) continue;
    const dia = diaEmSaoPaulo(inicio);
    const linha = dias.get(dia) ?? { dia, mensagens: 0, cobradas: 0, custo: 0, lidas: 0 };
    const entregues = num(p.delivered);
    linha.mensagens += entregues;
    linha.cobradas += entregues;
    linha.lidas += num(p.read);
    const gasto = Array.isArray(p.cost)
      ? (p.cost as { type?: unknown; value?: unknown }[]).find((c) => c?.type === "amount_spent")?.value
      : undefined;
    linha.custo += num(gasto);
    dias.set(dia, linha);
  }
  return [...dias.values()]
    .map((l) => ({ ...l, custo: Math.round(l.custo * 10000) / 10000 }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Id do modelo pelo nome; com mais de um idioma, prefere pt_BR (o que o CRM envia). */
export function idDoModelo(resposta: unknown, nome: string): string | null {
  const lista = (resposta as { data?: unknown } | null)?.data;
  if (!Array.isArray(lista)) return null;
  const doNome = (lista as { id?: unknown; name?: unknown; language?: unknown }[])
    .filter((t) => t?.name === nome && typeof t.id === "string");
  const escolhido = doNome.find((t) => t.language === "pt_BR") ?? doNome[0];
  return escolhido ? (escolhido.id as string) : null;
}
