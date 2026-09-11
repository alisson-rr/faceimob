import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { date, monthStart } from "@/lib/format";
import { functionErrorMessage } from "@/lib/functionError";
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
  /** Recorte que `total_spend` cobre quando ele veio do livro — relatório
   *  importado (0113) ou sincronização (0115). Nulo nos dois = gasto digitado. */
  spend_period_start: string | null;
  spend_period_end: string | null;
  /** Conta de anúncios de onde a campanha é sincronizada (0115). Preenchida =
   *  nome, status, verba e gasto vêm da Meta e o banco não os deixa editar. */
  meta_account_id: string | null;
  /** Canal que a sincronização leu nos conjuntos da campanha. */
  meta_channel: CanalMeta | null;
  /** Status de ENTREGA na Meta (CAMPAIGN_PAUSED, WITH_ISSUES…), que pode
   *  diferir do `status` configurado. */
  meta_effective_status: string | null;
  meta_budget_level: NivelDeVerba | null;
  /** Construtora sugerida pelo nome no padrão F0 — só sugestão: o vínculo é
   *  `developer_id` e exige um clique. */
  developer_suggested_id: string | null;
  /** Procedência de `total_spend` segundo o livro. Nulo = digitado. */
  spend_source: SpendSource | null;
};

/** Canal da campanha segundo a sincronização (0115, `canalDaCampanha`). */
export type CanalMeta = "formulario" | "whatsapp" | "landing_page" | "misto" | "outro";
/** Onde a verba mora na Meta: na campanha (CBO), nos conjuntos (ABO) ou total. */
export type NivelDeVerba = "campaign" | "adset" | "lifetime";
export type SpendSource = "planilha" | "meta_api" | "misto";

const CAMPOS_CAMPANHA =
  "id,external_id,platform,name,developer_id,status,daily_budget,lifetime_budget,"
  + "starts_on,ends_on,lead_source_id,total_spend,synced_at,spend_period_start,spend_period_end,"
  + "meta_account_id,meta_channel,meta_effective_status,meta_budget_level,developer_suggested_id,spend_source";

export async function listAdCampaigns(): Promise<AdCampaignRow[]> {
  // `untyped` pelo mesmo motivo das RPCs acima: as colunas da 0089 ainda não
  // existem em `types.ts`, que é gerado por `supabase gen types`.
  const { data, error } = await untyped
    .from("ad_campaigns")
    .select(CAMPOS_CAMPANHA)
    .order("name");
  if (error) throw dbError("listar campanhas", error);
  // `as unknown` porque o cliente sem schema não sabe inferir a lista de
  // colunas — o mesmo escape das RPCs, e ele morre no próximo `gen types`.
  return (data ?? []) as unknown as AdCampaignRow[];
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
 * sincronização real ser recusada pelo próprio banco. Esta lista é o que a
 * OPERAÇÃO usa: é dela que saem os itens do formulário e os dois destinos do
 * botão de pausar/reativar. Um valor gravado fora dela continua legível e
 * editável — quem manda na escrita é o CHECK, não este catálogo.
 */
export const AD_STATUSES = ["ACTIVE", "PAUSED"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

/** Rótulo do status cru do banco — a MESMA tradução na tabela, no filtro e no
 *  painel. Estava escrita duas vezes; um valor fora da dupla aparece como veio,
 *  porque inventar um nome para ele esconderia o dado. */
export const adStatusLabel = (status: string | null): string =>
  !status ? "—" : /^active$/i.test(status) ? "Ativa" : /^paused$/i.test(status) ? "Pausada" : status;

/**
 * De onde veio o gasto da campanha — a MESMA frase nas duas tabelas de
 * `/marketing`.
 *
 * Quatro origens, e a tela precisa distinguir todas porque este é o número que
 * divide o CPL e o ROAS:
 *
 *   · SINCRONIZADO DA META (0115, `spend_source = 'meta_api'`) — o livro só tem
 *     dias da Marketing API. A frase diz até quando E desde quando: a
 *     sincronização cobre a janela dela, não a vida inteira da campanha, e
 *     "sincronizado" sem o início passaria por gasto vitalício.
 *   · RELATÓRIO IMPORTADO (0113) — tem período, e ele aparece junto: um
 *     relatório de agosto lido como gasto vitalício subestimaria o CPL. Linha
 *     anterior à 0115 tem período e procedência nula: só a planilha existia.
 *   · MISTO — o livro tem recortes das duas fontes (cada dia de uma só: a 0114
 *     impede sobreposição).
 *   · digitado, com ou sem data — o `synced_at` de semente, sem nada por trás,
 *     continua dizendo "digitado": escrita em dois lugares, a frase divergiu uma
 *     vez ("sincronizado 28/07/2026" para a linha que o painel dava como
 *     digitada) e afirmou uma conversa com a Meta que nunca houve.
 */
export const origemDoGasto = (
  syncedAt: string | null,
  spendPeriodStart?: string | null,
  spendPeriodEnd?: string | null,
  spendSource?: SpendSource | null,
): string => {
  if (spendSource === "meta_api") {
    const ate = spendPeriodEnd ?? syncedAt;
    const desde = spendPeriodStart && spendPeriodStart !== spendPeriodEnd ? ` · desde ${date(spendPeriodStart)}` : "";
    return ate ? `sincronizado da Meta até ${date(ate)}${desde}` : "sincronizado da Meta";
  }
  if (spendPeriodStart && spendPeriodEnd) {
    const periodo = spendPeriodStart === spendPeriodEnd
      ? date(spendPeriodStart)
      : `${date(spendPeriodStart)} a ${date(spendPeriodEnd)}`;
    return spendSource === "misto" ? `misto: relatório importado e Meta · ${periodo}` : `relatório importado · ${periodo}`;
  }
  return syncedAt ? `digitado · atualizado ${date(syncedAt)}` : "digitado";
};

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
  /** Preenchido = campanha sincronizada (0115): identificação, nome, status,
   *  verba e gasto ficam fora do patch de `updateAdCampaign`. */
  metaAccountId?: string | null;
};

/** Qual campo impediu o salvamento — a tela usa isto para focar o campo, e não
 *  só para pedir que o operador procure qual dos onze é o culpado. */
export type CampoDaCampanha =
  | "externalId"
  | "name"
  | "status"
  | "totalSpend"
  | "dailyBudget"
  | "lifetimeBudget"
  | "endsOn";

export type ProblemaNaCampanha = { campo: CampoDaCampanha; frase: string };

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
 * Devolve o campo e a frase do problema, ou `null` quando não há nenhum.
 */
export function problemaNaCampanha(input: AdCampaignInput): ProblemaNaCampanha | null {
  if (!input.externalId.trim()) {
    return { campo: "externalId", frase: "Informe o ID externo da campanha — é ele que liga o lead à campanha." };
  }
  if (!input.name.trim()) return { campo: "name", frase: "Informe o nome da campanha." };
  // A regra é a do CHECK do banco (`ad_campaigns_status_maiusculo`, 0084), e
  // não a dupla que o formulário oferece: o CHECK ficou aberto de propósito
  // para ARCHIVED/IN_PROCESS, que é o que a Graph API devolve. Recusar aqui
  // tudo fora de ACTIVE/PAUSED deixava uma linha gravada como ARCHIVED
  // INEDITÁVEL pela tela — o operador abria só para corrigir a verba e o
  // Salvar era recusado por um campo que ele não tocou, sem caminho de
  // conserto. Digitar minúscula continua recusado, que é o erro real: o banco
  // devolveria 23514.
  if (input.status != null && (!input.status.trim() || input.status !== input.status.toUpperCase())) {
    return {
      campo: "status",
      frase: "Status inválido: o registro guarda o valor em MAIÚSCULA — use ACTIVE (Ativa) ou PAUSED (Pausada).",
    };
  }
  if (input.totalSpend !== undefined && (!Number.isFinite(input.totalSpend) || input.totalSpend < 0)) {
    return { campo: "totalSpend", frase: "O investimento não pode ser negativo." };
  }
  if (input.dailyBudget != null && (!Number.isFinite(input.dailyBudget) || input.dailyBudget < 0)) {
    return { campo: "dailyBudget", frase: "O orçamento diário não pode ser negativo." };
  }
  if (input.lifetimeBudget != null && (!Number.isFinite(input.lifetimeBudget) || input.lifetimeBudget < 0)) {
    return { campo: "lifetimeBudget", frase: "A verba total não pode ser negativa." };
  }
  // Comparação de string, e não de `Date`: `YYYY-MM-DD` já ordena
  // cronologicamente e `new Date("2026-09-01")` é meia-noite UTC — a mesma
  // armadilha de fuso que `previousMonth` documenta mais abaixo.
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) {
    return { campo: "endsOn", frase: "O fim da veiculação não pode ser antes do início." };
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
  if (problema) throw new Error(problema.frase);
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
  const problema = problemaNaCampanha(patch);
  if (problema) throw new Error(problema.frase);
  // Campanha sincronizada (0115): identificação, nome, status, verba e gasto
  // vêm da Meta, e o gatilho `ad_campaigns_guard_meta` recusa com 42501 o patch
  // que os traga diferentes. Reenviar "os mesmos" também não serve: o
  // formulário aberto antes da sincronização das 06:00 os mandaria VELHOS, e
  // salvar só a construtora viraria recusa. Fica o vínculo, que é o editável.
  const daPlataforma = patch.metaAccountId
    ? {}
    : {
        external_id: patch.externalId,
        platform: patch.platform,
        name: patch.name,
        status: patch.status ?? null,
        // Verba só entra quando o chamador a informou: omitir preserva o valor
        // já lançado, e `null` explícito é "sem verba".
        ...(patch.dailyBudget !== undefined ? { daily_budget: patch.dailyBudget } : {}),
        ...(patch.lifetimeBudget !== undefined ? { lifetime_budget: patch.lifetimeBudget } : {}),
        ...(patch.totalSpend !== undefined ? { total_spend: patch.totalSpend } : {}),
      };
  const { data, error } = await untyped
    .from("ad_campaigns")
    .update({
      ...daPlataforma,
      developer_id: patch.developerId ?? null,
      lead_source_id: patch.leadSourceId ?? null,
      starts_on: patch.startsOn ?? null,
      ends_on: patch.endsOn ?? null,
    })
    .eq("id", id)
    .select("id");
  if (error?.code === "23505") throw new Error(ID_EXTERNO_REPETIDO);
  if (error) throw dbError("salvar campanha", error);
  if (!data?.length) throw new Error("Sem permissão para alterar campanhas (apenas admin e marketing).");
}

/**
 * "Vincular" a construtora que a sincronização sugeriu pelo nome (F0) — um
 * clique, gravando só `developer_id`, que é o campo que o gatilho da 0115
 * deixa editável na campanha sincronizada. `select("id")` pelo mesmo motivo de
 * `deleteAdCampaign`: o RLS recusa filtrando a linha, sem erro.
 */
export async function vincularConstrutora(id: string, developerId: string): Promise<void> {
  const { data, error } = await supabase
    .from("ad_campaigns")
    .update({ developer_id: developerId })
    .eq("id", id)
    .select("id");
  if (error) throw dbError("vincular a construtora à campanha", error);
  if (!data?.length) throw new Error("Sem permissão para alterar campanhas (apenas admin e marketing).");
}

/**
 * Pausar/reativar como GESTO — sem passar pelo formulário inteiro.
 *
 * Escreve só `status`: reenviar o resto do cadastro para trocar um estado é o
 * caminho que erra, porque qualquer campo que a tela tenha carregado torto vai
 * junto. `select("id")` pelo mesmo motivo de `deleteAdCampaign`: o RLS não erra
 * ao recusar, filtra a linha e devolve 204 — sem conferir o retorno a tela
 * diria "pausada" com a campanha ativa no banco.
 *
 * O efeito é LOCAL: nada aqui fala com a Meta, e quem chama precisa dizer isso
 * na tela — senão pausar no CRM passa por ter pausado o gasto.
 */
export async function setAdCampaignStatus(id: string, status: AdStatus): Promise<void> {
  if (!(AD_STATUSES as readonly string[]).includes(status)) {
    throw new Error("Status inválido: use ACTIVE (Ativa) ou PAUSED (Pausada).");
  }
  const { data, error } = await supabase
    .from("ad_campaigns")
    .update({ status })
    .eq("id", id)
    .select("id");
  if (error) throw dbError("alterar status da campanha", error);
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

/** Uma linha do relatório da Meta já casada com a campanha cadastrada. */
export type AdSpendImportRow = {
  campaign_id: string;
  /** `YYYY-MM-DD` — o recorte do relatório, não a veiculação da campanha. */
  period_start: string;
  period_end: string;
  spend: number;
};

export type ResultadoDaImportacao = {
  linhas: number;
  campanhas: number;
  /** Linhas de período que saíram para o relatório novo entrar. */
  substituidas: number;
};

/**
 * Grava o gasto do relatório exportado do Gerenciador de Anúncios.
 *
 * Uma chamada só, e não um insert por linha: apagar o período sobreposto e
 * gravar o novo são dois passos que não podem acontecer pela metade — entre um
 * e outro o `total_spend` ficaria menor do que a realidade. A RPC (0113) faz os
 * dois na mesma transação, é `security invoker` (a RLS de `ad_campaign_spend`
 * continua valendo) e recusa quem não é admin, sócio ou marketing com 42501.
 *
 * Reimportar o mesmo arquivo não duplica: a chave é campanha + período.
 */
export async function importMetaSpend(
  rows: AdSpendImportRow[],
  sourceFile?: string | null,
): Promise<ResultadoDaImportacao> {
  if (!rows.length) throw new Error("Nenhuma linha do relatório casou com campanha cadastrada.");
  const { data, error } = await untyped.rpc("marketing_import_ad_spend", {
    p_rows: rows,
    p_source_file: sourceFile ?? null,
  });
  if (error) throw dbError("importar o relatório da Meta", error);
  const resultado = (data as ResultadoDaImportacao[] | null)?.[0];
  return {
    linhas: Number(resultado?.linhas ?? 0),
    campanhas: Number(resultado?.campanhas ?? 0),
    substituidas: Number(resultado?.substituidas ?? 0),
  };
}

/** Um recorte já gravado do livro do gasto (`ad_campaign_spend`, 0113). Em
 *  português porque quem consome é a conciliação do relatório. */
export type AdSpendBookRow = {
  campaignId: string;
  /** `YYYY-MM-DD`. */
  inicio: string;
  fim: string;
  gasto: number;
};

/**
 * O gasto JÁ IMPORTADO das campanhas — o livro que a próxima importação soma.
 *
 * A prévia precisa dele para não mentir: `marketing_import_ad_spend` regrava
 * `total_spend` como a soma do livro INTEIRO da campanha, então dizer "serão
 * gravados R$ X" com a soma das linhas do arquivo promete um número que a tela
 * não vai mostrar quando já existe outro período gravado.
 *
 * Leitura comum, sob RLS (`reports.view_finance`, 0045) — a mesma permissão que
 * a tela de marketing já exige para ver dinheiro de campanha.
 */
export async function adSpendBook(campaignIds: string[]): Promise<AdSpendBookRow[]> {
  if (!campaignIds.length) return [];
  const { data, error } = await untyped
    .from("ad_campaign_spend")
    .select("campaign_id,period_start,period_end,spend")
    .in("campaign_id", campaignIds);
  if (error) throw dbError("ler o gasto já importado das campanhas", error);
  const rows = (data ?? []) as {
    campaign_id: string;
    period_start: string;
    period_end: string;
    spend: number | string | null;
  }[];
  return rows.map((row) => ({
    campaignId: row.campaign_id,
    inicio: row.period_start,
    fim: row.period_end,
    gasto: Number(row.spend ?? 0),
  }));
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
// Números "segundo a Meta" (0115) — o front só exibe
//
// CTR, CPC, CPM, resultado do canal e custo por resultado são calculados nas
// RPCs `meta_metricas` e `meta_metricas_por_canal`, que os alertas e as IAs
// também leem. Refazer a conta aqui seria a mesma regra em dois lugares — a que
// divergiu no sistema antigo. O CPL e o ROAS do CRM continuam nas funções puras
// logo abaixo, com a mesma definição.
// -----------------------------------------------------------------------------

export const CANAL_META_LABEL: Record<CanalMeta, string> = {
  formulario: "Formulário",
  whatsapp: "WhatsApp",
  landing_page: "Landing page",
  misto: "Misto",
  outro: "Outro",
};

/** Uma campanha no período, somada dos insights diários (`meta_metricas`). */
export type MetaMetricaRow = {
  campaign_id: string;
  external_id: string;
  name: string;
  account_id: string | null;
  channel: CanalMeta;
  spend: number;
  impressions: number;
  /** Só em período de UM dia: a Meta conta pessoa única por período, e somar
   *  dias inventaria número. A RPC devolve nulo nos outros. */
  reach: number | null;
  clicks: number;
  link_clicks: number;
  /** Fração (0,0123 = 1,23%): cliques no link ÷ impressões — o "CTR (link)" do
   *  Gerenciador. Nulo quando não houve impressão. */
  ctr: number | null;
  /** Custo por clique no link. */
  cpc: number | null;
  cpm: number | null;
  leads_form: number;
  conversations: number;
  lp_leads: number;
  /** Resultado do canal da campanha, contado pela sincronização. */
  resultados: number;
  custo_por_resultado: number | null;
  dias: number;
  /** Primeiro dia sincronizado da conta: período que começa antes está incompleto. */
  cobertura_desde: string | null;
};

/** Um canal no período (`meta_metricas_por_canal`): gasto das campanhas dele ÷ resultados delas. */
export type MetaCanalRow = {
  channel: CanalMeta;
  spend: number;
  resultados: number;
  custo_por_resultado: number | null;
  campanhas: number;
};

/** O PostgREST entrega `numeric` como texto; nulo continua nulo — razão sem
 *  denominador não vira zero. */
const numeroOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function fetchMetaMetricas(from: string, to: string): Promise<MetaMetricaRow[]> {
  const { data, error } = await untyped.rpc("meta_metricas", { p_from: from, p_to: to });
  if (error) throw dbError("ler os números da Meta", error);
  return ((data ?? []) as MetaMetricaRow[]).map((r) => ({
    ...r,
    spend: Number(r.spend ?? 0),
    impressions: Number(r.impressions ?? 0),
    reach: numeroOuNulo(r.reach),
    clicks: Number(r.clicks ?? 0),
    link_clicks: Number(r.link_clicks ?? 0),
    ctr: numeroOuNulo(r.ctr),
    cpc: numeroOuNulo(r.cpc),
    cpm: numeroOuNulo(r.cpm),
    leads_form: Number(r.leads_form ?? 0),
    conversations: Number(r.conversations ?? 0),
    lp_leads: Number(r.lp_leads ?? 0),
    resultados: Number(r.resultados ?? 0),
    custo_por_resultado: numeroOuNulo(r.custo_por_resultado),
    dias: Number(r.dias ?? 0),
  }));
}

export async function fetchMetaPorCanal(from: string, to: string): Promise<MetaCanalRow[]> {
  const { data, error } = await untyped.rpc("meta_metricas_por_canal", { p_from: from, p_to: to });
  if (error) throw dbError("ler os números da Meta por canal", error);
  return ((data ?? []) as MetaCanalRow[]).map((r) => ({
    channel: r.channel,
    spend: Number(r.spend ?? 0),
    resultados: Number(r.resultados ?? 0),
    custo_por_resultado: numeroOuNulo(r.custo_por_resultado),
    campanhas: Number(r.campanhas ?? 0),
  }));
}

export type MetaSyncRun = {
  status: "rodando" | "ok" | "falhou";
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

/** Uma conta de anúncios e a execução mais recente dela. */
export type MetaSyncConta = {
  id: string;
  act_id: string;
  name: string | null;
  enabled: boolean;
  last_sync_ok_at: string | null;
  last_sync_attempt_at: string | null;
  /** Limpo pela sincronização boa; gravado pela que falha. */
  last_sync_error: string | null;
  ultima: MetaSyncRun | null;
};

/**
 * Onde a sincronização está, por conta: a última boa (a data dos números da
 * tela) e a última execução — que diz se falhou, por quê e quando, ou se há uma
 * rodando agora. Leitura comum, sob RLS (`reports.view_finance`).
 */
export async function fetchMetaSyncStatus(): Promise<MetaSyncConta[]> {
  const [contas, execucoes] = await Promise.all([
    untyped
      .from("meta_ad_accounts")
      .select("id,act_id,name,enabled,last_sync_ok_at,last_sync_attempt_at,last_sync_error")
      .order("name"),
    // ponytail: as 50 execuções mais recentes bastam para achar a última de
    // cada conta; uma consulta por conta (limit 1) quando houver dezenas delas.
    untyped
      .from("meta_sync_runs")
      .select("account_id,status,error,started_at,finished_at")
      .order("started_at", { ascending: false })
      .limit(50),
  ]);
  if (contas.error) throw dbError("ler as contas de anúncios", contas.error);
  if (execucoes.error) throw dbError("ler as sincronizações com a Meta", execucoes.error);
  const ultima = new Map<string, MetaSyncRun>();
  for (const r of (execucoes.data ?? []) as (MetaSyncRun & { account_id: string })[]) {
    if (!ultima.has(r.account_id)) {
      ultima.set(r.account_id, { status: r.status, error: r.error, started_at: r.started_at, finished_at: r.finished_at });
    }
  }
  return ((contas.data ?? []) as Omit<MetaSyncConta, "ultima">[]).map((c) => ({ ...c, ultima: ultima.get(c.id) ?? null }));
}

export type ResultadoDaSincronizacao = {
  ok: boolean;
  contas: {
    account_id: string;
    status: "ok" | "falhou" | "em_andamento";
    erro?: string;
    campanhas?: number;
    conflitos?: string[];
  }[];
};

/**
 * "Sincronizar agora": a edge `meta-sync` no modo manual (sem `account_id`,
 * todas as contas ligadas). Quem pode é conferido lá, pelo mesmo
 * `has_permission('marketing.meta_manage')` do banco; a tela só esconde o botão.
 * Falha da Meta não vira número: a execução fica 'falhou' com a frase, e a tela
 * continua nos números da última sincronização boa.
 */
export async function sincronizarMeta(accountId?: string): Promise<ResultadoDaSincronizacao> {
  const { data, error } = await supabase.functions.invoke<ResultadoDaSincronizacao>("meta-sync", {
    body: accountId ? { account_id: accountId } : {},
  });
  if (error) throw new Error(await functionErrorMessage(error, "Não foi possível sincronizar com a Meta."));
  if (!data || !Array.isArray(data.contas)) throw new Error("A sincronização respondeu sem dizer o que fez.");
  return data;
}

export const PERIODOS_META = ["ontem", "7d", "30d", "mes_atual", "mes_anterior"] as const;
export type PeriodoMeta = (typeof PERIODOS_META)[number];

export const PERIODO_META_LABEL: Record<PeriodoMeta, string> = {
  ontem: "Ontem",
  "7d": "7 dias, até ontem",
  "30d": "30 dias, até ontem",
  mes_atual: "Mês atual, até hoje",
  mes_anterior: "Mês anterior",
};

const diaLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * O recorte `[from, to]` (`YYYY-MM-DD`, inclusivo) de cada período do seletor.
 *
 * Pelo construtor LOCAL de `Date`, e não por `toISOString`: depois das 21h em
 * Brasília o UTC já é amanhã (a armadilha que `monthStart` documenta). "Ontem"
 * é o único período de um dia — e por isso o único em que o alcance existe. 7 e
 * 30 dias param em ontem, como no Gerenciador: hoje ainda está acontecendo. O
 * mês atual vai até hoje e diz isso no rótulo, para não passar por mês inteiro.
 */
export function periodoMeta(periodo: PeriodoMeta, hoje: Date = new Date()): { from: string; to: string } {
  const [ano, mes, dia] = [hoje.getFullYear(), hoje.getMonth(), hoje.getDate()];
  const antes = (dias: number) => diaLocal(new Date(ano, mes, dia - dias));
  const recortes: Record<PeriodoMeta, () => { from: string; to: string }> = {
    ontem: () => ({ from: antes(1), to: antes(1) }),
    "7d": () => ({ from: antes(7), to: antes(1) }),
    "30d": () => ({ from: antes(30), to: antes(1) }),
    mes_atual: () => ({ from: monthStart(hoje), to: antes(0) }),
    mes_anterior: () => ({ from: diaLocal(new Date(ano, mes - 1, 1)), to: diaLocal(new Date(ano, mes, 0)) }),
  };
  return recortes[periodo]();
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
