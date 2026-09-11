/**
 * O que a sincronização manda para `meta_sync_apply`, montado a partir das
 * respostas cruas da Graph. Puro: sem rede, sem banco, sem relógio escondido.
 *
 * As regras não moram aqui, só são aplicadas: contagem e canal em
 * `_shared/metaInsights.ts`, sugestão de construtora em `_shared/campaignName.ts`
 * e onde está a verba (CBO, ABO, verba total) em `meta-campaign-action/verba.ts`,
 * a mesma que o executor de ações usa — duas leituras da verba divergiriam.
 *
 * Números: o `spend` dos insights já vem em reais; verba, gasto e limite da
 * conta vêm em centavos. Métrica ausente é zero (a Meta omite o que não houve);
 * métrica presente e ilegível LANÇA — nunca vira um zero plausível.
 */
import { sugerirConstrutora } from "../_shared/campaignName.ts";
import {
  type Canal, canalDaCampanha, contarResultados, deCentavos, lerSaldoPrePago, resultadoDoCanal,
} from "../_shared/metaInsights.ts";
import { conjuntosComVerba, verbaDaCampanha } from "../meta-campaign-action/verba.ts";

export type GraphAccount = {
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  disable_reason?: number;
  is_prepay_account?: boolean;
  amount_spent?: string;
  spend_cap?: string;
  funding_source_details?: { display_string?: string } | null;
};

export type GraphCampaign = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

export type GraphAdset = {
  id?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  destination_type?: string;
  optimization_goal?: string;
  daily_budget?: string;
  lifetime_budget?: string;
};

export type GraphInsight = {
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
};

export type Janela = { inicio: string; fim: string };
type NivelVerba = "campaign" | "adset" | "lifetime";

export const FUSO_PADRAO = "America/Sao_Paulo";
const DIA_MS = 86_400_000;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** "Hoje" (AAAA-MM-DD) no fuso da conta; fuso inválido cai em São Paulo. */
export function hojeNoFuso(fuso: string | null | undefined, agora: Date = new Date()): string {
  const dia = (timeZone: string) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(agora)
        .map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
  };
  try {
    return dia(fuso || FUSO_PADRAO);
  } catch {
    return dia(FUSO_PADRAO);
  }
}

/**
 * Janela PEDIDA: de min(hoje − dias, dia 1 do mês) até hoje. Começar no dia 1
 * deixa o "gasto do mês" (alerta de verba, seletor "mês atual") inteiro.
 * `ultimaOk` é o dia, no fuso da conta, da última sincronização boa:
 *  - null (primeira sincronização): vai até o dia 1 do mês ANTERIOR, senão o
 *    "mês anterior" apareceria pela metade como se estivesse completo;
 *  - na volta de uma parada, começa no PRÓPRIO dia da última boa, que ela leu
 *    pela metade (o cron roda às 06:00); senão os dias parados nunca voltam.
 */
export function janelaPedida(hoje: string, dias: number, ultimaOk: string | null): Janela {
  if (!DATA.test(hoje)) throw new Error("Data de hoje inválida para a janela da sincronização.");
  if (ultimaOk !== null && !DATA.test(ultimaOk)) throw new Error("Data da última sincronização inválida para a janela.");
  const h = new Date(`${hoje}T00:00:00Z`);
  const ano = h.getUTCFullYear();
  const mes = h.getUTCMonth();
  const candidatos = [h.getTime() - dias * DIA_MS, Date.UTC(ano, mes, 1)];
  if (ultimaOk === null) {
    candidatos.push(Date.UTC(ano, mes - 1, 1));
  } else {
    // ponytail: a retomada volta no máximo 90 dias; parada maior deixa buraco e a
    // cobertura (menor início entre as execuções ok) não o detecta. Evoluir quando isso acontecer.
    candidatos.push(Math.max(Date.parse(`${ultimaOk}T00:00:00Z`), h.getTime() - 90 * DIA_MS));
  }
  return { inicio: new Date(Math.min(...candidatos)).toISOString().slice(0, 10), fim: hoje };
}

const inteiroOuNulo = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** Os campos crus da conta, em reais. `balance` não entra: na Meta é valor a pagar. */
export function montarConta(c: GraphAccount) {
  const isPrepay = typeof c.is_prepay_account === "boolean" ? c.is_prepay_account : null;
  return {
    name: c.name ?? null,
    currency: c.currency ?? null,
    timezone_name: c.timezone_name ?? null,
    account_status: inteiroOuNulo(c.account_status),
    disable_reason: inteiroOuNulo(c.disable_reason),
    is_prepay: isPrepay,
    amount_spent: deCentavos(c.amount_spent),
    spend_cap: deCentavos(c.spend_cap),
    // Parser estrito: falhou, fica nulo, e o estado sai só de status e bloqueio.
    prepay_available: isPrepay ? lerSaldoPrePago(c.funding_source_details?.display_string) : null,
  };
}

function metrica(v: unknown, campo: string, inteiro: boolean): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (inteiro && !Number.isInteger(n))) {
    throw new Error(`A Meta devolveu "${campo}" ilegível nos insights (${String(v).slice(0, 20)}); nada foi gravado.`);
  }
  return n;
}

const reais = (centavos: number) => centavos / 100;

/**
 * Verba da campanha: na campanha (CBO), a soma dos conjuntos com status próprio
 * ACTIVE (ABO) ou verba total (lifetime). Conjunto ativo com verba total faz o
 * `conjuntosComVerba` recusar a escala: aqui isso é a resposta "lifetime".
 */
function verbaDe(c: GraphCampaign, conjuntos: GraphAdset[]) {
  const v = verbaDaCampanha(c);
  if (v.nivel === "campaign") {
    return { budget_level: "campaign" as NivelVerba, daily_budget: reais(v.centavos), lifetime_budget: null };
  }
  if (v.nivel === "lifetime") {
    return { budget_level: "lifetime" as NivelVerba, daily_budget: null, lifetime_budget: deCentavos(c.lifetime_budget) };
  }
  if (conjuntos.length === 0) return { budget_level: null, daily_budget: null, lifetime_budget: null };
  try {
    const soma = conjuntosComVerba(conjuntos).reduce((s, a) => s + a.daily_budget_centavos, 0);
    return { budget_level: "adset" as NivelVerba, daily_budget: reais(soma), lifetime_budget: null };
  } catch (e) {
    if (e instanceof RangeError) return { budget_level: "lifetime" as NivelVerba, daily_budget: null, lifetime_budget: null };
    throw e;
  }
}

export type MontarInput = {
  janelaPedida: Janela;
  janelaBuscada: Janela;
  conta: GraphAccount;
  campanhas: GraphCampaign[];
  adsets: GraphAdset[];
  insights: GraphInsight[];
  construtoras: { id: string; name: string }[];
};

/** O payload no formato exato de `meta_sync_apply` (0115). */
export function montarPayload(input: MontarInput) {
  const conjuntosDe = new Map<string, GraphAdset[]>();
  for (const a of input.adsets) {
    if (!a.campaign_id) continue;
    conjuntosDe.set(a.campaign_id, [...(conjuntosDe.get(a.campaign_id) ?? []), a]);
  }
  const nomeNosInsights = new Map<string, string>();
  for (const i of input.insights) {
    if (i.campaign_id && i.campaign_name?.trim()) nomeNosInsights.set(i.campaign_id, i.campaign_name.trim());
  }

  const campanhas = new Map<string, {
    external_id: string;
    name: string;
    status: string | null;
    effective_status: string | null;
    objective: string | null;
    daily_budget: number | null;
    lifetime_budget: number | null;
    budget_level: NivelVerba | null;
    channel: Canal;
    developer_suggested_id: string | null;
  }>();
  const incluir = (c: GraphCampaign, doInsight: boolean) => {
    const conjuntos = conjuntosDe.get(c.id) ?? [];
    const name = c.name?.trim() || nomeNosInsights.get(c.id) || `Campanha ${c.id}`;
    campanhas.set(c.id, {
      external_id: c.id,
      name,
      status: c.status?.toUpperCase() ?? null,
      effective_status: c.effective_status ?? null,
      objective: c.objective ?? null,
      ...(doInsight ? { daily_budget: null, lifetime_budget: null, budget_level: null } : verbaDe(c, conjuntos)),
      channel: canalDaCampanha(conjuntos, c.objective),
      developer_suggested_id: sugerirConstrutora(name, input.construtoras),
    });
  };

  for (const c of input.campanhas) if (c.id) incluir(c, false);
  // Campanha apagada na Meta não sai em /campaigns, mas o gasto dela na janela é
  // real: entra como ARCHIVED, com o nome dos insights, e o gasto não se perde.
  for (const i of input.insights) {
    if (i.campaign_id && !campanhas.has(i.campaign_id)) incluir({ id: i.campaign_id, status: "ARCHIVED" }, true);
  }

  const insights = input.insights.map((i) => {
    if (!i.campaign_id || !DATA.test(i.date_start ?? "")) {
      throw new Error("A Meta devolveu uma linha de insights sem campanha ou sem dia; nada foi gravado.");
    }
    const contagens = contarResultados(i.actions);
    return {
      external_id: i.campaign_id,
      day: i.date_start as string,
      spend: Math.round(metrica(i.spend, "spend", false) * 100) / 100,
      impressions: metrica(i.impressions, "impressions", true),
      reach: metrica(i.reach, "reach", true),
      clicks: metrica(i.clicks, "clicks", true),
      link_clicks: metrica(i.inline_link_clicks, "inline_link_clicks", true),
      ...contagens,
      resultados: resultadoDoCanal(campanhas.get(i.campaign_id)!.channel, contagens),
    };
  });

  return {
    janela_pedida: input.janelaPedida,
    janela_buscada: input.janelaBuscada,
    conta: montarConta(input.conta),
    campanhas: [...campanhas.values()],
    insights,
  };
}
