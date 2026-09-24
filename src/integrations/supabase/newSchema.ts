import { differenceInDays, format, parseISO } from "date-fns";
import { supabase } from "./client";
import { getCurrentWorkDate, SAO_PAULO_UTC_OFFSET } from "./checkin";
import { bareStatus, isLossStatus, normalizeStatus } from "@/lib/dealStatus";
import { ccaStatusLabel } from "@/components/pipeline/ccaStage";
import { dbError } from "@/lib/supabaseError";
import type { Lead, LeadStatus, PipelineDeal } from "@/types/crm";
import type { Database } from "./types";

// Sem cast: os tipos gerados cobrem o schema novo. O `as any` daqui
// anulava justamente a regeneração que a Sprint 1 pagou para fazer.
const db = supabase;

export type NewAppRole =
  | "admin"
  | "director"
  | "manager"
  | "broker"
  | "cca"
  | "sdr"
  | "marketing"
  | "partner";

export type PersonRecord = {
  id: string;
  user_id: string;
  name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  active: boolean;
  status: string;
  roles: NewAppRole[];
  role: NewAppRole;
  team_id: string | null;
  team: string;
  manager_id: string | null;
  director_id: string | null;
};

export type LegacyDealRecord = PipelineDeal & {
  /** `developers.color` (0152): cor escolhida no cadastro da construtora, em
   *  `#RRGGBB`. `null` = sem cor escolhida. */
  developer_color: string | null;
  stage_id: string;
  /** `pipeline_stages.label` — o rótulo já vinha na consulta e ninguém lia (F11). */
  stage_label: string;
  stage_position: number;
  outcome: "open" | "won" | "lost" | "cancelled";
  /** `deals.status_detail` CRU — `null` quando ninguém escolheu Status 2.
   *  `status` (de `PipelineDeal`) já vem preenchido com o rótulo derivado do
   *  desfecho quando é nulo; sem guardar o cru, o gravador não tem como
   *  distinguir "o operador escolheu PROPOSTA" de "a tela deduziu PROPOSTA". */
  status_detail: string | null;
  /** Status 1 (`deal_status_groups.id`, 0149). O banco o deriva do Status 2;
   *  `null` = Status 2 fora do catálogo. */
  status_group_id: string | null;
  /** Motivo da perda gravado no banco. O gravador precisa dele para NÃO
   *  reescrevê-lo a cada salvamento do modal. */
  lost_reason: string | null;
  /** `deal_participants.share_pct` do corretor de cada slot (o rateio de VGV,
   *  que até aqui só existia no banco e em nenhuma tela). */
  broker1_share: number | null;
  broker2_share: number | null;
  broker3_share: number | null;
  director1_id: string | null;
  director2_id: string | null;
  broker1_name: string | null;
  broker2_name: string | null;
  manager1_name: string | null;
  manager2_name: string | null;
  director1_name: string | null;
  director2_name: string | null;
};

type QueryResult = { error: { message?: string } | null };

const throwIfError = (label: string, result: QueryResult) => {
  if (result.error) {
    throw dbError(label, result.error);
  }
};

const rolePriority: NewAppRole[] = [
  "admin",
  "director",
  "manager",
  "cca",
  "sdr",
  "marketing",
  "partner",
  "broker",
];

/**
 * Papel efetivo de quem tem vários (papel é N:N em `user_roles`).
 *
 * A ordem acima é a mesma da migration 0048: supervisor antes de corretor,
 * porque `handle_new_auth_user` (0002) concede `broker` a todo perfil novo e
 * nunca o retira — `roles.includes('broker')` responde "sim" para admin,
 * gerente e diretor, e por isso não serve para decidir quem ATENDE. Só devolve
 * `'broker'` para quem não carrega nenhum outro papel.
 */
export const primaryRole = (roles: NewAppRole[]): NewAppRole =>
  rolePriority.find((role) => roles.includes(role)) || "broker";

const isoMonthToDisplay = (value: string | null | undefined) => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[1]}` : value;
};

export const displayMonthToIso = (value: string) => {
  const match = /^(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[2]}-${match[1]}-01` : value;
};

export async function listPeople(): Promise<PersonRecord[]> {
  const [profilesRes, rolesRes, membersRes, teamsRes] = await Promise.all([
    db.from("profiles").select("id,full_name,email,phone,avatar_url,status"),
    db.from("user_roles").select("profile_id,role"),
    db.from("team_members").select("profile_id,team_id,left_at").is("left_at", null),
    db.from("teams").select("id,name,manager_id,director_id,active"),
  ]);

  throwIfError("profiles", profilesRes);
  throwIfError("user_roles", rolesRes);
  throwIfError("team_members", membersRes);
  throwIfError("teams", teamsRes);

  const rolesByProfile = new Map<string, NewAppRole[]>();
  for (const row of rolesRes.data || []) {
    const roles = rolesByProfile.get(row.profile_id) || [];
    roles.push(row.role as NewAppRole);
    rolesByProfile.set(row.profile_id, roles);
  }

  const memberByProfile = new Map(
    (membersRes.data || []).map((row) => [row.profile_id, row]),
  );
  const teamById = new Map((teamsRes.data || []).map((row) => [row.id, row]));

  return (profilesRes.data || [])
    .map((profile) => {
      const roles = rolesByProfile.get(profile.id) || ["broker"];
      const member = memberByProfile.get(profile.id);
      const team = member ? teamById.get(member.team_id) : null;
      return {
        id: profile.id,
        user_id: profile.id,
        name: profile.full_name,
        full_name: profile.full_name,
        email: profile.email,
        phone: profile.phone,
        avatar_url: profile.avatar_url,
        active: profile.status === "active",
        status: profile.status,
        roles,
        role: primaryRole(roles),
        team_id: team?.id || null,
        team: team?.name || "",
        manager_id: team?.manager_id || null,
        director_id: team?.director_id || null,
      } satisfies PersonRecord;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/** Nome e id de quem pode entrar no rateio — o mínimo que um Select precisa. */
export type SelectablePerson = { id: string; name: string };

/**
 * Corretores que podem entrar no rateio de um negócio (`selectable_brokers()`).
 *
 * `listPeople()` lê `profiles` pela RLS, e `auth_visible_profiles()` entrega ao
 * corretor **só o próprio perfil**: medido em 02/09/2026, 15 corretores puros
 * enxergavam 1 pessoa. O efeito era o corretor abrir "Corretor 2" e "Corretor
 * 3" com ele mesmo como única opção — ou seja, não conseguir montar o negócio
 * rateado que a ata de 14/07 descreve, embora o banco divida o VGV sozinho
 * assim que o segundo corretor entra.
 *
 * A RPC é `security definer` e devolve **só id e nome** de corretor ativo — o
 * mesmo padrão de `deal_participant_names()`, que já atravessa a RLS de
 * `profiles` para exibir participante fora da visibilidade de quem olha.
 *
 * `null` quando a função ainda não existe no banco (migration não aplicada):
 * quem chama cai para a lista visível de sempre, que é o comportamento de hoje.
 * Qualquer outro erro sobe — falha de rede não pode virar "não há corretores".
 */
export async function listSelectableBrokers(): Promise<SelectablePerson[] | null> {
  // Fronteira: a função nasce na migration 0076 e `types.ts` é gerado depois de
  // aplicá-la. Sem o cast o arquivo não compila até a regeneração — e o `rpc`
  // tipado não aceita nome fora do schema conhecido.
  const rpc = (db as unknown as {
    rpc: (fn: string) => PromiseLike<{
      data: { id: string; full_name: string }[] | null;
      error: { code?: string; message?: string } | null;
    }>;
  }).rpc;
  const { data, error } = await rpc("selectable_brokers");
  if (error) {
    // PGRST202 = função não encontrada no schema exposto; 42883 = não existe.
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw dbError("selectable_brokers", error);
  }
  return (data ?? []).map((row) => ({ id: row.id, name: row.full_name }));
}

export async function getCurrentProfile(userId: string) {
  const [profileRes, rolesRes] = await Promise.all([
    db
      .from("profiles")
      .select("id,full_name,email,phone,avatar_url,status")
      .eq("id", userId)
      .maybeSingle(),
    db.from("user_roles").select("role").eq("profile_id", userId),
  ]);
  if (profileRes.error) throw dbError("profiles", profileRes.error);
  if (rolesRes.error) throw dbError("user_roles", rolesRes.error);
  const roles = (rolesRes.data || []).map((row) => row.role as NewAppRole);
  return {
    profile: profileRes.data,
    roles,
    role: primaryRole(roles),
  };
}

/** `visits.result` (enum do banco) → o vocabulário do front (`PipelineDeal`). */
const VISIT_RESULT: Record<string, PipelineDeal["visit_result"]> = {
  scheduled: "pending",
  completed: "completed",
  no_show: "cancelled",
  cancelled: "cancelled",
};

export type VisitRow = { deal_id: string | null; scheduled_at: string; result: string };

/**
 * A visita que vale por negócio: a mais recente.
 *
 * Compara `scheduled_at` em vez de confiar na ordem da consulta — `order()` some
 * num refactor sem quebrar nada visível, e o indicador passaria a mostrar
 * silenciosamente uma visita antiga. `deal_id` nulo é visita de lead.
 */
export function latestVisitByDeal(rows: VisitRow[]) {
  const byDeal = new Map<string, { date: string; result: PipelineDeal["visit_result"] }>();
  for (const row of rows) {
    if (!row.deal_id) continue;
    const current = byDeal.get(row.deal_id);
    if (!current || Date.parse(row.scheduled_at) > Date.parse(current.date)) {
      byDeal.set(row.deal_id, { date: row.scheduled_at, result: VISIT_RESULT[row.result] });
    }
  }
  return byDeal;
}

/** `share_pct` do participante como número — a coluna é `numeric` e chega texto. */
const shareOf = (row?: { share_pct: number | string | null }): number | null =>
  row?.share_pct == null ? null : Number(row.share_pct);

const legacyStatus = (outcome: string, lostReason?: string | null) => {
  if (outcome === "won") return "VENDA";
  if (outcome === "lost") {
    return /distrato/i.test(lostReason || "") ? "DISTRATO" : "QUEDA";
  }
  return "PROPOSTA";
};

/** Teto de linhas que o PostgREST devolve por requisição (`max-rows`). */
const PAGE_SIZE = 1000;

/**
 * Consulta paginada até o fim — o PostgREST **trunca em silêncio**.
 *
 * `select("*")` sem `range` volta no máximo `max-rows` linhas (1000 no padrão
 * do Supabase) com status 200 e sem aviso nenhum: a lista aparece completa e
 * não é. O cabeçalho do Pipeline ("N negócio(s) ativo(s) · R$ X em VGV") e o
 * fechamento de mês passariam a descrever menos negócios do que existem, sem
 * ninguém ter como notar. Com 32 negócios e 100 participantes isso ainda não
 * acontece; o laço é o que garante que não vá acontecer.
 *
 * A ordem precisa ser estável entre as páginas — daí o desempate por `id` em
 * quem usa isto.
 *
 * A 1ª página pede `count` e as demais faixas saem JUNTAS. Uma de cada vez,
 * participantes e nomes eram cadeias de 21 idas e voltas e o Pipeline esperava
 * 21 × a latência. Se a última faixa ainda vier cheia (a tabela cresceu entre a
 * contagem e a leitura, ou a contagem não veio), o laço segue de uma em uma
 * como antes: "até o fim" continua garantido.
 */
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null; count?: number | null }>;

export async function allRows<T>(
  page: (from: number, to: number, count?: "exact") => Page<T>,
): Promise<{ data: T[]; error: { code?: string; message?: string } | null }> {
  let last = await page(0, PAGE_SIZE - 1, "exact");
  if (last.error) return { data: [], error: last.error };
  const rows: T[] = [...(last.data ?? [])];

  const starts: number[] = [];
  for (let from = PAGE_SIZE; from < (last.count ?? 0); from += PAGE_SIZE) starts.push(from);
  for (const result of await Promise.all(starts.map((from) => page(from, from + PAGE_SIZE - 1)))) {
    if (result.error) return { data: rows, error: result.error };
    rows.push(...(result.data ?? []));
    last = result;
  }

  for (let from = PAGE_SIZE * (starts.length + 1); (last.data?.length ?? 0) === PAGE_SIZE; from += PAGE_SIZE) {
    last = await page(from, from + PAGE_SIZE - 1);
    if (last.error) return { data: rows, error: last.error };
    rows.push(...(last.data ?? []));
  }
  return { data: rows, error: null };
}

type PageFn<T> = (from: number, to: number, count?: "exact") => Page<T>;
type DealRow = Database["public"]["Tables"]["deals"]["Row"];

/** Ids por requisição no `in.(…)`: 100 uuids dão ~4 kB de URL, abaixo do teto do gateway. */
const IDS_POR_REQUISICAO = 100;

/** `allRows` de cada lote de ids, em paralelo, numa lista só. */
async function porLotes<T>(ids: string[], page: (lote: string[]) => PageFn<T>) {
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_REQUISICAO) lotes.push(ids.slice(i, i + IDS_POR_REQUISICAO));
  const results = await Promise.all(lotes.map((lote) => allRows(page(lote))));
  return {
    data: results.flatMap((result) => result.data),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

const DIA_MS = 86_400_000;

const somarDias = (dia: string, dias: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);

const diaValido = (dia: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const instante = Date.parse(`${dia}T00:00:00Z`);
  // "2026-02-30" passa na regex; a volta pelo `Date` mostra que o dia não existe.
  return !Number.isNaN(instante) && new Date(instante).toISOString().startsWith(dia);
};

/**
 * Período padrão do Pipeline e da CCA: de hoje-30 até hoje, com "hoje" contado
 * em São Paulo. Pelo relógio UTC, às 21h de Brasília o período já andaria um dia.
 */
export function last30DaysRange(now: Date = new Date()): { from: string; to: string } {
  const hoje = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  return { from: somarDias(hoje, -30), to: hoje };
}

/**
 * Limites de `created_at` para o banco. `from` vale da meia-noite de São Paulo;
 * `to` é inclusivo, então vira "antes da meia-noite do dia seguinte". Vazio =
 * sem limite daquele lado (campo de data limpo). Data inválida é recusada: se
 * fosse ignorada, a tela baixaria a base inteira sem ninguém pedir.
 */
export function createdAtBounds(from?: string, to?: string): { gte?: string; lt?: string } {
  if ((from && !diaValido(from)) || (to && !diaValido(to))) {
    throw dbError("deals", { code: "P0001", message: "Escolha uma data válida no período." });
  }
  return {
    gte: from ? `${from}T00:00:00${SAO_PAULO_UTC_OFFSET}` : undefined,
    lt: to ? `${somarDias(to, 1)}T00:00:00${SAO_PAULO_UTC_OFFSET}` : undefined,
  };
}

/** Mais recente primeiro; empate pelo id, a mesma ordem do `order` do banco. */
export const newestFirst = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export type LegacyDealsOptions = {
  /** AAAA-MM-DD (dia de São Paulo). Filtra `deals.created_at` no banco. */
  createdFrom?: string;
  /** AAAA-MM-DD, inclusivo até o fim do dia. */
  createdTo?: string;
  /** Só estes negócios. */
  ids?: string[];
};

/**
 * Negócios na forma legada, do mais recente para o mais antigo.
 *
 * Sem `opts`, a base inteira (Dashboard, Resultados). Com período ou ids, o
 * filtro vai no banco, e clientes, participantes, nomes e visitas saem só dos
 * negócios encontrados: o Pipeline abria baixando os 7.579 negócios e ~20 mil
 * participantes para mostrar os ~190 dos últimos 30 dias.
 */
export async function listLegacyDeals(
  signal?: AbortSignal,
  opts: LegacyDealsOptions = {},
): Promise<LegacyDealRecord[]> {
  // O `signal` do React Query chega até a rede: sem ele, uma recarga cancelada
  // (evento realtime, `invalidateDeals`) continuava baixando as dezenas de
  // páginas enquanto a próxima já começava.
  const sinal = signal ?? new AbortController().signal;
  const faixa = createdAtBounds(opts.createdFrom, opts.createdTo);
  const recorte = opts.ids !== undefined || Boolean(faixa.gte || faixa.lt);

  const negocios = (lote: string[] | null): PageFn<DealRow> => (from, to, count) => {
    let query = db.from("deals").select("*", { count });
    if (lote) query = query.in("id", lote);
    if (faixa.gte) query = query.gte("created_at", faixa.gte);
    if (faixa.lt) query = query.lt("created_at", faixa.lt);
    return query.order("created_at", { ascending: false }).order("id").range(from, to).abortSignal(sinal);
  };

  // Com recorte os negócios vêm primeiro e o resto só para os ids deles; sem
  // recorte tudo sai junto, como sempre.
  const recortados = !recorte ? null
    : opts.ids ? await porLotes(opts.ids, negocios) : await allRows(negocios(null));
  if (recortados) throwIfError("deals", recortados);
  const alvo = recortados ? recortados.data.map((deal) => deal.id) : null;
  if (alvo?.length === 0) return [];
  /** Tabela filha do negócio: inteira, ou só os ids do recorte, em lotes. */
  const filhos = <T>(page: (lote: string[] | null) => PageFn<T>) =>
    alvo ? porLotes(alvo, page) : allRows(page(null));

  const [
    dealsRes,
    stagesRes,
    developersRes,
    projectsRes,
    clientsRes,
    participantsRes,
    participantNamesRes,
    visitsRes,
  ] = await Promise.all([
    recortados ?? allRows(negocios(null)),
    db.from("pipeline_stages").select("id,code,label,position").abortSignal(sinal),
    // Só as três colunas que a tela usa. O `*` da rodada anterior existia para
    // o front não quebrar num banco sem a 0152; com ela aplicada (17/09/2026),
    // pedir tudo mandava e-mail de envio, telefone e observações de TODAS as
    // construtoras para o navegador de qualquer corretor, sem uso na tela.
    db.from("developers").select("id,name,color").abortSignal(sinal),
    db.from("developer_projects").select("id,name").abortSignal(sinal),
    filhos((lote) => (from, to, count) => {
      const query = db.from("deal_clients").select("*", { count });
      return (lote ? query.in("deal_id", lote) : query).order("id").range(from, to).abortSignal(sinal);
    }),
    filhos((lote) => (from, to, count) => {
      const query = db.from("deal_participants").select("*", { count });
      return (lote ? query.in("deal_id", lote) : query)
        .order("ordinal").order("created_at").order("id").range(from, to).abortSignal(sinal);
    }),
    // `undefined as never`: a função não tem argumento (`Args: never` nos tipos
    // gerados) e o `count` só entra pelo 3º parâmetro; em runtime o `rpc` troca
    // `undefined` pelo `{}` padrão, a mesma chamada de antes. Ela devolve
    // `deal_id`, então o recorte filtra o resultado dela no banco.
    filhos((lote) => (from, to, count) => {
      const query = db.rpc("deal_participant_names", undefined as never, { count });
      return (lote ? query.in("deal_id", lote) : query).range(from, to).abortSignal(sinal);
    }),
    // `visits` entra aqui porque `deals` não tem mais coluna de visita: o schema
    // novo guarda o agendamento na própria tabela. Sem esta consulta,
    // `visit_date` nascia `undefined` para todo negócio e o indicador de visita
    // da tabela e do cartão ficava apagado mesmo depois de agendar.
    filhos((lote) => (from, to, count) => {
      const query = db.from("visits").select("deal_id,scheduled_at,result", { count }).not("deal_id", "is", null);
      return (lote ? query.in("deal_id", lote) : query).order("id").range(from, to).abortSignal(sinal);
    }),
  ]);

  throwIfError("deals", dealsRes);
  // Os lotes de ids chegam cada um na sua ordem; o período já vem ordenado.
  if (opts.ids) dealsRes.data.sort(newestFirst);
  throwIfError("pipeline_stages", stagesRes);
  throwIfError("developers", developersRes);
  throwIfError("developer_projects", projectsRes);
  throwIfError("deal_clients", clientsRes);
  throwIfError("deal_participants", participantsRes);
  throwIfError("deal_participant_names", participantNamesRes);
  throwIfError("visits", visitsRes);

  const stageById = new Map((stagesRes.data || []).map((row) => [row.id, row]));
  const developerById = new Map(
    (developersRes.data || []).map((row) => [row.id, row]),
  );
  const projectById = new Map(
    (projectsRes.data || []).map((row) => [row.id, row.name]),
  );
  const profileById = new Map(
    (participantNamesRes.data || []).map((row) => [row.profile_id, row.full_name]),
  );

  const clientsByDeal = new Map<string, Database["public"]["Tables"]["deal_clients"]["Row"][]>();
  for (const row of clientsRes.data || []) {
    const rows = clientsByDeal.get(row.deal_id) || [];
    rows.push(row);
    clientsByDeal.set(row.deal_id, rows);
  }

  const participantsByDeal = new Map<string, Database["public"]["Tables"]["deal_participants"]["Row"][]>();
  for (const row of participantsRes.data || []) {
    const rows = participantsByDeal.get(row.deal_id) || [];
    rows.push(row);
    participantsByDeal.set(row.deal_id, rows);
  }

  const visitByDeal = latestVisitByDeal(visitsRes.data || []);

  return (dealsRes.data || []).map((deal) => {
    const stage = stageById.get(deal.stage_id);
    const clients = (clientsByDeal.get(deal.id) || []).sort(
      (a, b) => a.ordinal - b.ordinal,
    );
    const primary = clients.find((row) => row.ordinal === 1);
    const secondary = clients.find((row) => row.ordinal === 2);
    const participants = participantsByDeal.get(deal.id) || [];
    const brokers = participants.filter((row) => row.role === "broker");
    const managers = participants.filter((row) => row.role === "manager");
    const directors = participants.filter((row) => row.role === "director");
    const createdAt = deal.created_at || new Date().toISOString();
    const visit = visitByDeal.get(deal.id);

    return {
      id: deal.id,
      code: deal.code,
      client: primary?.full_name || "Cliente não informado",
      cpf: primary?.cpf || undefined,
      contato: primary?.phone || undefined,
      email_client: primary?.email || undefined,
      numero_pis: primary?.pis || undefined,
      estado_civil: primary?.marital_status || undefined,
      naturalidade: primary?.birthplace || undefined,
      cotista:
        primary?.is_shareholder == null
          ? undefined
          : primary.is_shareholder
            ? "Sim"
            : "Não",
      dependente: primary?.dependents || undefined,
      data_admissao: primary?.admission_date || undefined,
      referencia_cch: primary?.cch_reference || undefined,
      cep: primary?.postal_code || undefined,
      has_second_client: Boolean(secondary),
      client2: secondary?.full_name || undefined,
      cpf2: secondary?.cpf || undefined,
      contato2: secondary?.phone || undefined,
      email_client2: secondary?.email || undefined,
      numero_pis2: secondary?.pis || undefined,
      estado_civil2: secondary?.marital_status || undefined,
      naturalidade2: secondary?.birthplace || undefined,
      cotista2:
        secondary?.is_shareholder == null
          ? undefined
          : secondary.is_shareholder
            ? "Sim"
            : "Não",
      dependente2: secondary?.dependents || undefined,
      data_admissao2: secondary?.admission_date || undefined,
      referencia_cch2: secondary?.cch_reference || undefined,
      cep2: secondary?.postal_code || undefined,
      has_informal_income: primary?.has_informal_income || false,
      segmento_atividade: primary?.activity_segment || undefined,
      forma_atuacao: primary?.activity_form || undefined,
      tempo_atividade: primary?.activity_duration || undefined,
      forma_divulgacao: primary?.disclosure_form || undefined,
      declara_ir:
        primary?.declares_income_tax == null
          ? undefined
          : primary.declares_income_tax
            ? "Sim"
            : "Não",
      rendimento_mensal:
        primary?.monthly_income == null
          ? undefined
          : String(primary.monthly_income),
      observacoes_renda: primary?.income_notes || undefined,
      developer: developerById.get(deal.developer_id)?.name || "",
      developer_color: developerById.get(deal.developer_id)?.color ?? null,
      developer_id: deal.developer_id,
      project: projectById.get(deal.project_id) || "",
      project_id: deal.project_id,
      unit: deal.unit || "",
      status: deal.status_detail || legacyStatus(deal.outcome, deal.lost_reason),
      status_detail: deal.status_detail,
      status_group_id: deal.status_group_id,
      lost_reason: deal.lost_reason,
      stage: (stage?.code || "incomplete") as PipelineDeal["stage"],
      stage_id: deal.stage_id,
      // Rótulo do catálogo. Sem ele a tabela caía num mapa próprio que divergia
      // do banco e, para `lost`, escrevia "PROPOSTA" num negócio perdido (F09/F11).
      stage_label: stage?.label || "Sem etapa",
      stage_position: stage?.position ?? 0,
      outcome: deal.outcome,
      lead_origin: deal.lead_origin || undefined,
      month_base: isoMonthToDisplay(deal.month_base) || undefined,
      visit_date: visit?.date,
      visit_result: visit?.result,
      broker1: profileById.get(brokers[0]?.profile_id) || "",
      broker2: profileById.get(brokers[1]?.profile_id) || undefined,
      broker3: profileById.get(brokers[2]?.profile_id) || undefined,
      manager1: profileById.get(managers[0]?.profile_id) || "",
      manager2: profileById.get(managers[1]?.profile_id) || undefined,
      manager3: profileById.get(managers[2]?.profile_id) || undefined,
      broker1_share: shareOf(brokers[0]),
      broker2_share: shareOf(brokers[1]),
      broker3_share: shareOf(brokers[2]),
      broker1_id: brokers[0]?.profile_id || null,
      broker2_id: brokers[1]?.profile_id || null,
      broker3_id: brokers[2]?.profile_id || null,
      manager1_id: managers[0]?.profile_id || null,
      manager2_id: managers[1]?.profile_id || null,
      manager3_id: managers[2]?.profile_id || null,
      director1_id: directors[0]?.profile_id || null,
      director2_id: directors[1]?.profile_id || null,
      broker1_name: profileById.get(brokers[0]?.profile_id) || null,
      broker2_name: profileById.get(brokers[1]?.profile_id) || null,
      manager1_name: profileById.get(managers[0]?.profile_id) || null,
      manager2_name: profileById.get(managers[1]?.profile_id) || null,
      director1_name: profileById.get(directors[0]?.profile_id) || null,
      director2_name: profileById.get(directors[1]?.profile_id) || null,
      vgv_bruto: Number(deal.vgv_gross || 0),
      perc_desconto: String(deal.discount_pct || 0),
      vgv_liquido: Number(deal.vgv_net || 0),
      deal_value: Number(deal.vgv_net || 0),
      days_in_pipeline: differenceInDays(new Date(), parseISO(createdAt)),
      active: !["lost", "cancelled"].includes(deal.outcome),
      created_at: createdAt,
      notes: deal.notes || undefined,
      document_review_status: deal.document_review_status as PipelineDeal["document_review_status"],
      document_review_requested_at: deal.document_review_requested_at || undefined,
      document_review_reason: deal.document_review_reason || undefined,
      history: [],
    } satisfies LegacyDealRecord;
  });
}

const legacyLeadStatus = (
  lead: Pick<Database["public"]["Tables"]["leads"]["Row"], "status" | "funnel_stage">,
): LeadStatus => {
  if (lead.status === "converted") return "converted";
  if (lead.status === "lost" || lead.status === "discarded") return "lost";
  if (lead.funnel_stage === "qualified") return "qualified";
  if (lead.status === "attending" || lead.status === "in_progress") {
    return "contacted";
  }
  return "new";
};

export async function listLegacyLeads(): Promise<Lead[]> {
  const [leadsRes, sourcesRes, profilesRes] = await Promise.all([
    // `.order("id")` desempata: com `created_at` igual (importação em lote, rajada
    // do webhook da Meta) o Postgres pode devolver as linhas em ordem diferente a
    // cada consulta, e a tela trocava de posição sozinha. Mesmo par de `listLegacyDeals`.
    //
    // Só as colunas que o mapeamento abaixo lê: `select("*")` trazia as 40
    // colunas da tabela (~1,2 kB por linha, medido na homologação) para usar 11.
    //
    // ponytail: sem `range`, a lista para no `max-rows` do PostgREST (1.000
    // linhas) — com 102.799 leads o Dashboard conta só os 1.000 mais recentes.
    // Paginar até o fim seriam ~100 páginas com OFFSET sob RLS a cada abertura;
    // evoluir para contagem agrupada no banco (por mês, origem, situação e
    // corretor) quando o Dashboard tiver essa RPC. O total da base já é exato
    // em `loadDashboardPayload`.
    db.from("leads")
      .select("id,full_name,phone,email,source_id,utm_source,assigned_to,created_at,status,funnel_stage,notes")
      .order("created_at", { ascending: false }).order("id"),
    db.from("lead_sources").select("id,label"),
    db.from("profiles").select("id,full_name"),
  ]);
  throwIfError("leads", leadsRes);
  throwIfError("lead_sources", sourcesRes);
  throwIfError("profiles", profilesRes);

  const sourceById = new Map(
    (sourcesRes.data || []).map((row) => [row.id, row.label]),
  );
  const profileById = new Map(
    (profilesRes.data || []).map((row) => [row.id, row.full_name]),
  );

  return (leadsRes.data || []).map((lead) => ({
    id: lead.id,
    name: lead.full_name,
    phone: lead.phone || "",
    whatsapp: lead.phone || "",
    email: lead.email || "",
    source: sourceById.get(lead.source_id) || lead.utm_source || "",
    broker_id: lead.assigned_to || "",
    broker_name: profileById.get(lead.assigned_to) || undefined,
    created_at: lead.created_at,
    status: legacyLeadStatus(lead),
    notes: lead.notes || "",
  }));
}

export type DashboardPayload = {
  deals: LegacyDealRecord[];
  people: PersonRecord[];
  /** Total de leads que a RLS deixa ver — contagem exata, sem baixar a lista. */
  leadsCount: number;
  ccaCounts: Record<string, number>;
  staff: {
    brokersTotal: number;
    active: number;
    managers: number;
    directors: number;
  };
  closedMonths: string[];
};

export async function loadDashboardPayload(
  loadDeals: () => Promise<LegacyDealRecord[]> = () => listLegacyDeals(),
): Promise<DashboardPayload> {
  const [deals, leadsRes, people, ccaRes, closedRes] = await Promise.all([
    loadDeals(),
    // Só a contagem. A lista inteira vinha aqui E de novo em `useDashboardLeads`
    // na mesma abertura, e o total dela parava nas 1.000 linhas do `max-rows`.
    db.from("leads").select("id", { count: "exact", head: true }),
    listPeople(),
    // Paginado: sem `range`, a esteira do Dashboard somava só 1.000 dos 7.560 casos.
    allRows((from, to, count) => db.from("cca_cases").select("status", { count })
      .order("id").range(from, to)),
    db.from("closed_months").select("period"),
  ]);
  if (leadsRes.error) throw dbError("leads", leadsRes.error);
  if (ccaRes.error) throw dbError("cca_cases", ccaRes.error);
  if (closedRes.error) throw dbError("closed_months", closedRes.error);

  const ccaCounts: Record<string, number> = {};
  for (const row of ccaRes.data) {
    const label = ccaStatusLabel(row.status);
    ccaCounts[label] = (ccaCounts[label] || 0) + 1;
  }

  return {
    deals,
    people,
    leadsCount: leadsRes.count ?? 0,
    ccaCounts,
    staff: {
      brokersTotal: people.filter((person) => person.roles.includes("broker")).length,
      active: people.filter((person) => person.active).length,
      managers: people.filter((person) => person.roles.includes("manager")).length,
      directors: people.filter((person) => person.roles.includes("director")).length,
    },
    closedMonths: (closedRes.data || [])
      .map((row) => isoMonthToDisplay(row.period))
      .filter(Boolean) as string[],
  };
}

/**
 * Meta global do mês em `goals` (scope 'global', period_type 'month').
 * `metric` segue o vocabulário do check da tabela: 'sales' para contagem de
 * vendas, 'vgv' para valor — o mesmo usado por Equipes.tsx no scope 'profile'.
 * Devolve null quando não há meta cadastrada: a tela mostra "—", não inventa.
 */
export async function getGlobalMonthlyGoal(
  metric: "sales" | "vgv",
  periodIso: string,
): Promise<number | null> {
  const { data, error } = await db
    .from("goals")
    .select("target")
    .eq("scope", "global")
    .eq("period_type", "month")
    .eq("period", periodIso)
    .eq("metric", metric)
    .maybeSingle();
  if (error) throw dbError("goals", error);
  return data ? Number(data.target) : null;
}

export type MonthlyGoalRow = {
  scope: "global" | "team" | "profile";
  team_id: string | null;
  profile_id: string | null;
  target: number;
};

/**
 * Metas do mês que o usuário enxerga, mais as equipes que ele lidera.
 *
 * O card de meta do Dashboard compara o realizado do usuário com o alvo do
 * MESMO escopo — o numerador já sai recortado por `auth_visible_profiles()`,
 * então perguntar só pela meta 'global' punha a meta da empresa inteira embaixo
 * das vendas de um corretor. A `goals_select` já devolve as três (a do próprio
 * perfil, a das equipes visíveis e a global); quem escolhe a linha é
 * `pickSalesGoal`, no front.
 *
 * As equipes lideradas vêm daqui porque a RLS também deixa o MEMBRO ler a meta
 * da equipe, e meta de equipe só serve de denominador para quem lidera — o
 * corretor continua no próprio perfil. É o mesmo critério de
 * `auth_led_team_ids()`: equipe ativa com o usuário como gerente ou diretor.
 */
export async function loadMonthlyGoals(
  metric: "sales" | "vgv",
  periodIso: string,
  profileId: string,
): Promise<{ rows: MonthlyGoalRow[]; ledTeamIds: string[] }> {
  const [goalsRes, teamsRes] = await Promise.all([
    db
      .from("goals")
      .select("scope,team_id,profile_id,target")
      .eq("period_type", "month")
      .eq("period", periodIso)
      .eq("metric", metric),
    db.from("teams").select("id,manager_id,director_id").eq("active", true),
  ]);
  if (goalsRes.error) throw dbError("goals", goalsRes.error);
  if (teamsRes.error) throw dbError("teams", teamsRes.error);

  return {
    rows: (goalsRes.data ?? []).map((row) => ({
      scope: row.scope as MonthlyGoalRow["scope"],
      team_id: row.team_id,
      profile_id: row.profile_id,
      target: Number(row.target),
    })),
    ledTeamIds: (teamsRes.data ?? [])
      .filter((team) => team.manager_id === profileId || team.director_id === profileId)
      .map((team) => team.id),
  };
}

/**
 * `YYYY-MM` do `<input type="month">` → primeiro dia do mês, que é como
 * `goals.period` guarda. Devolve null para valor fora do formato (campo limpo,
 * mês 13): quem chama desliga a consulta em vez de mandar data inválida ao banco.
 */
export const monthInputToPeriodIso = (month: string): string | null =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : null;

/**
 * Valida a meta antes de gravar. Devolve a frase do erro em pt-BR ou `null`
 * quando o valor serve.
 *
 * A meta é o DENOMINADOR de todos os cartões do mês: um erro de digitação aqui
 * não erra um número, erra o painel inteiro. O banco sozinho não segura isso —
 * `goals.target` é `numeric(14,2) check (target >= 0)`, ou seja, aceita zero e
 * só recusa acima de ~1e12.
 *
 * Zero é recusado de propósito: o `GoalCard` do Dashboard lê `target <= 0` como
 * "sem meta cadastrada", então salvar 0 mostrava o toast "Meta global salva" e
 * o painel continuava dizendo que não havia meta — a gravação que promete e
 * nega. Os tetos são folgados para a operação; existem para pegar zero a mais
 * na digitação, não para apertar a meta.
 */
export function validateGoalTarget(metric: "sales" | "vgv", target: number): string | null {
  // Number.isFinite recusa NaN e Infinity de uma vez — é o que sobra de
  // `Number("abc")` e de `Number("1e999")` vindos de um campo de texto.
  if (!Number.isFinite(target)) return "Informe um número para a meta.";
  if (target <= 0) return "A meta precisa ser maior que zero.";
  if (metric === "sales" && !Number.isInteger(target)) {
    return "A meta de vendas é uma quantidade inteira.";
  }
  if (metric === "sales" && target > 100_000) {
    return "A meta de vendas não pode passar de 100.000 no mês.";
  }
  if (metric === "vgv" && target > 1_000_000_000) {
    return "A meta de VGV não pode passar de R$ 1 bilhão no mês.";
  }
  return null;
}

/**
 * Grava (ou atualiza) a meta global do mês. `goals_global_idx` é índice parcial
 * (`where scope = 'global'`) e o upsert do PostgREST não repassa o predicado ao
 * ON CONFLICT, então o Postgres não consegue inferir o índice — por isso
 * select + insert/update, o mesmo caminho do GoalRow de Equipes.
 */
export async function upsertGlobalMonthlyGoal(
  metric: "sales" | "vgv",
  periodIso: string,
  target: number,
): Promise<void> {
  // Fronteira de escrita: toda tela que grava a meta global passa por aqui (o
  // cartão de /equipes e o mesmo formulário aberto no diálogo do Dashboard),
  // então a validação mora neste ponto e não em cada formulário.
  const invalido = validateGoalTarget(metric, target);
  if (invalido) throw dbError("goals", { code: "P0001", message: invalido });
  // `describeError` só repassa a mensagem crua dos códigos das nossas próprias
  // exceções (P0001/P0002); é por isso que o código acima não é inventado.
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(periodIso)) {
    throw dbError("goals", { code: "P0001", message: "Escolha um mês válido para a meta." });
  }

  const existing = await db
    .from("goals")
    .select("id")
    .eq("scope", "global")
    .eq("period_type", "month")
    .eq("period", periodIso)
    .eq("metric", metric)
    .maybeSingle();
  if (existing.error) throw dbError("goals", existing.error);
  const result = existing.data
    ? await db.from("goals").update({ target }).eq("id", existing.data.id).select("id")
    : await db
        .from("goals")
        .insert({ scope: "global", period_type: "month", period: periodIso, metric, target })
        .select("id");
  if (result.error) throw dbError("goals", result.error);
  // Update que não casa linha nenhuma volta 204 sem erro (a `goals_write` só
  // aceita admin e diretor). Sem esta conferência quem perdeu o papel no meio da
  // sessão via o toast "Meta global salva" e o cartão recarregava o valor antigo.
  // É a mesma verificação do GoalRow de Equipes.
  if (!result.data?.length) {
    // Frase inteira, e não fragmento: desde a correção de `describeError` a
    // mensagem de um 42501 nosso vai INTEIRA para o toast, em vez de ser
    // achatada em "Você não tem permissão para esta ação.".
    throw dbError("goals", {
      code: "42501",
      message: "Seu perfil não pode gravar a meta deste mês.",
    });
  }
}

export async function getStageIdByCode(code: string): Promise<string> {
  const { data, error } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("code", code)
    .single();
  if (error) throw dbError("pipeline_stages", error);
  return data.id;
}

export async function listOpenCheckins() {
  const workDate = await getCurrentWorkDate();
  const [checkinsRes, profilesRes] = await Promise.all([
    db
      .from("checkins")
      .select("id,profile_id,checked_in_at,checked_out_at")
      .eq("work_date", workDate)
      .is("checked_out_at", null),
    db.from("profiles").select("id,full_name"),
  ]);
  throwIfError("checkins", checkinsRes);
  throwIfError("profiles", profilesRes);
  const names = new Map(
    (profilesRes.data || []).map((row) => [row.id, row.full_name]),
  );
  return (checkinsRes.data || []).map((row) => ({
    id: row.id,
    broker_id: row.profile_id,
    name: names.get(row.profile_id) || "—",
    checkedInAt: new Date(row.checked_in_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistência completa do negócio na forma legada.
//
// Era o buraco central da auditoria de 08/08: o DealDetailModal — único caminho
// de edição de negócio — não gravava nada, e o formulário "Novo Deal" gravava
// só uma parte (sem gerentes, sem os dados do cliente além do nome, sem o
// Status 2). Esta função é a fonte única: recebe a forma legada que as telas
// já usam e grava deals + deal_clients + deal_participants.
// ─────────────────────────────────────────────────────────────────────────────

const simNao = (v?: string | null): boolean | null => {
  if (!v) return null;
  const u = v.trim().toUpperCase();
  if (u === "SIM") return true;
  if (u === "NÃO" || u === "NAO") return false;
  return null;
};

const toIsoDate = (v?: string | null): string | null => {
  if (!v) return null;
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
};

/**
 * Número vindo de campo de texto.
 *
 * A vírgula é o que marca o formato brasileiro ("1.234,56"). Sem essa
 * distinção, o `replace(/\./g, "")` incondicional lia "10.5" — o que um
 * `input[type=number]` produz — como **105**: o percentual de desconto era
 * gravado dez vezes maior, e o VGV líquido saía dessa conta.
 */
export const toNumberOrNull = (v?: string | number | null): number | null => {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};

const clientRow = (form: SaveLegacyDealInput, ordinal: 1 | 2) => {
  const s = ordinal === 2 ? "2" : "";
  const g = (key: string) => (form as Record<string, unknown>)[`${key}${s}`] as string | undefined;
  return {
    ordinal,
    full_name: (ordinal === 1 ? form.client : form.client2) || "Cliente não informado",
    cpf: g("cpf") || null,
    phone: g("contato") || null,
    email: g("email_client") || null,
    pis: g("numero_pis") || null,
    marital_status: g("estado_civil") || null,
    birthplace: g("naturalidade") || null,
    is_shareholder: simNao(g("cotista")),
    dependents: g("dependente") || null,
    admission_date: toIsoDate(g("data_admissao")),
    cch_reference: g("referencia_cch") || null,
    postal_code: g("cep") || null,
    ...(ordinal === 1
      ? {
          has_informal_income: Boolean(form.has_informal_income),
          activity_segment: form.segmento_atividade || null,
          activity_form: form.forma_atuacao || null,
          activity_duration: form.tempo_atividade || null,
          disclosure_form: form.forma_divulgacao || null,
          declares_income_tax: simNao(form.declara_ir),
          monthly_income: toNumberOrNull(form.rendimento_mensal),
          income_notes: form.observacoes_renda || null,
        }
      : {}),
  };
};

export type SaveLegacyDealInput =
  Omit<PipelineDeal, "id" | "days_in_pipeline"> & Partial<LegacyDealRecord>;

/**
 * Etapa que o Status 2 escolhido no modal força.
 *
 * `isLossStatus`, e não três constantes soltas: é a MESMA lista que o diálogo
 * de perda e o Select da tabela usam. Enquanto eram duas regras, "19. REPROVADO"
 * encerrava o negócio pela tabela e não encerrava nada pelo modal — com o aviso
 * vermelho do formulário prometendo o encerramento que o gravador não fazia.
 */
export const dealStageCodeFor = (
  form: Pick<SaveLegacyDealInput, "status" | "stage"> & { status_detail?: string | null },
): string =>
  normalizeStatus(form.status) === "VENDA"
    ? "closed"
    : choosesLoss(form)
      ? "lost"
      : form.stage || "incomplete";

/**
 * O Status 2 do formulário encerra o negócio — e foi ESCOLHIDO agora.
 *
 * A segunda metade existe desde a 0150: a coluna REPROVADO da CCA grava
 * "19. REPROVADO" num negócio que continua aberto. Lendo só o texto, qualquer
 * salvamento do modal (mudar o telefone, preencher a aba CCA) mandava esse
 * negócio para Perdido e gravava o motivo, sem a confirmação do diálogo de
 * perda. O valor que já está gravado não encerra nada; encerrar é trocar o
 * Status 2 aqui ou usar o `LoseDealDialog`.
 */
export const choosesLoss = (
  form: Pick<SaveLegacyDealInput, "status"> & { status_detail?: string | null },
): boolean => isLossStatus(form.status) && form.status !== form.status_detail;

/**
 * Etapas que o banco só libera com a conferência documental aprovada.
 *
 * **Fonte única do front.** A mesma lista de `deal_stage_document_block`
 * (migration 0111), que o gatilho chama nos dois momentos: no UPDATE com o id
 * do negócio (movimentação) e no INSERT com nulo (nascimento). Ela vivia
 * copiada em `guards.ts` e, aqui, encolhida para só `closed` — duas cópias que
 * já discordavam entre si e da terceira, que é o banco.
 *
 * A quarta casa, `closed`, tem uma trava a mais no nascimento: a 0111 §1.b
 * recusa nascer com `outcome = 'won'` para TODO MUNDO, administrador incluído
 * (registrar venda passa pelo funil). As outras três a 0111 §1.c só cobra de
 * quem não é administrador — `saleBlockedReason` faz essa distinção.
 */
export const STAGES_REQUIRING_REVIEW: readonly string[] = [
  "under_analysis", "approved", "contract", "closed",
];

/** Quem move um negócio para "Fechado" — a matriz de etapas (0101), que fora do
 *  admin e do sócio ninguém tem por padrão. */
const VENDA_SEM_PERMISSAO =
  "Registrar venda é do administrador: só ele e o sócio movem um negócio para "
  + "\"Fechado\". Escolha outro Status 2 e peça o fechamento a um administrador.";

/** A conferência do gerente, que a 0028 exige para ENTRAR em "Fechado" e a 0110
 *  passou a exigir também para NASCER lá. Vale para todo mundo, admin incluído. */
const VENDA_SEM_CONFERENCIA =
  "Registrar venda exige a documentação aprovada pelo gerente. Envie o dossiê "
  + "para a conferência e feche o negócio depois da aprovação.";

/** A faixa do CCA no NASCIMENTO (0111 §1.c): a matriz dá a casa de "Em análise"
 *  a gerente, diretor e CCA porque eles MOVEM o negócio para lá quando aprovam
 *  a conferência — criar já lá é pular o passo do gerente. */
const CRIACAO_SEM_CONFERENCIA =
  "Negócio novo começa no funil: a etapa de análise vem depois da conferência "
  + "do gerente. Crie o negócio em uma etapa aberta e envie o dossiê para ele.";

/**
 * Motivo, em pt-BR, para a ETAPA DE DESTINO recusar este salvamento — ou `null`
 * quando ele passa.
 *
 * Existe porque "VENDA" não é só um rótulo: `dealStageCodeFor` o traduz em
 * etapa "Fechado", e a etapa tem dois donos que o formulário não mostrava —
 * a matriz de etapas e a conferência documental. Sem esta conta, corretor e
 * gerente preenchiam ~40 campos para receber um 42501 do gatilho no fim.
 *
 * **Também cobre a CRIAÇÃO**, e é por isso que ela deixou de ser só sobre
 * "VENDA": a matriz de etapas diz que gerente, diretor e CCA podem ENTRAR em
 * "Em análise" (e o CCA, em "Aprovado" e "Contrato"), então o Select oferecia
 * essas casas num negócio novo — e a 0111 §1.c recusava o INSERT com P0001 no
 * fim do mesmo formulário de ~40 campos. As duas fontes estão certas: a matriz
 * descreve quem MOVE, o gatilho descreve quem NASCE. O que faltava era a tela
 * distinguir as duas coisas, e é o `form.id` que as separa — a mesma fronteira
 * de `dealRequiredError` e `findDuplicateDeal` (pipeline/guards.ts).
 *
 * Editar um negócio que JÁ está numa dessas etapas não passa por aqui: quem
 * cobra a movimentação é `blockedMoveReason` (pipeline/guards.ts), e regravar a
 * MESMA etapa não é escrita para o gatilho (ele só cobra quando
 * `new.stage_id is distinct from old.stage_id`).
 */
export const saleBlockedReason = (
  form: Pick<SaveLegacyDealInput, "id" | "status" | "stage" | "stage_id" | "document_review_status">,
  stages: { id: string; code: string }[],
  canEnterStage: (stageId: string) => boolean,
  opts: { isAdmin?: boolean } = {},
): string | null => {
  const code = dealStageCodeFor(form);
  if (!STAGES_REQUIRING_REVIEW.includes(code)) return null;
  const destino = stages.find((stage) => stage.code === code);
  // Sem o catálogo carregado a tela não afirma nada: quem recusa é o banco.
  if (!destino || destino.id === form.stage_id) return null;
  const conferida = form.document_review_status === "approved";
  if (code === "closed") {
    if (!canEnterStage(destino.id)) return VENDA_SEM_PERMISSAO;
    return conferida ? null : VENDA_SEM_CONFERENCIA;
  }
  // As outras três só recusam no NASCIMENTO, e só fora do administrador — é o
  // recorte exato da 0111 §1.c. Cobrá-las na edição inventaria recusa que o
  // banco não faz e trancaria o negócio que já está na esteira.
  if (form.id || conferida || opts.isAdmin) return null;
  return CRIACAO_SEM_CONFERENCIA;
};

/**
 * Os campos de `deals` que saem do formulário — puro, para ficar testável.
 *
 * Duas regras que só existem aqui:
 *
 * 1. **`status_detail` não regrava rótulo derivado.** A tela mostra em "Status
 *    2" o `status_detail` OU, quando ele é nulo, o rótulo deduzido do desfecho
 *    (`legacyStatus`). Gravar o que a tela mostra transformava a dedução em
 *    escolha do operador — em 28 dos 32 negócios da homologação.
 * 2. **`lost_reason` só é escrito quando o status É perda E o motivo mudou.**
 *    Antes ele era reescrito em todo salvamento (virava `null` para qualquer
 *    rótulo que não normalizasse), então abrir e salvar um negócio perdido
 *    apagava o motivo. Reescrever com o rótulo puro também apagaria a
 *    observação que o diálogo de perda concatena ("18. QUEDA — cliente
 *    desistiu"). Chave ausente = não mexe: o supabase-js descarta `undefined`.
 */
export function legacyDealFields(form: SaveLegacyDealInput) {
  const chosen = form.status && form.status !== "Ativo" ? form.status : null;
  const derived = legacyStatus(form.outcome ?? "open", form.lost_reason);
  // `== null` e não `=== null`: o negócio NOVO vem de `emptyDeal`, que não tem
  // a chave — chegava `undefined`, a comparação estrita falhava e o INSERT
  // gravava "PROPOSTA" como se alguém tivesse escolhido. Esse negócio, depois
  // arrastado para "Fechado", exibia "PROPOSTA" no Status 2 de uma venda.
  const untouched = form.status_detail == null && chosen === derived;
  // `choosesLoss`, e não `isLossStatus`: o motivo que JÁ está gravado (como o
  // "19. REPROVADO" da coluna da CCA num negócio aberto) não vira `lost_reason`.
  const losing = choosesLoss(form);
  // `bareStatus` nos dois lados, e não `startsWith` cru: o diálogo de perda
  // concatena "18. QUEDA — cliente desistiu" e um motivo importado pode trazer
  // só "QUEDA — …". Comparando o texto literal, o segundo formato nunca casava
  // e o rótulo era regravado por cima da observação.
  const sameReason = chosen != null
    && bareStatus(form.lost_reason).startsWith(bareStatus(chosen));

  return {
    unit: form.unit || null,
    month_base: form.month_base ? displayMonthToIso(form.month_base) : undefined,
    vgv_gross: Number(form.vgv_bruto ?? form.deal_value ?? 0),
    discount_pct: toNumberOrNull(form.perc_desconto) ?? 0,
    lead_origin: form.lead_origin || null,
    notes: form.notes || null,
    status_detail: untouched ? null : chosen,
    // `!untouched` é a condição que faltava. Quando `status_detail` é nulo, o
    // "Status 2" da tela é o rótulo DERIVADO de `outcome` ("QUEDA"/"DISTRATO",
    // via `legacyStatus`) — ninguém escolheu nada. Sem esta guarda, abrir e
    // salvar um negócio perdido com motivo em texto livre trocava "Comprou com
    // concorrente." por "QUEDA" no primeiro salvamento; é o caso REAL de dois
    // negócios da homologação, e o único ramo que os testes cobriam era o que
    // já tinha `status_detail` preenchido.
    lost_reason: losing && !untouched && !sameReason ? (chosen ?? undefined) : undefined,
    // Status 1. Ausente (negócio novo, ou o Status 2 acabou de mudar no
    // formulário) não vai: o gatilho `deals_sync_status_group` deriva do Status
    // 2 pelo catálogo do BANCO, que é mais novo que o da tela. Presente, vai
    // como está — reenviar o mesmo grupo não é troca, e um grupo diferente da
    // derivação é a troca manual que o banco cobra (`deals.edit_status_group`).
    status_group_id: form.status_group_id ?? undefined,
  };
}

export async function saveLegacyDeal(form: SaveLegacyDealInput): Promise<string> {
  const stageCode = dealStageCodeFor(form);
  const stageId = await getStageIdByCode(stageCode);

  // Recusa HONESTA antes de gravar qualquer coisa.
  //
  // "VENDA" leva o negócio para "Fechado", e o banco cobra duas coisas na
  // entrada dessa etapa: a matriz de etapas (0101) e a conferência documental
  // aprovada (0028, e no INSERT desde a 0110). Sem esta parada o corretor
  // preenchia o formulário inteiro para receber "Você não tem permissão para
  // esta ação." — verdade sem motivo, e sem dizer o que fazer.
  //
  // `can_enter_stage` em vez da matriz espelhada: `saveLegacyDeal` não é hook e
  // não enxerga o `AuthContext`. A ida ao banco só acontece quando o Status 2
  // escolhido é venda E a etapa muda de verdade. `!== false` para não inventar
  // recusa quando a RPC não responde: aí quem decide continua sendo o gatilho,
  // cuja mensagem `describeError` agora mostra inteira.
  if (stageCode === "closed" && stageId !== form.stage_id) {
    const { data: podeEntrar } = await db.rpc("can_enter_stage", { target_stage: stageId });
    const motivo = saleBlockedReason(
      form,
      [{ id: stageId, code: stageCode }],
      () => podeEntrar !== false,
    );
    if (motivo) throw dbError("deals", { code: "P0001", message: motivo });
  }

  let developerId = form.developer_id ?? null;
  if (!developerId && form.developer) {
    const { data, error } = await db
      .from("developers").select("id").ilike("name", form.developer).maybeSingle();
    if (error) throw dbError("developers", error);
    developerId = data?.id ?? null;
  }
  let projectId = form.project_id ?? null;
  if (!projectId && form.project && developerId) {
    const { data, error } = await db
      .from("developer_projects").select("id")
      .eq("developer_id", developerId).ilike("name", form.project).maybeSingle();
    if (error) throw dbError("developer_projects", error);
    projectId = data?.id ?? null;
  }

  const dealPayload = {
    developer_id: developerId,
    project_id: projectId,
    stage_id: stageId,
    ...legacyDealFields(form),
  };

  let dealId = form.id && !/^\d+$/.test(form.id) ? form.id : null;
  if (dealId) {
    // `.select("id")` obrigatório: UPDATE que a RLS filtra não é erro — a linha
    // some do `USING` e o PostgREST devolve 204 com `error: null`. Sem isto, o
    // modal (o único editor de negócio) toastava "Alterações salvas" sem ter
    // gravado nada. É o mesmo defeito que `updateDeal` (pipeline/data.ts) já
    // corrigia para a tabela e o kanban, e que ficou de fora daqui.
    const { data, error } = await db
      .from("deals").update(dealPayload).eq("id", dealId).select("id, status_group_id");
    if (error) throw dbError("deals", error);
    if (!data?.length) {
      throw dbError("deals", {
        code: "P0001",
        message: "Seu perfil não pode alterar este negócio.",
      });
    }
    // Status 1 escolhido à mão e descartado pelo gatilho. Acontece quando o
    // Status 2 muda e o Status 1 escolhido é o MESMO que já estava gravado:
    // `deals_sync_status_group` (0149) só vê troca manual quando o grupo difere
    // do antigo, então deriva pelo Status 2 novo e a escolha some sem aviso. A
    // segunda gravação chega diferente do derivado e passa pela mesma trava de
    // `deals.edit_status_group`.
    // ponytail: duas escritas sem transação; se só a segunda falhar, o Status 2
    // já ficou gravado. Resolver no gatilho quando a 0149 ganhar migration nova.
    const grupo = dealPayload.status_group_id;
    if (grupo && data[0].status_group_id !== grupo) {
      const { error: grupoError } = await db.from("deals").update({ status_group_id: grupo }).eq("id", dealId);
      if (grupoError) throw dbError("deals", grupoError);
    }
  } else {
    const { data, error } = await db.from("deals").insert(dealPayload).select("id").single();
    if (error) throw dbError("deals", error);
    dealId = data.id;
  }

  const { error: c1Error } = await db.from("deal_clients").upsert(
    { deal_id: dealId, ...clientRow(form, 1) },
    { onConflict: "deal_id,ordinal" },
  );
  if (c1Error) throw dbError("deal_clients", c1Error);

  if (form.has_second_client && form.client2) {
    const { error } = await db.from("deal_clients").upsert(
      { deal_id: dealId, ...clientRow(form, 2) },
      { onConflict: "deal_id,ordinal" },
    );
    if (error) throw dbError("deal_clients(2)", error);
  } else {
    const { error } = await db.from("deal_clients")
      .delete().eq("deal_id", dealId).eq("ordinal", 2);
    if (error) throw dbError("deal_clients(2)", error);
  }

  // Participante entra por `id`, nunca por nome (F06). O `find` pelo nome que
  // existia aqui punha o negócio no primeiro homônimo e perdia o vínculo assim
  // que alguém renomeasse o perfil — com o rateio de VGV junto.
  // `dedupe` porque o mesmo perfil em dois slots viraria conflito no upsert
  // (`deal_id,profile_id,role` é único) e derrubaria o salvamento inteiro.
  const dedupe = (ids: (string | null | undefined)[]) =>
    [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const brokerIds = dedupe([form.broker1_id, form.broker2_id, form.broker3_id]);
  const managerIds = dedupe([form.manager1_id, form.manager2_id, form.manager3_id])
    .filter((id) => !brokerIds.includes(id));

  // `ordinal` é o slot da tela (Corretor 1/2/3, Gerente 1/2). Sem ele a leitura
  // dependia de `created_at`, que é igual para todas as linhas do mesmo insert —
  // e as pessoas trocavam de lugar no reload.
  const desejados = [
    ...brokerIds.map((profileId, i) => ({ deal_id: dealId, profile_id: profileId, role: "broker" as const, ordinal: i + 1 })),
    ...managerIds.map((profileId, i) => ({ deal_id: dealId, profile_id: profileId, role: "manager" as const, ordinal: i + 1 })),
  ];

  // Grava PRIMEIRO, remove depois — e nunca esvazia.
  //
  // O direito de editar o negócio vem de estar em `deal_participants`
  // (`can_edit_deal`). Apagar tudo antes de reinserir derrubava a própria
  // permissão no meio do caminho: o delete passava, o insert voltava 403 e o
  // corretor perdia o negócio de vista — não conseguia nem reabrir para
  // desfazer. Mantendo as linhas antigas até as novas entrarem, a autorização
  // nunca fica sem lastro.
  if (desejados.length) {
    const { error } = await db.from("deal_participants")
      .upsert(desejados, { onConflict: "deal_id,profile_id,role" });
    if (error) throw dbError("deal_participants", error);
  }

  // A limpeza é por papel e só quando o formulário trouxe alguém daquele papel.
  //
  // O corretor não enxerga o nome do gerente (RLS de `profiles` devolve só ele
  // mesmo), então "Gerente 1" chega vazio na tela dele. Apagar o que veio vazio
  // tiraria o gerente do negócio — e junto o acesso dele — sem ninguém ter
  // pedido. Campo em branco aqui significa "não sei", não "remova".
  //
  // ponytail: a tela tem 3 slots por papel, então este DELETE também remove um
  // 4º participante que tenha entrado por SQL ou importação — o formulário não
  // tem como "manter" quem ele não mostra. Hoje nenhum negócio tem mais de 2
  // corretores (medido em 02/09/2026), então é buraco latente, não dano.
  // Evoluir quando um negócio precisar de mais de 3 corretores: aí os slots
  // fixos viram lista, e a comparação passa a ser contra o que o banco tem.
  for (const papel of ["broker", "manager"] as const) {
    const mantidos = desejados.filter((r) => r.role === papel).map((r) => r.profile_id);
    if (!mantidos.length) continue;
    const { error } = await db.from("deal_participants")
      .delete()
      .eq("deal_id", dealId)
      .eq("role", papel)
      .not("profile_id", "in", `(${mantidos.join(",")})`);
    if (error) throw dbError("deal_participants", error);
  }

  return dealId as string;
}

export const toIsoMonth = displayMonthToIso;
export const toDisplayMonth = isoMonthToDisplay;
export const todayIso = () => format(new Date(), "yyyy-MM-dd");
