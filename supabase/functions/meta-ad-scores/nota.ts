/**
 * Nota por anúncio (F2.1): a parte pura da edge meta-ad-scores.
 *
 * O código decide tudo o que é número: métricas, média de cada canal, amostra
 * mínima e quais anúncios vão para a IA. A IA só julga (nota, balde e uma
 * frase), e o que ela devolve passa por `validarSaidaIA` antes de valer.
 *
 * Resultado e canal saem de `_shared/metaInsights.ts`, a mesma regra que a
 * sincronização grava. CTR é o do SQL (`meta_metricas`): cliques no LINK ÷
 * impressões, em fração. Por isso `clicks` aqui é o clique no link, não o total.
 *
 * Único import: `metaInsights.ts`, que não importa nada. É o que deixa o
 * vitest carregar este arquivo.
 */
import { type Canal, contarResultados, resultadoDoCanal } from "../_shared/metaInsights.ts";

export type Dias = 7 | 14 | 30 | 60;
export const DIAS_PERMITIDOS: readonly Dias[] = [7, 14, 30, 60];

/** Teto de anúncios numa chamada de IA; os demais entram como "não analisado". */
export const MAX_ANUNCIOS_IA = 40;
/** Teto da resposta: cerca de 70 tokens por anúncio × 40, com folga. */
export const TETO_TOKENS_IA = 4000;
const GASTO_MINIMO = 50;
const MOTIVO_MAX = 160;

const MOTIVO_FORA_DOS_40 = "fora dos 40 de maior gasto nesta análise";
const MOTIVO_SEM_AVALIACAO = "A IA não devolveu uma avaliação válida para este anúncio.";
const MOTIVO_SEM_CANAL =
  "Campanha ainda não sincronizada: sem o canal, não dá para contar o resultado. Sincronize e analise de novo.";
const MOTIVO_CANAL_OUTRO =
  "Campanha sem lead nem conversa para contar (canal outro): a nota compara custo por resultado.";

/** Uma linha de GET act_X/insights com level=ad (valores chegam como texto; spend já em reais). */
export type LinhaInsight = {
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
};

export type BaldeIA = "escalar" | "manter" | "cortar";
export type Balde = BaldeIA | "nao_analisado";
export type Avaliacao = { ad_id: string; nota: number; balde: BaldeIA; motivo: string };
export type Periodo = { inicio: string; fim: string; dias: number };
export type Medias = Partial<Record<Canal, { custo_por_resultado: number | null; ctr: number | null }>>;

/** Um item de `meta_ai_runs.result.anuncios`. `canal` nulo = campanha que a sincronização ainda não gravou. */
export type Anuncio = {
  ad_id: string;
  ad_name: string | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
  canal: Canal | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  resultados: number;
  custo_por_resultado: number | null;
  nota: number | null;
  balde: Balde;
  motivo: string;
  amostra_pequena: boolean;
  status: string | null;
};

const numero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const reais = (v: number) => Math.round(v * 100) / 100;
const fracao = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 1e6) / 1e6 : null);
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Métricas por anúncio, médias por canal e os baldes que o código já decide.
 *
 * Ordem das regras, por anúncio (do maior gasto para o menor):
 *  1. campanha sem canal gravado ou de canal "outro" → não analisado: sem
 *     resultado para contar, qualquer nota seria inventada;
 *  2. 0 resultado e gasto abaixo de max(R$ 50, 2× o custo médio por resultado
 *     do canal) → amostra pequena, "manter", sem ir para a IA;
 *  3. os 40 de maior gasto que sobraram → IA (`paraIA`);
 *  4. o resto → não analisado, "fora dos 40 de maior gasto nesta análise".
 * Nenhum anúncio some da lista.
 */
export function prepararAnuncios(
  linhas: LinhaInsight[],
  canalPorCampanha: ReadonlyMap<string, Canal>,
): { medias: Medias; anuncios: Anuncio[]; paraIA: Anuncio[] } {
  // Somar por ad_id garante o id único de que a validação da IA depende.
  const somas = new Map<string, {
    ad_id: string; ad_name: string | null; campaign_external_id: string | null; campaign_name: string | null;
    spend: number; impressions: number; clicks: number; leads_form: number; conversations: number; lp_leads: number;
  }>();
  for (const l of linhas) {
    const id = l.ad_id?.trim();
    if (!id) continue;
    const s = somas.get(id) ?? {
      ad_id: id, ad_name: l.ad_name ?? null, campaign_external_id: l.campaign_id ?? null,
      campaign_name: l.campaign_name ?? null, spend: 0, impressions: 0, clicks: 0, leads_form: 0, conversations: 0, lp_leads: 0,
    };
    const c = contarResultados(l.actions);
    s.spend += numero(l.spend);
    s.impressions += numero(l.impressions);
    s.clicks += numero(l.inline_link_clicks);
    s.leads_form += c.leads_form;
    s.conversations += c.conversations;
    s.lp_leads += c.lp_leads;
    somas.set(id, s);
  }

  const base = [...somas.values()]
    .map((s) => {
      const canal = (s.campaign_external_id && canalPorCampanha.get(s.campaign_external_id)) || null;
      const resultados = canal ? resultadoDoCanal(canal, s) : 0;
      return {
        ad_id: s.ad_id, ad_name: s.ad_name, campaign_external_id: s.campaign_external_id, campaign_name: s.campaign_name,
        canal, spend: reais(s.spend), impressions: s.impressions, clicks: s.clicks, ctr: fracao(s.clicks, s.impressions),
        resultados, custo_por_resultado: resultados > 0 ? reais(s.spend / resultados) : null,
      };
    })
    .sort((a, b) => b.spend - a.spend || a.ad_id.localeCompare(b.ad_id));

  // Média de cada canal com o gasto e o resultado DELE: conversa de WhatsApp
  // nunca divide gasto de formulário.
  const totais = new Map<Canal, { spend: number; resultados: number; clicks: number; impressions: number }>();
  for (const a of base) {
    if (a.canal === null || a.canal === "outro") continue;
    const t = totais.get(a.canal) ?? { spend: 0, resultados: 0, clicks: 0, impressions: 0 };
    t.spend += a.spend;
    t.resultados += a.resultados;
    t.clicks += a.clicks;
    t.impressions += a.impressions;
    totais.set(a.canal, t);
  }
  const medias: Medias = {};
  for (const [canal, t] of totais) {
    medias[canal] = {
      custo_por_resultado: t.resultados > 0 ? reais(t.spend / t.resultados) : null,
      ctr: fracao(t.clicks, t.impressions),
    };
  }

  const anuncios: Anuncio[] = [];
  const paraIA: Anuncio[] = [];
  for (const a of base) {
    const sem = { ...a, nota: null, amostra_pequena: false, status: null };
    if (a.canal === null || a.canal === "outro") {
      anuncios.push({ ...sem, balde: "nao_analisado", motivo: a.canal === null ? MOTIVO_SEM_CANAL : MOTIVO_CANAL_OUTRO });
      continue;
    }
    const minimo = Math.max(GASTO_MINIMO, 2 * (medias[a.canal]?.custo_por_resultado ?? 0));
    if (a.resultados === 0 && a.spend < minimo) {
      anuncios.push({
        ...sem, balde: "manter", amostra_pequena: true,
        motivo: `Amostra pequena: ${brl(a.spend)} gastos sem resultado, abaixo do mínimo de ${brl(minimo)} para julgar. Espere mais dados.`,
      });
      continue;
    }
    if (paraIA.length >= MAX_ANUNCIOS_IA) {
      anuncios.push({ ...sem, balde: "nao_analisado", motivo: MOTIVO_FORA_DOS_40 });
      continue;
    }
    // Fica "não analisado" até a IA devolver uma avaliação válida para ele.
    const anuncio: Anuncio = { ...sem, balde: "nao_analisado", motivo: MOTIVO_SEM_AVALIACAO };
    anuncios.push(anuncio);
    paraIA.push(anuncio);
  }
  return { medias, anuncios, paraIA };
}

const BALDES_IA: readonly string[] = ["escalar", "manter", "cortar"];

/**
 * O que vale da resposta da IA. Descarta ad_id que não foi enviado (inventado
 * ou repetido), balde fora de escalar/manter/cortar, nota que não é número e
 * motivo vazio; limita a nota a 0–10 e corta o motivo em 160 caracteres.
 *
 * Lança quando não há lista, ou quando nenhuma avaliação sobra: a execução
 * vira "falhou", nunca uma análise com notas vazias.
 */
export function validarSaidaIA(saida: unknown, idsEnviados: Set<string>): Avaliacao[] {
  const lista = (saida as { anuncios?: unknown } | null)?.anuncios;
  if (!Array.isArray(lista)) throw new Error("A IA não devolveu a lista de anúncios avaliados.");

  const avaliacoes: Avaliacao[] = [];
  const vistos = new Set<string>();
  for (const item of lista) {
    const i = (item ?? {}) as Record<string, unknown>;
    const id = typeof i.ad_id === "string" ? i.ad_id.trim() : "";
    const balde = typeof i.balde === "string" ? i.balde.trim().toLowerCase() : "";
    const motivo = typeof i.motivo === "string" ? i.motivo.replace(/\s+/g, " ").trim() : "";
    if (!idsEnviados.has(id) || vistos.has(id)) continue;
    if (typeof i.nota !== "number" || !Number.isFinite(i.nota) || !BALDES_IA.includes(balde) || !motivo) continue;
    vistos.add(id);
    avaliacoes.push({
      ad_id: id,
      nota: Math.round(Math.min(10, Math.max(0, i.nota)) * 10) / 10,
      balde: balde as BaldeIA,
      motivo: [...motivo].slice(0, MOTIVO_MAX).join(""),
    });
  }
  if (idsEnviados.size > 0 && avaliacoes.length === 0) {
    throw new Error("A IA não devolveu nenhuma avaliação válida: nenhuma nota foi gravada.");
  }
  return avaliacoes;
}

/** Junta as avaliações validadas; quem ficou sem uma segue "não analisado", com o motivo. */
export function aplicarAvaliacoes(anuncios: Anuncio[], avaliacoes: Avaliacao[]): Anuncio[] {
  const porId = new Map(avaliacoes.map((av) => [av.ad_id, av]));
  return anuncios.map((a) => {
    const av = porId.get(a.ad_id);
    return av ? { ...a, nota: av.nota, balde: av.balde, motivo: av.motivo } : a;
  });
}

/**
 * Os últimos N dias no fuso da CONTA, que é o fuso em que a Meta lê o
 * time_range. Hoje fica de fora, como no "Últimos N dias" do Gerenciador.
 */
export function periodoDaAnalise(dias: number, agora: Date, timeZone: string): Periodo {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(agora);
  const antes = (n: number) => {
    const d = new Date(`${hoje}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  return { inicio: antes(dias), fim: antes(1), dias };
}

export const PROMPT_NOTA = [
  "Você avalia anúncios da Meta de uma imobiliária. Recebe, em JSON, os anúncios com as métricas do período e a média de cada canal.",
  "Para CADA anúncio recebido, dê uma nota de 0 a 10 e um balde:",
  "- escalar: custo por resultado claramente abaixo da média do canal, com volume de resultados;",
  "- manter: perto da média, ou dados ainda inconclusivos;",
  "- cortar: custo por resultado muito acima da média do canal, ou gasto relevante sem resultado.",
  "Compare cada anúncio só com a média do PRÓPRIO canal: lead de formulário, conversa de WhatsApp e lead de landing page não se comparam. O CTR é apoio e não decide sozinho.",
  "Use só os números recebidos; não invente dado.",
  "O motivo é uma frase em português de até 160 caracteres, citando o número que decidiu.",
  'Responda só com JSON: {"anuncios":[{"ad_id":"<id recebido>","nota":0,"balde":"escalar|manter|cortar","motivo":"..."}]}, um item por anúncio, com o ad_id exatamente como recebido.',
].join("\n");

/** A mensagem da IA: SÓ os anúncios de `paraIA`, com CTR em % para leitura. */
export function montarPedidoIA(periodo: Periodo, prep: { medias: Medias; paraIA: Anuncio[] }): string {
  const pct = (f: number | null) => (f === null ? null : Math.round(f * 10_000) / 100);
  return JSON.stringify({
    periodo,
    medias_por_canal: Object.fromEntries(
      Object.entries(prep.medias).map(([canal, m]) => [canal, { custo_por_resultado: m.custo_por_resultado, ctr_pct: pct(m.ctr) }]),
    ),
    anuncios: prep.paraIA.map((a) => ({
      ad_id: a.ad_id,
      canal: a.canal,
      gasto: a.spend,
      impressoes: a.impressions,
      cliques_no_link: a.clicks,
      ctr_pct: pct(a.ctr),
      resultados: a.resultados,
      custo_por_resultado: a.custo_por_resultado,
    })),
  });
}
