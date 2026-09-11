/**
 * Gestor de tráfego IA (F2.2): a parte pura da edge meta-traffic-manager.
 *
 * O código decide o que é número e o que a IA pode tocar: período, campanhas
 * enviadas e os limites de cada ação. A IA só julga (nota, alertas e até 3
 * ações), e o que ela devolve passa por `validarGestor` antes de virar
 * proposta na fila. Nada daqui executa: a execução é o meta-campaign-action,
 * depois de uma pessoa aprovar.
 *
 * Único import: `nota.ts` (que só importa `metaInsights.ts`, sem nada). É o
 * que deixa o vitest carregar este arquivo.
 */
import { type Periodo, periodoDaAnalise } from "../meta-ad-scores/nota.ts";

export type { Periodo };

/** Uma chamada por conta; a resposta pedida é curta (nota, 3 alertas, 3 ações). */
export const TETO_TOKENS_GESTOR = 1200;
/** Teto de campanhas no pedido: o prompt fica com tamanho previsível. */
export const MAX_CAMPANHAS_IA = 40;
const LIMITE_ITENS = 3;
const TEXTO_MAX = 300;
const RESUMO_MAX = 600;

const ACOES = ["pausar", "ativar", "verba"] as const;
const SEVERIDADES = ["baixa", "media", "alta"] as const;

export type Acao = (typeof ACOES)[number];
export type Severidade = (typeof SEVERIDADES)[number];

/** A campanha como está em `ad_campaigns`: é contra ela que a ação da IA é conferida. */
export type CampanhaDoGestor = {
  id: string;
  external_id: string;
  daily_budget: number | null;
  meta_budget_level: "campaign" | "adset" | "lifetime" | null;
  name?: string | null;
  status?: string | null;
  meta_channel?: string | null;
};

export type AlertaGestor = { severidade: Severidade; texto: string };
export type AcaoGestor = {
  campaign_id: string;
  campaign_external_id: string;
  campaign_name: string | null;
  acao: Acao;
  verba_nova?: number;
  motivo: string;
};

/** Uma linha de `meta_metricas` (0115); só o que o gestor usa. */
export type MetricaDaCampanha = {
  campaign_id: string;
  spend: number | null;
  impressions: number | null;
  ctr: number | null;
  resultados: number | null;
  custo_por_resultado: number | null;
};

export type ContaDoGestor = {
  name: string | null;
  balance_state: string | null;
  is_prepay: boolean | null;
  prepay_available: number | null;
  last_sync_ok_at: string | null;
};

const obj = (v: unknown) => (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown, max: number) =>
  typeof v === "string" ? [...v.replace(/\s+/g, " ").trim()].slice(0, max).join("") : "";
const numero = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Os últimos 7 dias e os 7 antes deles, no fuso da conta, hoje fora (a mesma régua da nota por anúncio). */
export function periodosDoGestor(agora: Date, timeZone: string): { atual: Periodo; anterior: Periodo } {
  return {
    atual: periodoDaAnalise(7, agora, timeZone),
    // De D-14 a D-8: o início dos últimos 14 dias até o início dos últimos 8.
    anterior: {
      inicio: periodoDaAnalise(14, agora, timeZone).inicio,
      fim: periodoDaAnalise(8, agora, timeZone).inicio,
      dias: 7,
    },
  };
}

const dia = (iso: string) => iso.split("-").reverse().join("/");
const momento = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
      .format(new Date(iso))
    : "nunca";

/**
 * A ação que a IA sugeriu, conferida contra a campanha real. Descarta: tipo
 * fora de pausar/ativar/verba; campanha fora da lista enviada (inventada ou de
 * outra conta); motivo vazio; ação que não muda nada (pausar a pausada, ativar
 * a ativa, verba igual); verba sem verba diária editável (verba total ou nível
 * ainda não sincronizado); verba fora de 0,5x a 2x a atual.
 */
function conferirAcao(a: Record<string, unknown>, porExterno: Map<string, CampanhaDoGestor>): AcaoGestor | null {
  const acao = ACOES.find((x) => x === a.acao);
  const c = typeof a.campaign_external_id === "string" ? porExterno.get(a.campaign_external_id.trim()) : undefined;
  const motivo = texto(a.motivo, TEXTO_MAX);
  if (!acao || !c || !motivo) return null;

  const base = { campaign_id: c.id, campaign_external_id: c.external_id, campaign_name: c.name ?? null, acao, motivo };
  if (acao === "pausar") return c.status === "PAUSED" ? null : base;
  if (acao === "ativar") return c.status === "ACTIVE" ? null : base;

  if (c.meta_budget_level !== "campaign" && c.meta_budget_level !== "adset") return null;
  const atual = c.daily_budget;
  if (typeof a.verba_nova !== "number" || !Number.isFinite(a.verba_nova) || !atual || atual <= 0) return null;
  const nova = Math.round(a.verba_nova * 100) / 100;
  if (nova < atual * 0.5 || nova > atual * 2 || nova === atual) return null;
  return { ...base, verba_nova: nova };
}

/**
 * O que vale da resposta da IA. Lança quando falta a nota (número) ou o
 * resumo: a execução vira "falhou", nunca uma nota inventada. A nota vem
 * limitada a 0-100; alertas e ações ficam nos 3 primeiros válidos.
 * `descartadas` conta as ações que não passaram (inválidas, repetidas ou além
 * das 3).
 */
export function validarGestor(
  saida: unknown,
  campanhas: CampanhaDoGestor[],
): { nota: number; resumo: string; alertas: AlertaGestor[]; acoes: AcaoGestor[]; descartadas: number } {
  const s = obj(saida);
  if (typeof s.nota !== "number" || !Number.isFinite(s.nota)) {
    throw new Error("A IA não devolveu a nota da conta (0 a 100): nada foi gravado.");
  }
  const resumo = texto(s.resumo, RESUMO_MAX);
  if (!resumo) throw new Error("A IA não devolveu o resumo da conta: nada foi gravado.");

  const alertas: AlertaGestor[] = [];
  for (const item of lista(s.alertas)) {
    const a = obj(item);
    const severidade = SEVERIDADES.find((x) => x === a.severidade);
    const t = texto(a.texto, TEXTO_MAX);
    if (severidade && t && alertas.length < LIMITE_ITENS) alertas.push({ severidade, texto: t });
  }

  const porExterno = new Map(campanhas.map((c) => [c.external_id, c]));
  const acoes: AcaoGestor[] = [];
  const vistas = new Set<string>();
  let descartadas = 0;
  for (const item of lista(s.acoes)) {
    const a = conferirAcao(obj(item), porExterno);
    const chave = a ? `${a.campaign_id}:${a.acao}` : "";
    if (!a || vistas.has(chave) || acoes.length >= LIMITE_ITENS) {
      descartadas++;
      continue;
    }
    vistas.add(chave);
    acoes.push(a);
  }

  return { nota: Math.round(Math.min(100, Math.max(0, s.nota))), resumo, alertas, acoes, descartadas };
}

export const PROMPT_GESTOR = [
  "Você é o gestor de tráfego de uma imobiliária e revisa UMA conta de anúncios da Meta. Recebe, em JSON, o estado da conta e as campanhas com os números dos últimos 7 dias e dos 7 anteriores, todos calculados pelo sistema.",
  "Devolva:",
  "- nota: inteiro de 0 a 100 para a saúde da conta (entrega, custo por resultado, gasto sem resultado, estado da conta);",
  "- resumo: até 3 frases em português;",
  "- alertas: no máximo 3, cada um com severidade (baixa, media ou alta) e um texto de uma frase citando o número;",
  "- acoes: no máximo 3, só para campanhas da lista, com o campaign_external_id exatamente como recebido. Tipos: pausar, ativar ou verba. Em verba, verba_nova é a nova verba diária em reais, entre metade e o dobro da verba_diaria, e só em campanha com verba_editavel = true.",
  "Compare cada campanha só com o próprio canal: lead de formulário, conversa de WhatsApp e lead de landing page não se comparam. Resultado e custo por resultado são os da Meta.",
  "Use só os números recebidos; não invente dado. Sem ação clara, devolva acoes vazia. Uma pessoa aprova cada ação antes de ela ir para a Meta.",
  'Responda só com JSON: {"nota":0,"resumo":"...","alertas":[{"severidade":"baixa|media|alta","texto":"..."}],"acoes":[{"acao":"pausar|ativar|verba","campaign_external_id":"<id recebido>","verba_nova":null,"motivo":"..."}]}',
].join("\n");

/**
 * A mensagem da IA e as campanhas que ela recebeu — é contra ESTA lista que a
 * resposta é validada. Vão as campanhas com gasto em um dos dois períodos ou
 * ativas, das de maior gasto para as de menor, até 40.
 *
 * Lança quando a conta não teve entrega nenhuma no período: sem números, a
 * IA daria uma nota inventada, e a execução vira "falhou" com a frase.
 */
export function montarPedidoGestor(p: {
  conta: ContaDoGestor;
  atual: Periodo;
  anterior: Periodo;
  campanhas: CampanhaDoGestor[];
  metricas: MetricaDaCampanha[];
  metricasAnterior: MetricaDaCampanha[];
}): { user: string; enviadas: CampanhaDoGestor[] } {
  const atual = new Map(p.metricas.map((m) => [m.campaign_id, m]));
  const antes = new Map(p.metricasAnterior.map((m) => [m.campaign_id, m]));
  if (!p.metricas.some((m) => numero(m.spend) > 0 || numero(m.impressions) > 0)) {
    throw new Error(
      `Sem entrega registrada na Meta de ${dia(p.atual.inicio)} a ${dia(p.atual.fim)} ` +
        `(última sincronização boa: ${momento(p.conta.last_sync_ok_at)}). Sem números, o gestor não dá nota: ` +
        "sincronize ou confira se a conta está veiculando.",
    );
  }

  const gasto = (m: Map<string, MetricaDaCampanha>, id: string) => numero(m.get(id)?.spend);
  const enviadas = p.campanhas
    .filter((c) => gasto(atual, c.id) > 0 || gasto(antes, c.id) > 0 || c.status === "ACTIVE")
    .sort((a, b) => gasto(atual, b.id) - gasto(atual, a.id) || gasto(antes, b.id) - gasto(antes, a.id))
    .slice(0, MAX_CAMPANHAS_IA);

  const numeros = (m: MetricaDaCampanha | undefined) =>
    m
      ? {
        gasto: numero(m.spend),
        impressoes: numero(m.impressions),
        ctr_pct: m.ctr === null ? null : Math.round(numero(m.ctr) * 10_000) / 100,
        resultados: numero(m.resultados),
        custo_por_resultado: m.custo_por_resultado,
      }
      : null;

  const user = JSON.stringify({
    conta: {
      nome: p.conta.name,
      estado: p.conta.balance_state ?? "desconhecido",
      ...(p.conta.is_prepay && p.conta.prepay_available !== null ? { saldo_pre_pago: p.conta.prepay_available } : {}),
    },
    ultimos_7_dias: { de: p.atual.inicio, ate: p.atual.fim },
    "7_dias_anteriores": { de: p.anterior.inicio, ate: p.anterior.fim },
    campanhas: enviadas.map((c) => ({
      campaign_external_id: c.external_id,
      nome: c.name ?? null,
      canal: c.meta_channel ?? "outro",
      status: c.status ?? null,
      verba_diaria: c.daily_budget,
      verba_editavel: c.meta_budget_level === "campaign" || c.meta_budget_level === "adset",
      ultimos_7_dias: numeros(atual.get(c.id)),
      "7_dias_anteriores": numeros(antes.get(c.id)),
    })),
  });
  return { user, enviadas };
}
