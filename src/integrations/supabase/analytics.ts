import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * `marketing_developer_summary` e a coluna `revenue` de `marketing_campaign_stats`
 * chegaram na 0063 e ainda não estão em `types.ts` — o arquivo é gerado por
 * `supabase gen types` e não se edita à mão. O cast local morre no próximo
 * `gen types`; é o mesmo escape usado em `people.ts` para as colunas da 0046.
 */
const untyped = supabase as unknown as SupabaseClient;

/**
 * Consolidado anual, campanhas e trilha de auditoria.
 *
 * As três superfícies existiam no schema e nenhuma tela as usava:
 * `Resultados.tsx` recalculava o anual a cada abertura a partir de todos os
 * negócios — o que ignorava `closed_months` e reabria discrepância em mês já
 * fechado, exatamente a queixa que originou a tabela.
 */

export type AnnualResultRow = {
  id: string;
  year: number;
  month: number;
  sales_count: number;
  vgv: number;
  notes: string | null;
  updated_at: string;
};

/** Sem `year`, devolve a tabela inteira - sao ~12 linhas por ano. */
export async function listAnnualResults(year?: number): Promise<AnnualResultRow[]> {
  let query = supabase
    .from("annual_results")
    .select("id,year,month,sales_count,vgv,notes,updated_at");
  if (year !== undefined) query = query.eq("year", year);
  const { data, error } = await query.order("year", { ascending: false }).order("month");
  if (error) throw dbError("listar resultados anuais", error);
  return (data ?? []) as AnnualResultRow[];
}

/** Upsert por (year, month) — a tabela tem unique nessa dupla. */
export async function upsertAnnualResult(input: {
  year: number;
  month: number;
  salesCount: number;
  vgv: number;
  notes?: string | null;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("annual_results")
    .upsert(
      {
        year: input.year,
        month: input.month,
        sales_count: input.salesCount,
        vgv: input.vgv,
        notes: input.notes ?? null,
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: "year,month" },
    );
  if (error) throw dbError("salvar resultado anual", error);
}

// -----------------------------------------------------------------------------
// Campanhas
// -----------------------------------------------------------------------------

export type AdCampaignRow = {
  id: string;
  external_id: string;
  platform: string;
  name: string;
  developer_id: string | null;
  status: string | null;
  /** Teto que a plataforma cobra por dia. */
  daily_budget: number | null;
  /** Verba CONTRATADA da campanha (0089) — o que ainda pode ser gasto sai da
   *  diferença para `total_spend`, que é o gasto REALIZADO. */
  lifetime_budget: number | null;
  /** Período de veiculação, `YYYY-MM-DD` (0089). */
  starts_on: string | null;
  ends_on: string | null;
  /** Origem de lead que a campanha alimenta (0089). */
  lead_source_id: string | null;
  total_spend: number;
  synced_at: string | null;
};

const CAMPOS_CAMPANHA =
  "id,external_id,platform,name,developer_id,status,daily_budget,lifetime_budget,"
  + "starts_on,ends_on,lead_source_id,total_spend,synced_at";

export async function listAdCampaigns(): Promise<AdCampaignRow[]> {
  // `untyped` pelo mesmo motivo das RPCs acima: as colunas da 0089 ainda não
  // existem em `types.ts`, que é gerado por `supabase gen types`.
  const { data, error } = await untyped
    .from("ad_campaigns")
    .select(CAMPOS_CAMPANHA)
    .order("name");
  if (error) throw dbError("listar campanhas", error);
  return (data ?? []) as AdCampaignRow[];
}

/** As plataformas que `ad_campaigns_platform_check` aceita. */
export const AD_PLATFORMS = ["meta", "google", "tiktok", "other"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_PLATFORM_LABEL: Record<AdPlatform, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  other: "Outros",
};

/**
 * O banco só exige MAIÚSCULA (0084) — a Graph API também devolve ARCHIVED,
 * IN_PROCESS e WITH_ISSUES, e travar o CHECK nestes dois faria a primeira
 * sincronização real ser recusada pelo próprio banco. A operação usa só estes
 * dois (mais "sem status"), e é aqui, na fronteira, que a recusa vira frase.
 */
export const AD_STATUSES = ["ACTIVE", "PAUSED"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

export const AD_STATUS_LABEL: Record<AdStatus, string> = { ACTIVE: "Ativa", PAUSED: "Pausada" };

/** Rótulo do status cru do banco — a MESMA tradução na tabela, no filtro e no
 *  painel. Estava escrita duas vezes; um valor fora da dupla aparece como veio,
 *  porque inventar um nome para ele esconderia o dado. */
export const adStatusLabel = (status: string | null): string =>
  !status ? "—" : /^active$/i.test(status) ? "Ativa" : /^paused$/i.test(status) ? "Pausada" : status;

export type AdCampaignInput = {
  externalId: string;
  platform: AdPlatform;
  name: string;
  developerId?: string | null;
  status?: string | null;
  dailyBudget?: number | null;
  /** Verba contratada. `null` = sem verba lançada; ausente = "não mexa". */
  lifetimeBudget?: number | null;
  /** `YYYY-MM-DD`. */
  startsOn?: string | null;
  endsOn?: string | null;
  leadSourceId?: string | null;
  totalSpend?: number;
};

/**
 * A recusa de campanha inválida, num lugar só.
 *
 * Criar e corrigir repetiam as duas checagens de verba e não olhavam nem o
 * nome, nem o status, nem o período — o formulário conferia parte disso e
 * qualquer outro chamador entrava direto. Os CHECKs do banco (0063, 0084, 0089)
 * continuam sendo a garantia final; o que muda é que a recusa esperada chega
 * como instrução em vez de 23514 traduzido para "um dos campos está fora do
 * valor permitido".
 *
 * Devolve a frase do problema, ou `null` quando não há nenhum.
 */
export function problemaNaCampanha(input: AdCampaignInput): string | null {
  if (!input.externalId.trim()) {
    return "Informe o ID externo da campanha — é ele que liga o lead à campanha.";
  }
  if (!input.name.trim()) return "Informe o nome da campanha.";
  if (input.status != null && !(AD_STATUSES as readonly string[]).includes(input.status)) {
    return "Status inválido: use ACTIVE (Ativa) ou PAUSED (Pausada).";
  }
  if (input.totalSpend !== undefined && (!Number.isFinite(input.totalSpend) || input.totalSpend < 0)) {
    return "O investimento não pode ser negativo.";
  }
  if (input.dailyBudget != null && (!Number.isFinite(input.dailyBudget) || input.dailyBudget < 0)) {
    return "O orçamento diário não pode ser negativo.";
  }
  if (input.lifetimeBudget != null && (!Number.isFinite(input.lifetimeBudget) || input.lifetimeBudget < 0)) {
    return "A verba total não pode ser negativa.";
  }
  // Comparação de string, e não de `Date`: `YYYY-MM-DD` já ordena
  // cronologicamente e `new Date("2026-09-01")` é meia-noite UTC — a mesma
  // armadilha de fuso que `previousMonth` documenta mais abaixo.
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
    return "O fim da veiculação não pode ser antes do início.";
  }
  return null;
}

/** Mensagem do id externo repetido — o unique é global (0067), não por plataforma. */
export const ID_EXTERNO_REPETIDO =
  "Já existe uma campanha com esse ID externo. Use Editar para corrigir a que existe.";

/**
 * Cadastra campanha NOVA — nunca sobrescreve a que já existe.
 *
 * Era um `upsert` com conflito em `(platform, external_id)`: digitar um id
 * externo já cadastrado trocava nome, construtora, status e `total_spend` da
 * campanha existente, zerava o `daily_budget` e o toast respondia "Campanha
 * registrada". Perda de dado sem rastro, no campo que decide verba. Corrigir
 * campanha é trabalho de `updateAdCampaign`, que grava pela chave `id`.
 */
export async function createAdCampaign(input: AdCampaignInput): Promise<void> {
  // Os checks do banco (0063, 0089) recusam de qualquer jeito; parar aqui evita
  // gastar um round-trip para dizer a mesma coisa em erro genérico.
  const problema = problemaNaCampanha(input);
  if (problema) throw new Error(problema);
  const { error } = await untyped.from("ad_campaigns").insert({
    external_id: input.externalId,
    platform: input.platform,
    name: input.name,
    developer_id: input.developerId ?? null,
    status: input.status ?? null,
    daily_budget: input.dailyBudget ?? null,
    lifetime_budget: input.lifetimeBudget ?? null,
    starts_on: input.startsOn ?? null,
    ends_on: input.endsOn ?? null,
    lead_source_id: input.leadSourceId ?? null,
    ...(input.totalSpend !== undefined ? { total_spend: input.totalSpend } : {}),
  });
  // 23505 genérico ("Já existe um registro com esses dados") não diz o que fazer.
  if (error?.code === "23505") throw new Error(ID_EXTERNO_REPETIDO);
  if (error) throw dbError("salvar campanha", error);
}

/**
 * Corrige uma campanha já cadastrada — inclusive o `external_id`.
 *
 * A chave é o `id`, e não o par `(platform, external_id)`: por ele, trocar o id
 * externo criaria uma segunda linha e deixaria a errada somando no KPI de
 * investimento para sempre. Aqui o erro de digitação tem conserto.
 */
export async function updateAdCampaign(id: string, patch: AdCampaignInput): Promise<void> {
  if (patch.totalSpend !== undefined && (!Number.isFinite(patch.totalSpend) || patch.totalSpend < 0)) {
    throw new Error("O investimento não pode ser negativo.");
  }
  if (patch.dailyBudget != null && (!Number.isFinite(patch.dailyBudget) || patch.dailyBudget < 0)) {
    throw new Error("O orçamento diário não pode ser negativo.");
  }
  const { data, error } = await supabase
    .from("ad_campaigns")
    .update({
      external_id: patch.externalId,
      platform: patch.platform,
      name: patch.name,
      developer_id: patch.developerId ?? null,
      status: patch.status ?? null,
      // `dailyBudget` só entra quando o chamador o informou: omitir preserva o
      // orçamento que a plataforma gravou, e `null` explícito é "sem orçamento".
      ...(patch.dailyBudget !== undefined ? { daily_budget: patch.dailyBudget } : {}),
      ...(patch.totalSpend !== undefined ? { total_spend: patch.totalSpend } : {}),
    })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") throw new Error(ID_EXTERNO_REPETIDO);
  if (error) throw dbError("salvar campanha", error);
  if (!data?.length) throw new Error("Sem permissão para alterar campanhas (apenas admin e marketing).");
}

/**
 * Remove a campanha. `select("id")` porque o RLS não erra ao recusar: filtra a
 * linha e o PostgREST devolve 204 — sem conferir o retorno, a tela diria
 * "excluída" e a campanha continuaria somando no KPI de investimento.
 */
export async function deleteAdCampaign(id: string): Promise<void> {
  const { data, error } = await supabase.from("ad_campaigns").delete().eq("id", id).select("id");
  if (error) throw dbError("excluir campanha", error);
  if (!data?.length) throw new Error("Sem permissão para excluir campanhas (apenas admin e marketing).");
}

export type CampaignStatRow = {
  campaign_id: string;
  leads: number;
  /** Lead com `converted_deal_id` — proposta em aberto e venda perdida entram. */
  conversions: number;
  /** Negócios GANHOS (`outcome = 'won'`) que vieram da campanha (0081). É o
   *  denominador do custo por VENDA: `conversions` conta negócio, não venda. */
  sales: number;
  /** VGV dos negócios GANHOS que vieram dos leads da campanha (0063). */
  revenue: number;
};

/**
 * Leads, conversões e receita por campanha — agregado e `security definer`.
 *
 * Contar `leads` no navegador não serve: o RLS entrega ao marketing só a fila e
 * o próprio perfil, então a mesma campanha aparecia com dois números na mesma
 * dobra. A RPC conta a empresa inteira sem expor dado pessoal.
 *
 * Devolve TODO `campaign_id` visto em `leads`, inclusive o de campanha que
 * ninguém cadastrou — é assim que a tela sabe avisar do lead que ficaria fora
 * da conta.
 */
export async function campaignStats(): Promise<CampaignStatRow[]> {
  const { data, error } = await untyped.rpc("marketing_campaign_stats");
  if (error) throw dbError("marketing_campaign_stats", error);
  return ((data ?? []) as CampaignStatRow[]).map((row) => ({
    campaign_id: row.campaign_id,
    leads: Number(row.leads ?? 0),
    conversions: Number(row.conversions ?? 0),
    sales: Number(row.sales ?? 0),
    revenue: Number(row.revenue ?? 0),
  }));
}

export type DeveloperSummaryRow = {
  /** `null` é o balde "Sem construtora" — negócio sem construtora e lead de
   *  campanha não cadastrada moram aqui em vez de sumir da conta. */
  developer_id: string | null;
  developer_name: string;
  active: boolean;
  /** Aporte do período escolhido (ou de todos os meses, quando `period` é nulo). */
  investment: number;
  /** Gasto das campanhas — ACUMULADO da vida da campanha, nunca mensal. */
  campaign_spend: number;
  campaigns: number;
  leads: number;
  deals: number;
  sales: number;
  vgv: number;
};

/**
 * Aporte, gasto de campanha, leads, negócios e VGV por construtora.
 *
 * `period` nulo = tudo acumulado, que é o único recorte em que custo e retorno
 * são comparáveis: o aporte é mensal e `ad_campaigns.total_spend` é acumulado.
 * Com um mês escolhido, aporte/leads/negócios/VGV são do mês e
 * `campaign_spend` continua acumulado — a tela diz isso e não soma os dois.
 */
export async function developerSummary(period: string | null): Promise<DeveloperSummaryRow[]> {
  const { data, error } = await untyped.rpc("marketing_developer_summary", { p_period: period });
  if (error) throw dbError("marketing_developer_summary", error);
  return ((data ?? []) as DeveloperSummaryRow[]).map((row) => ({
    developer_id: row.developer_id ?? null,
    developer_name: row.developer_name,
    active: Boolean(row.active),
    investment: Number(row.investment ?? 0),
    campaign_spend: Number(row.campaign_spend ?? 0),
    campaigns: Number(row.campaigns ?? 0),
    leads: Number(row.leads ?? 0),
    deals: Number(row.deals ?? 0),
    sales: Number(row.sales ?? 0),
    vgv: Number(row.vgv ?? 0),
  }));
}

// -----------------------------------------------------------------------------
// Contas de marketing (puras — a verificação executável vive em analytics.test.ts)
// -----------------------------------------------------------------------------

/** Custo por lead. `null` quando não há lead: "R$ 0,00 por lead" mentiria. */
export const costPerLead = (spend: number, leads: number): number | null =>
  leads > 0 ? spend / leads : null;

/**
 * Retorno sobre o investimento em anúncio: VGV ganho ÷ gasto da campanha.
 *
 * O par vem do banco (`leads.campaign_id` liga o lead à campanha e
 * `leads.converted_deal_id` liga o lead ao negócio), então não há rateio no
 * chute. Sem gasto não há ROAS — dividir por zero devolveria "infinito", que na
 * tela vira um número gigante sem significado.
 */
export const roas = (revenue: number, spend: number): number | null =>
  spend > 0 ? revenue / spend : null;

/** "62,1×" ou travessão. Uma casa decimal: ROAS é ordem de grandeza, não centavo. */
export const roasLabel = (value: number | null): string =>
  value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`;

/**
 * Cor do CPL RELATIVA à média do recorte visível.
 *
 * A escala fixa (verde < 15, amarelo < 25) nunca disparava: o CPL real da
 * operação é de centenas de reais, então 100% das linhas saíam vermelhas —
 * sinal constante é ruído colorido. Barato em relação aos colegas é bom sinal;
 * caro é o que merece atenção. Sem média (nenhum lead no recorte) não há
 * comparação e a linha fica neutra.
 */
export type CplTone = "success" | "warning" | "danger" | "neutral";

export const cplTone = (cpl: number | null, average: number | null): CplTone => {
  if (cpl === null || average === null || average <= 0) return "neutral";
  if (cpl <= average * 0.8) return "success";
  if (cpl <= average * 1.2) return "warning";
  return "danger";
};

/**
 * `YYYY-MM-01` do mês anterior.
 *
 * Aritmética de string, e não de `Date`: `new Date("2026-01-01")` é meia-noite
 * UTC e, no fuso do Brasil, já é 31/12 — o "mês anterior" de janeiro virava
 * novembro. É o mesmo motivo que fez `monthStart` largar o `toISOString`.
 */
export const previousMonth = (period: string): string => {
  const [ano, mes] = period.split("-").map(Number);
  if (!Number.isFinite(ano) || !Number.isFinite(mes)) throw new Error(`período inválido: ${period}`);
  return mes === 1 ? `${ano - 1}-12-01` : `${ano}-${String(mes - 1).padStart(2, "0")}-01`;
};

/** Variação contra o mês anterior, pronta para o `delta` do `KpiCard`. */
export type Trend = { label: string; direction: "up" | "down" | "flat" };

/**
 * Comparação mês a mês — só onde as duas pontas cabem na mesma janela.
 *
 * Vale para aporte, leads, negócios, vendas e VGV, que a RPC já recorta por
 * mês. NÃO vale para CPL nem para o ROAS de campanha: o denominador dos dois é
 * `ad_campaigns.total_spend`, que é o gasto ACUMULADO da vida da campanha e não
 * tem data — dividir um custo eterno por um resultado mensal e depois comparar
 * dois desses seria inventar uma série temporal que o dado não sustenta.
 *
 * Mês anterior zerado não vira percentual: 0 → 10 não é "+1000%", é "não havia
 * com o que comparar", e é isso que a etiqueta diz.
 */
export const monthOverMonth = (current: number, previous: number): Trend | null => {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return current === 0 ? null : { label: "sem base no mês anterior", direction: "flat" };
  const pct = ((current - previous) / previous) * 100;
  // Abaixo de meio ponto o arredondamento imprimiria "+0%" com uma seta para
  // cima — sinal de movimento onde não houve movimento.
  if (Math.abs(pct) < 0.5) return { label: "estável", direction: "flat" };
  return {
    label: `${pct > 0 ? "+" : ""}${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`,
    direction: pct > 0 ? "up" : "down",
  };
};

export type AportePayload = {
  period: string;
  developer_id: string;
  amount: number;
  /** Ausente = "não mexa na nota que já está gravada". */
  notes?: string | null;
};

/**
 * Payload de `marketing_investments` a partir de um formulário de aporte.
 *
 * A nota só entra quando há intenção explícita: campo preenchido, ou linha
 * trazida para o formulário pelo botão Editar — aí o branco significa "apague
 * a nota". Salvar de novo com o campo vazio, SEM ter editado, deixa `notes`
 * fora do payload: o upsert só sobrescreve coluna enviada, então a nota já
 * lançada sobrevive.
 *
 * É a mesma regra que a importação de planilha aplica ao omitir `notes` quando
 * o arquivo não traz a coluna. Ela estava escrita em três lugares com dois
 * comportamentos: os dois formulários (`/data` e o popup de `/marketing`)
 * mandavam `notes: null` e apagavam a nota com toast de sucesso.
 */
export function aportePayload(input: {
  period: string;
  developer_id: string;
  amount: number;
  notes: string;
  /** A linha veio do botão Editar: o branco agora quer dizer "apague". */
  editing: boolean;
}): AportePayload {
  const notes = input.notes.trim();
  return {
    period: input.period,
    developer_id: input.developer_id,
    amount: input.amount,
    ...(notes || input.editing ? { notes: notes || null } : {}),
  };
}

// -----------------------------------------------------------------------------
// Trilha de auditoria
// -----------------------------------------------------------------------------

export type HistoryEntry = {
  id: string;
  actor_id: string | null;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

/** Log imutável do negócio — escrito por `deals_log_changes` (SECURITY DEFINER). */
export async function listDealHistory(dealId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("deal_history")
    .select("id,actor_id,kind,from_value,to_value,detail,created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  if (error) throw dbError("histórico do negócio", error);
  return (data ?? []) as HistoryEntry[];
}

export async function listCcaCaseEvents(caseId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("cca_case_events")
    .select("id,actor_id,kind,from_value,to_value,detail,created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (error) throw dbError("eventos do caso CCA", error);
  return (data ?? []) as HistoryEntry[];
}
