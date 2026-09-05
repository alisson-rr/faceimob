// =============================================================================
// Adaptadores do domínio de leads sobre o schema novo (migration 0005).
//
// Existe por dois motivos:
//   1. `newSchema.ts` é território compartilhado (o Dev A regenera tipos e pode
//      tocá-lo) — a trilha B mantém aqui o que é só de lead, sem conflito;
//   2. `listLegacyLeads()` achata o lead na forma antiga e perde exatamente o
//      que as telas de operação precisam: UTM, campanha, `funnel_stage`,
//      `attend_deadline`. Aqui o lead vem inteiro.
//
// Regra da casa: nenhuma tela chama `.from("leads")` direto. Toda leitura e
// escrita passa por este arquivo.
// =============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./client";
import { DEAL_DOCUMENTS_BUCKET } from "./documents";
import { listPeople, type PersonRecord } from "./newSchema";
import type { Database } from "./types";
import { dbError } from "@/lib/supabaseError";

// Fronteira sem tipo, num único lugar: `types.ts` é gerado pelo Dev A e ainda
// está em trânsito (S1.3). Tipar este arquivo contra ele agora amarraria esta
// story ao commit dele — vira follow-up depois que a regeneração mergear.
// Mesmo padrão do `newSchema.ts`.
// Sem cast: os tipos gerados cobrem o schema novo. O `as any` daqui
// anulava justamente a regeneração que a Sprint 1 pagou para fazer.
const db = supabase;
/** Só para as RPCs que a 0056 criou e `types.ts` ainda não conhece. */
const untyped = supabase as unknown as SupabaseClient;
type LeadRow = Database["public"]["Tables"]["leads"]["Row"];
type DecoratableLead = Partial<LeadRow> & Pick<LeadRow, "id" | "full_name" | "created_at" | "updated_at">;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const LEAD_ATTACHMENTS_BUCKET = "lead-attachments";

// -----------------------------------------------------------------------------
// Enums do banco (0001_foundation.sql). Espelhados aqui para o front não
// inventar valores: filtrar por um literal que não existe no enum é erro 22P02
// no Postgres, não lista vazia.
// -----------------------------------------------------------------------------
export type LeadStatus =
  | "queued"
  | "assigned"
  | "attending"
  | "in_progress"
  | "converted"
  | "lost"
  | "discarded";

export type LeadFunnelStage =
  | "new"
  | "first_contact"
  | "no_response"
  | "warm"
  | "hot"
  | "gathering_docs"
  | "scheduled_visit"
  | "qualified";

/**
 * Tom semântico de um estado do lead. É exatamente o conjunto de tons do
 * `StatusBadge` do kit (`@/components/shared`), então a tela repassa sem mapear.
 *
 * Antes cada rótulo carregava a classe pronta com paleta literal do Tailwind
 * (`bg-cyan-500/20`, `border-violet-500/50`) — que não tem versão de tema claro
 * e some do build quando o token não existe no `tailwind.config`. O tom é a
 * decisão de negócio ("perdido é ruim"); a classe é do componente.
 */
export type LeadTone = "neutral" | "info" | "warning" | "danger" | "success" | "highlight";

export const LEAD_STATUSES: { value: LeadStatus; label: string; tone: LeadTone }[] = [
  { value: "queued", label: "Na fila", tone: "neutral" },
  { value: "assigned", label: "Aguardando atendimento", tone: "warning" },
  { value: "attending", label: "Em atendimento", tone: "info" },
  { value: "in_progress", label: "Em relacionamento", tone: "info" },
  { value: "converted", label: "Convertido", tone: "success" },
  { value: "lost", label: "Perdido", tone: "danger" },
  { value: "discarded", label: "Descartado", tone: "neutral" },
];

// O funil é `funnel_stage` — "convertido" NÃO é etapa de funil, é `status`.
// A coluna "Convertido" que existia no funil era uma etapa inexistente no enum.
export const FUNNEL_STAGES: { key: LeadFunnelStage; label: string; tone: LeadTone }[] = [
  { key: "new", label: "Novo Lead", tone: "info" },
  { key: "first_contact", label: "Primeiro Contato", tone: "info" },
  { key: "no_response", label: "Sem Resposta", tone: "warning" },
  { key: "warm", label: "Lead Morno", tone: "warning" },
  { key: "hot", label: "Lead Quente", tone: "highlight" },
  { key: "gathering_docs", label: "Juntando Doc", tone: "neutral" },
  { key: "scheduled_visit", label: "Visita Agendada", tone: "info" },
  { key: "qualified", label: "Qualificado", tone: "success" },
];

export const leadStatusLabel = (status?: string | null) =>
  LEAD_STATUSES.find((item) => item.value === status)?.label || status || "—";

export const leadStatusTone = (status?: string | null): LeadTone =>
  LEAD_STATUSES.find((item) => item.value === status)?.tone || "neutral";

export const funnelStageLabel = (stage?: string | null) =>
  FUNNEL_STAGES.find((item) => item.key === stage)?.label || stage || "—";

export const funnelStageTone = (stage?: string | null): LeadTone =>
  FUNNEL_STAGES.find((item) => item.key === stage)?.tone || "neutral";

/**
 * Tom da origem do lead. Vivia copiado em `LeadDetailModal` (`sourceBadgeCls`) e
 * em `LeadFunnel` (`sourceStyle`), com verdes diferentes para o mesmo WhatsApp
 * (achado T13). Uma origem tem um tom, em qualquer tela.
 */
export const leadSourceTone = (source?: string | null): LeadTone => {
  const value = (source || "").toLowerCase();
  if (value.includes("meta") || value.includes("facebook") || value.includes("instagram")) return "info";
  if (value.includes("whats")) return "success";
  if (value.includes("google")) return "highlight";
  if (value.includes("indica")) return "warning";
  return "neutral";
};

// Status que o lead ainda está vivo na operação.
export const OPEN_LEAD_STATUSES: LeadStatus[] = [
  "queued",
  "assigned",
  "attending",
  "in_progress",
];

// -----------------------------------------------------------------------------
// Forma do lead entregue às telas: colunas reais + apelidos de exibição.
// -----------------------------------------------------------------------------
export type LeadRecord = {
  id: string;
  full_name: string;
  phone: string | null;
  phone_raw: string | null;
  email: string | null;
  document: string | null;

  source_id: string | null;
  distribution_group_id: string | null;
  form_id: string | null;
  external_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  landing_page: string | null;
  raw_payload: Record<string, unknown> | null;

  status: LeadStatus;
  funnel_stage: LeadFunnelStage;
  assigned_to: string | null;
  assigned_at: string | null;
  attend_deadline: string | null;
  first_contact_at: string | null;
  last_activity_at: string | null;
  next_action_at: string | null;
  sdr_qualified_at: string | null;
  converted_at: string | null;
  converted_deal_id: string | null;
  lost_reason: string | null;
  lost_at: string | null;

  notes: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Quantas vezes este lead voltou à fila por prazo de atendimento vencido
   * (`leads.roulette_misses`, 0074). Batido o teto de
   * `automation_settings.roulette_max_rounds`, ele sai da roleta e espera na
   * bandeja "sem atendimento" — antes circulava sem fim (havia leads com 22
   * voltas em homologação) e nenhuma tela sabia distingui-lo de um lead novo.
   */
  roulette_misses: number;

  // Derivados para a UI.
  name: string;
  whatsapp: string;
  source: string;
  broker_name: string | null;
  form_name: string | null;
  form_answers: Record<string, unknown>;
  tracking: Record<string, unknown>;
  stage_changed_at: string;
};

/**
 * Sessão perdida antes de uma escrita que exige `auth.uid()`.
 *
 * Vai com `P0001` de propósito: é o código que `describeError` trata como
 * "mensagem já escrita em pt-BR, mostre-a". Um `Error` cru aqui perde o texto —
 * a tela cairia no fallback genérico ("tente novamente") e esconderia justamente
 * a única instrução que resolve, que é entrar de novo.
 */
const sessionExpired = (acao: string) =>
  dbError("sessão", { code: "P0001", message: `Sessão expirada: entre novamente para ${acao}.` });

const asError = (label: string, error: { message?: string; code?: string } | null) => {
  // `dbError` guarda o erro do Postgres no Error: a tela traduz pelo `code` em
  // vez de mostrar o texto cru em inglês (`describeError`).
  if (error) throw dbError(label, error);
};

/** Monta o `LeadRecord` a partir da linha crua + catálogos já carregados. */
export const decorateLead = (
  row: DecoratableLead,
  sourceLabels: Map<string, string>,
  brokerNames: Map<string, string>,
): LeadRecord => {
  // A API sempre entrega a linha inteira; o formato parcial mantém os helpers
  // puros fáceis de exercitar com fixtures pequenas.
  const complete = row as LeadRow;
  const payload = asRecord(complete.raw_payload);
  // `types.ts` é gerado e ainda não conhece a coluna da 0074; ler por índice
  // mantém o adaptador funcionando antes e depois da regeneração.
  const misses = Number((row as Record<string, unknown>).roulette_misses ?? 0);
  return {
    ...complete,
    raw_payload: complete.raw_payload == null ? null : payload,
    roulette_misses: Number.isFinite(misses) ? misses : 0,
    name: complete.full_name,
    whatsapp: complete.phone || "",
    source:
      (complete.source_id ? sourceLabels.get(complete.source_id) : null) ||
      complete.utm_source ||
      "",
    broker_name: complete.assigned_to ? brokerNames.get(complete.assigned_to) || null : null,
    form_name: complete.form_id || null,
    form_answers: asRecord(payload.fields),
    tracking: payload,
    stage_changed_at: complete.updated_at || complete.created_at,
  };
};

export type LeadSource = {
  id: string;
  code: string;
  label: string;
  channel: string;
  active: boolean;
};

export async function listLeadSources(): Promise<LeadSource[]> {
  const { data, error } = await db
    .from("lead_sources")
    .select("id,code,label,channel,active")
    .order("label");
  asError("lead_sources", error);
  return (data || []) as LeadSource[];
}

/**
 * Template de mensagem cadastrado no módulo SDR (`whatsapp_templates`).
 *
 * O `body` é posicional por contrato da Meta (`{{1}}`, `{{2}}`…) e `variables`
 * diz o nome de cada posição — é ela que permite preencher o texto na tela.
 */
export type WhatsappTemplate = { id: string; name: string; body: string; variables: string[] };

/**
 * Templates ativos de WhatsApp. Fica aqui, e não na tela, porque o erro precisa
 * chegar embrulhado por `dbError` para o `describeError` traduzir o `code` —
 * lendo `.from()` direto da tela o motivo do RLS chegava cru, em inglês (A05).
 */
export async function listWhatsappTemplates(): Promise<WhatsappTemplate[]> {
  const { data, error } = await db
    .from("whatsapp_templates")
    .select("id,name,body,variables")
    .eq("active", true)
    .order("name");
  asError("whatsapp_templates", error);
  return (data || []) as WhatsappTemplate[];
}

/** Corretores elegíveis para atribuição manual (realocação por gestor). */
export async function listAssignableBrokers(): Promise<PersonRecord[]> {
  const people = await listPeople();
  return people.filter((person) => person.active && person.roles.includes("broker"));
}

export type AutomationSettings = {
  attend_timeout_seconds: number;
  overdue_block_threshold: number;
  inactivity_alert_hours: number;
  no_response_hours: number;
  leads_paused: boolean;
  /** Teto de voltas do mesmo lead na roleta antes da bandeja (0074). */
  roulette_max_rounds: number;
};

const AUTOMATION_DEFAULTS: AutomationSettings = {
  attend_timeout_seconds: 300,
  overdue_block_threshold: 20,
  inactivity_alert_hours: 48,
  no_response_hours: 24,
  leads_paused: false,
  roulette_max_rounds: 5,
};

export async function getAutomationSettings(): Promise<AutomationSettings> {
  // `untyped`: `roulette_max_rounds` é da 0074 e `types.ts` (gerado) ainda não
  // a conhece — o mesmo desvio pontual das RPCs novas, até a regeneração.
  const { data, error } = await untyped
    .from("automation_settings")
    .select(
      "attend_timeout_seconds,overdue_block_threshold,inactivity_alert_hours,no_response_hours,leads_paused,roulette_max_rounds",
    )
    .eq("id", true)
    .maybeSingle();
  // A tela não deve morrer por causa de settings: cai no default documentado.
  if (error || !data) return { ...AUTOMATION_DEFAULTS };
  return { ...AUTOMATION_DEFAULTS, ...(data as AutomationSettings) };
}

export type ListLeadsOptions = {
  /** Por padrão traz tudo; o funil pede só os leads ainda em operação. */
  statuses?: LeadStatus[];
  limit?: number;
  /**
   * Busca no BANCO por nome, telefone ou e-mail.
   *
   * Existe porque a lista trunca em `LEADS_PAGE_SIZE` e o rodapé mandava "usar
   * a busca do sistema pelo telefone" — uma busca que não existia: o filtro
   * rodava no cliente, sobre as linhas que já tinham vindo, então um lead fora
   * do recorte era invisível por qualquer termo.
   */
  search?: string;
};

/**
 * Termo pronto para o `or` do PostgREST.
 *
 * `,` separa condições e `(`/`)` delimitam o `or=(…)`: um desses caracteres no
 * que o corretor digitou vira erro de sintaxe (400) em vez de busca. O PONTO
 * fica — o PostgREST usa só os dois primeiros pontos de `coluna.operador.valor`
 * como separadores, e tirá-lo transformava "maria@gmail.com" em
 * `*maria@gmail com*`, que não casa com e-mail nenhum: buscar pelo e-mail
 * inteiro, que é o jeito natural de usar um campo anunciado como buscável por
 * e-mail, não achava nada.
 *
 * Telefone entra só com dígitos porque o banco grava normalizado com DDI —
 * procurar "(11) 98888-7777" não acharia nada. Campanha entra porque o
 * placeholder do campo a promete: sem ela, o lead que só casava por campanha
 * aparecia com 2 letras (filtro do cliente) e sumia na 3ª (consulta ao banco).
 */
export const leadSearchFilter = (term: string): string | null => {
  const clean = term.trim().replace(/[,*()\\%"']/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length < 3) return null;
  const digits = term.replace(/\D/g, "");
  const parts = [
    `full_name.ilike.*${clean}*`,
    `email.ilike.*${clean}*`,
    `campaign_name.ilike.*${clean}*`,
  ];
  if (digits.length >= 3) parts.push(`phone.ilike.*${digits}*`);
  return parts.join(",");
};

/**
 * Teto de linhas por carga da lista.
 *
 * A consulta não tinha `limit`: acima do teto de linhas do PostgREST a lista
 * truncava sem ninguém saber. Com um teto explícito a tela sabe quando bateu
 * nele (`leads.length === LEADS_PAGE_SIZE`) e pode dizer que há mais.
 *
 * ponytail: recorte no cliente com aviso, não paginação de verdade; evoluir
 * para filtro no servidor quando a base passar de alguns milhares de leads.
 */
export const LEADS_PAGE_SIZE = 1_000;

export async function listLeads(options: ListLeadsOptions = {}): Promise<LeadRecord[]> {
  let query = db.from("leads").select("*").order("created_at", { ascending: false });
  if (options.statuses?.length) query = query.in("status", options.statuses);
  const filtro = options.search ? leadSearchFilter(options.search) : null;
  if (filtro) query = query.or(filtro);
  query = query.limit(options.limit ?? LEADS_PAGE_SIZE);

  const [leadsRes, sourcesRes, profilesRes] = await Promise.all([
    query,
    db.from("lead_sources").select("id,label"),
    db.from("profiles").select("id,full_name"),
  ]);
  asError("leads", leadsRes.error);
  asError("lead_sources", sourcesRes.error);
  asError("profiles", profilesRes.error);

  const sourceLabels = new Map<string, string>(
    (sourcesRes.data || []).map((row) => [row.id, row.label]),
  );
  const brokerNames = new Map<string, string>(
    (profilesRes.data || []).map((row) => [row.id, row.full_name]),
  );

  return (leadsRes.data || []).map((row) =>
    decorateLead(row, sourceLabels, brokerNames),
  );
}

export type NewLeadInput = {
  full_name: string;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  source_id?: string | null;
  utm_source?: string | null;
  utm_campaign?: string | null;
  notes?: string | null;
  /**
   * Grupo de distribuição do lead. Vazio = `lead_distribution_group()` decide
   * (formulário → fila geral). Sem este campo, planilha importada caía sempre
   * na Fila Geral e os outros grupos configurados eram inalcançáveis.
   */
  distribution_group_id?: string | null;
};

export type DistributionGroup = { id: string; name: string; kind: string };

/** Grupos ativos — destino possível de um lead importado e filtro da lista. */
export async function listDistributionGroups(): Promise<DistributionGroup[]> {
  const { data, error } = await db
    .from("distribution_groups")
    .select("id,name,kind")
    .eq("active", true)
    .order("name");
  asError("distribution_groups", error);
  return (data || []) as DistributionGroup[];
}

/**
 * Criação manual (indicação, importação). O lead entra `queued`: quem distribui
 * é a roleta do banco. `assign_lead` é `service_role`, então a tela não escolhe
 * corretor — para colocar o lead na mão de alguém agora existe `reassignLead`.
 */
export async function createLead(input: NewLeadInput): Promise<LeadRecord> {
  const { data, error } = await db
    .from("leads")
    .insert({
      full_name: input.full_name.trim(),
      phone: input.phone || null,
      email: input.email || null,
      document: input.document || null,
      source_id: input.source_id || null,
      utm_source: input.utm_source || null,
      utm_campaign: input.utm_campaign || null,
      notes: input.notes || null,
      distribution_group_id: input.distribution_group_id || null,
    })
    .select("*")
    .single();
  asError("criar lead", error);
  return decorateLead(data, new Map(), new Map());
}

/** Quantas linhas por INSERT na importação. Ver `createLeads`. */
export const IMPORT_CHUNK_SIZE = 200;

const leadInsertRow = (input: NewLeadInput) => ({
  full_name: input.full_name.trim(),
  phone: input.phone || null,
  email: input.email || null,
  document: input.document || null,
  source_id: input.source_id || null,
  utm_source: input.utm_source || null,
  utm_campaign: input.utm_campaign || null,
  notes: input.notes || null,
  distribution_group_id: input.distribution_group_id || null,
});

/**
 * Importação em lotes de `IMPORT_CHUNK_SIZE`.
 *
 * Era um INSERT único: 5.000 linhas iam numa requisição só, a aba ficava parada
 * sem sinal de progresso e um único CHECK do banco derrubava tudo sem dizer
 * onde. Em lotes, o que já entrou fica, `onProgress` move a barra, e o erro
 * chega dizendo quantos leads foram gravados e a partir de qual linha da
 * planilha o lote falhou — que é a informação que permite corrigir o arquivo.
 */
export async function createLeads(
  inputs: NewLeadInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (!inputs.length) return 0;
  let saved = 0;
  for (let start = 0; start < inputs.length; start += IMPORT_CHUNK_SIZE) {
    const chunk = inputs.slice(start, start + IMPORT_CHUNK_SIZE);
    const { data, error } = await db.from("leads").insert(chunk.map(leadInsertRow)).select("id");
    if (error) {
      throw dbError(
        `importar leads (${error.message})`,
        {
          code: "P0001",
          message:
            `${saved} lead(s) foram importados. O erro começou no lote da linha ` +
            `${start + 1} da planilha (${chunk[0]?.full_name || "sem nome"}): ` +
            `${error.message}. Corrija essas linhas e importe só o restante.`,
        },
      );
    }
    saved += (data || []).length;
    onProgress?.(saved, inputs.length);
  }
  return saved;
}

/**
 * Telefones (só dígitos) que já existem em `leads`, entre os informados.
 *
 * A RPC é `security definer` porque a duplicata pode estar num lead de outra
 * equipe, invisível para quem importa — devolve só o telefone, nunca a linha.
 * Sem ela, reimportar a mesma exportação do Leadfy criava tudo de novo e
 * mandava dois corretores para o mesmo cliente.
 */
export async function existingLeadPhones(phones: string[]): Promise<Set<string>> {
  const digits = Array.from(
    new Set(phones.map((phone) => phone.replace(/\D/g, "")).filter(Boolean)),
  );
  if (!digits.length) return new Set();
  // `types.ts` é gerado e ainda não conhece a RPC da 0056; o mesmo desvio de
  // `analytics.ts`, num ponto só, até a regeneração.
  const { data, error } = await untyped.rpc("existing_lead_phones", { p_phones: digits });
  asError("conferir telefones repetidos", error);
  return new Set(((data || []) as { phone_digits: string }[]).map((row) => row.phone_digits));
}

/**
 * Exclusão de lead (`leads_delete` exige a permissão `leads.delete`).
 *
 * Pede a linha de volta pelo mesmo motivo de `updateLead`: DELETE recusado pela
 * RLS casa 0 linhas e volta 204 sem erro — o toast diria "excluído" com o lead
 * ainda lá.
 */
export async function deleteLead(id: string): Promise<void> {
  const { data, error } = await db.from("leads").delete().eq("id", id).select("id").maybeSingle();
  asError("excluir lead", error);
  if (!data) throw dbError("excluir lead", { code: "42501", message: "sem permissão para excluir este lead" });
}

/** Campos que a tela pode editar direto (RLS decide quem consegue). */
export type LeadPatch = Partial<
  Pick<
    LeadRecord,
    | "full_name"
    | "phone"
    | "email"
    | "document"
    | "notes"
    | "funnel_stage"
    | "next_action_at"
    | "first_contact_at"
    | "source_id"
  >
>;

export async function updateLead(id: string, patch: LeadPatch): Promise<void> {
  // Pede a linha de volta: UPDATE que a RLS recusa casa 0 linhas e volta 204,
  // sem `error` — o toast de "Dados salvos" disparava com nada gravado.
  const { data, error } = await db.from("leads").update(patch).eq("id", id).select("id").maybeSingle();
  asError("atualizar lead", error);
  if (!data) throw dbError("atualizar lead", { code: "42501", message: "sem permissão para editar este lead" });
}

/** Move de etapa. `first_contact` também marca o primeiro contato. */
export async function moveLeadStage(
  id: string,
  stage: LeadFunnelStage,
  opts: { firstContact?: boolean } = {},
): Promise<void> {
  const patch: LeadPatch = { funnel_stage: stage };
  if (stage === "first_contact" || opts.firstContact) {
    patch.first_contact_at = new Date().toISOString();
  }
  await updateLead(id, patch);
}

/**
 * "Atender": trava o lead com o corretor e para o cronômetro (`claim_lead`).
 * O banco recusa se o lead não é dele ou já saiu de `assigned` — é essa recusa
 * que garante que dois corretores não atendem o mesmo lead.
 */
export async function claimLead(id: string): Promise<void> {
  const { error } = await db.rpc("claim_lead", { p_lead_id: id });
  asError("atender lead", error);
}

/**
 * Empurra um lead parado na fila para a roleta (`distribute_queued_lead`).
 *
 * Não escolhe corretor — quem recebe continua sendo o primeiro da fila.
 *
 * A RPC recusa com o motivo em pt-BR (`P0001`, que `describeError` repassa)
 * quando a distribuição está pausada em Admin, quando o lead não tem grupo e
 * não há fila geral ativa, ou quando ele já saiu da fila. `null` sobrou para um
 * caso só: ninguém elegível na fila agora — e a tela precisa dizer isso em vez
 * de comemorar, que era o silêncio que deixava 9 leads em `queued` sem ninguém
 * saber. O teto de reentregas da 0056 não vale aqui: o gestor clicou sabendo.
 */
export async function distributeQueuedLead(id: string): Promise<string | null> {
  const { data, error } = await untyped.rpc("distribute_queued_lead", { p_lead_id: id });
  asError("distribuir lead", error);
  return (data as string | null) ?? null;
}

/**
 * Motivos de encerramento do lead.
 *
 * Lista curta e fixa, como o `LOSS_REASONS` do Pipeline: motivo em texto livre
 * vira relatório impossível de somar, e o gestor precisa contar "quantos
 * perdemos por preço". O corretor complementa em observação quando quiser.
 */
export const LEAD_CLOSE_REASONS = [
  "Sem interesse",
  "Não responde",
  "Comprou com concorrente",
  "Fora do perfil de crédito",
  "Fora da região atendida",
  "Contato inválido",
  "Duplicado",
] as const;

/** Status de encerramento aceitos por `close_lead`. */
export const LEAD_CLOSE_STATUSES: { value: Extract<LeadStatus, "lost" | "discarded">; label: string; hint: string }[] = [
  { value: "lost", label: "Perdido", hint: "houve contato e o cliente não seguiu" },
  { value: "discarded", label: "Descartado", hint: "o lead não era um cliente de verdade" },
];

/**
 * Encerra o lead como perdido ou descartado, com motivo (`close_lead`, 0074).
 *
 * É a saída que faltava: `next_action_at` no passado é o que conta em
 * `overdue_lead_count` e bloqueia o check-in em 20, e até aqui só reagendar ou
 * converter tirava o lead da conta — quem nunca ia responder ficava atrasado
 * para sempre e o bloqueio era contornável por reagendamento infinito.
 *
 * A RPC recusa (P0001/42501, texto em pt-BR) quando falta motivo, quando o lead
 * já virou negócio, quando já está encerrado ou quando quem chama não escreve
 * no lead — a tela repassa por `describeError`.
 */
export async function closeLead(
  id: string,
  status: "lost" | "discarded",
  reason: string,
): Promise<void> {
  const { data, error } = await untyped.rpc("close_lead", {
    p_lead_id: id,
    p_status: status,
    p_reason: reason,
  });
  asError("encerrar lead", error);
  // A RPC devolve a linha gravada: sem linha, nada mudou — e um toast de
  // "encerrado" com o lead intacto é o defeito que este confere existe para
  // impedir.
  if (!data) {
    throw dbError("encerrar lead", { code: "P0001", message: "O lead não foi encerrado no servidor." });
  }
}

/** Realocação manual por gestor (`reassign_lead`). Reinicia a trava. */
export async function reassignLead(id: string, targetProfileId: string): Promise<void> {
  const { error } = await db.rpc("reassign_lead", {
    p_lead_id: id,
    p_target: targetProfileId,
  });
  asError("realocar lead", error);
}

export type ConvertLeadInput = {
  leadId: string;
  developerId: string;
  projectId?: string | null;
  unit?: string | null;
  vgvGross?: number | null;
};

/**
 * Conversão em negócio via `convert_lead_to_deal`.
 *
 * O negócio nasce sem anexo: a migration `0028` tirou a exigência de documento
 * daqui (decisão de 10/08). Os anexos que existirem são promovidos junto, e os
 * documentos obrigatórios travam só o envio ao gerente.
 *
 * A RPC promove só a LINHA do anexo; o arquivo fica no bucket do lead. Quem
 * converte chama `promoteLeadAttachments` logo em seguida.
 */
export async function convertLeadToDeal(input: ConvertLeadInput): Promise<void> {
  const { error } = await db.rpc("convert_lead_to_deal", {
    p_lead_id: input.leadId,
    p_developer_id: input.developerId,
    p_project_id: input.projectId || null,
    p_unit: input.unit || null,
    // `??` deixa NaN passar e o JSON o serializa como null: o negócio nascia
    // sem VGV e sem aviso. A tela valida antes; aqui é a rede de segurança.
    p_vgv_gross: Number.isFinite(input.vgvGross) ? (input.vgvGross as number) : null,
  });
  asError("converter lead", error);
}

/**
 * Copia os anexos do lead para o bucket do negócio, com a mesma chave.
 *
 * `convert_lead_to_deal` grava em `deal_documents` o `storage_path` de
 * `lead_attachments`, mas o objeto continua em `lead-attachments` — e tudo que
 * lê documento do negócio (botão Baixar, `submission-dispatch`) assina em
 * `deal-documents`. SQL não move bytes; a cópia é aqui, depois da conversão.
 *
 * ponytail: cópia no cliente depois de a RPC ter commitado; se falhar, a linha
 * promovida fica sem arquivo e o usuário é avisado para anexar de novo. Evoluir
 * para cópia no servidor quando houver edge function de conversão.
 */
export async function promoteLeadAttachments(leadId: string): Promise<void> {
  for (const attachment of await listLeadAttachments(leadId)) {
    const { error } = await supabase.storage
      .from(LEAD_ATTACHMENTS_BUCKET)
      .copy(attachment.storage_path, attachment.storage_path, { destinationBucket: DEAL_DOCUMENTS_BUCKET });
    if (error) {
      // O motivo do Storage fica no rótulo (console); a tela mostra só a
      // instrução em pt-BR, via `P0001`.
      throw dbError(`copiar anexo (${error.message})`, {
        code: "P0001",
        message: `O anexo «${attachment.original_name}» não foi copiado para o negócio. Anexe-o de novo na aba Anexos.`,
      });
    }
  }
}

export async function listDevelopers(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from("developers")
    .select("id,name")
    .eq("active", true)
    .order("name");
  asError("developers", error);
  return (data || []) as { id: string; name: string }[];
}

export async function listDeveloperProjects(
  developerId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await db
    .from("developer_projects")
    .select("id,name")
    .eq("developer_id", developerId)
    .order("name");
  asError("developer_projects", error);
  return (data || []) as { id: string; name: string }[];
}

// -----------------------------------------------------------------------------
// Histórico: log automático (`lead_events`, imutável) + comentários manuais
// (`lead_comments`, editáveis pelo autor) + anexos.
// -----------------------------------------------------------------------------
export type LeadEvent = {
  id: string;
  kind: string;
  actor_id: string | null;
  actor_name: string | null;
  from_value: string | null;
  to_value: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  description: string;
};

const EVENT_LABELS: Record<string, string> = {
  created: "Lead criado",
  assigned: "Atribuído pela roleta",
  claimed: "Corretor assumiu o atendimento",
  released: "Devolvido à fila",
  reassigned: "Realocado manualmente",
  stage_changed: "Etapa alterada",
  status_changed: "Status alterado",
  converted: "Convertido em negócio",
  sdr_handoff: "Repassado pela IA de SDR",
  // `close_lead` (0074) grava só o MOTIVO: a mudança de status já entra pelo
  // gatilho `leads_log_changes`. Dois eventos com o mesmo texto duplicavam a
  // linha do histórico e dobravam a conta de "quantos perdemos por preço".
  closed: "Lead encerrado",
  // `assign_lead` estourando o teto de voltas. Sem rótulo, o histórico mostrava
  // a palavra "unattended" crua para o gestor.
  unattended: "Saiu da roleta sem atendimento",
};

const RELEASE_REASONS: Record<string, string> = {
  timeout: "prazo de atendimento estourou",
  manual: "devolvido manualmente",
  reassigned: "realocado por gestor",
  checkout: "corretor saiu do turno",
  sdr_handoff: "qualificação da IA concluída",
};

/** Texto legível do evento, traduzindo enums de etapa/status/motivo. */
export const describeLeadEvent = (
  row: {
    kind: string;
    from_value?: string | null;
    to_value?: string | null;
    detail?: Record<string, unknown> | null;
  },
  names: Map<string, string> = new Map(),
): string => {
  const base = EVENT_LABELS[row.kind] || row.kind;
  const detailReason = typeof row.detail?.reason === "string" ? row.detail.reason : null;
  const reason = detailReason ? RELEASE_REASONS[detailReason] || detailReason : null;

  switch (row.kind) {
    case "stage_changed":
      return `${base}: ${funnelStageLabel(row.from_value)} → ${funnelStageLabel(row.to_value)}`;
    case "status_changed":
      return `${base}: ${leadStatusLabel(row.from_value)} → ${leadStatusLabel(row.to_value)}`;
    case "assigned":
    case "reassigned":
      return `${base}: ${(row.to_value && names.get(row.to_value)) || "corretor"}`;
    case "released":
      return reason ? `${base} (${reason})` : base;
    case "closed":
      // O motivo é texto escolhido no diálogo ("Preço", "Sem interesse — …"),
      // não um enum: entra como veio, que é o que o relatório de perda lê.
      return reason
        ? `${base} como ${leadStatusLabel(row.to_value)}: ${reason}`
        : `${base} como ${leadStatusLabel(row.to_value)}`;
    case "unattended": {
      const voltas = typeof row.detail?.misses === "number" ? row.detail.misses : null;
      return voltas ? `${base} (${voltas} voltas)` : base;
    }
    default:
      return base;
  }
};

export async function listLeadEvents(leadId: string): Promise<LeadEvent[]> {
  const [eventsRes, profilesRes] = await Promise.all([
    db
      .from("lead_events")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false }),
    db.from("profiles").select("id,full_name"),
  ]);
  asError("lead_events", eventsRes.error);
  asError("profiles", profilesRes.error);

  const names = new Map<string, string>(
    (profilesRes.data || []).map((row) => [row.id, row.full_name]),
  );

  return (eventsRes.data || []).map((row) => {
    const detail = row.detail == null ? null : asRecord(row.detail);
    return {
      ...row,
      detail,
      actor_name: row.actor_id ? names.get(row.actor_id) || null : null,
      description: describeLeadEvent({ ...row, detail }, names),
    };
  });
}

export type LeadComment = {
  id: string;
  body: string;
  author_id: string | null;
  author_name: string;
  created_at: string;
  updated_at: string;
};

export async function listLeadComments(leadId: string): Promise<LeadComment[]> {
  const [commentsRes, profilesRes] = await Promise.all([
    db
      .from("lead_comments")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true }),
    db.from("profiles").select("id,full_name"),
  ]);
  asError("lead_comments", commentsRes.error);
  asError("profiles", profilesRes.error);

  const names = new Map<string, string>(
    (profilesRes.data || []).map((row) => [row.id, row.full_name]),
  );

  return (commentsRes.data || []).map((row) => ({
    ...row,
    // Autor real do comentário — não o usuário que está olhando a tela.
    author_name: (row.author_id && names.get(row.author_id)) || "Autor removido",
  }));
}

/** `lead_comments_insert` exige `author_id = auth.uid()`. */
export async function addLeadComment(leadId: string, body: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) throw sessionExpired("comentar");
  const { error } = await db.from("lead_comments").insert({
    lead_id: leadId,
    author_id: auth.user.id,
    body: body.trim(),
  });
  asError("comentar", error);
}

export type LeadAttachment = {
  id: string;
  storage_path: string;
  original_name: string;
  stored_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export async function listLeadAttachments(leadId: string): Promise<LeadAttachment[]> {
  const { data, error } = await db
    .from("lead_attachments")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  asError("lead_attachments", error);
  return (data || []) as LeadAttachment[];
}

/**
 * Teto do anexo de lead. O mesmo da importação de planilha, e o mesmo que a
 * 0056 gravou em `storage.buckets.file_size_limit` — o bucket estava sem
 * limite nenhum. Validar aqui é o que permite dizer o motivo em pt-BR: o erro
 * do Storage para arquivo grande chega em inglês e sem o número.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** Tipos aceitos no bucket `lead-attachments` (0056). Documento, não executável. */
export const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv", "text/plain",
];

/** O que a tela mostra ao lado do botão de anexar. */
export const ATTACHMENT_HINT = "PDF, imagem, Word, Excel ou texto · até 8 MB";

/**
 * Recusa antes de subir: tamanho e tipo. `null` quando o arquivo passa.
 *
 * Puro de propósito (testado em `model.test.ts`): é a mesma regra do bucket, e
 * o usuário precisa saber qual das duas o reprovou.
 */
export const rejectAttachment = (file: { name: string; size: number; type: string }): string | null => {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return `«${file.name}» tem mais de 8 MB. Comprima o arquivo ou envie em partes.`;
  }
  // Arquivo sem `type` (alguns navegadores, alguns .heic) não é motivo de
  // recusa aqui: o bucket ainda barra, e recusar em silêncio um documento
  // válido seria pior que a mensagem do Storage.
  if (file.type && !ATTACHMENT_MIME_TYPES.includes(file.type)) {
    return `Tipo de arquivo não aceito (${file.type}). Envie ${ATTACHMENT_HINT.toLowerCase()}.`;
  }
  return null;
};

export async function uploadLeadAttachment(leadId: string, file: File): Promise<void> {
  const recusa = rejectAttachment(file);
  if (recusa) throw dbError("anexar", { code: "P0001", message: recusa });

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) throw sessionExpired("anexar");

  const storedName = `${Date.now()}-${file.name}`;
  const path = `${leadId}/${storedName}`;

  const { error: uploadError } = await supabase.storage
    .from(LEAD_ATTACHMENTS_BUCKET)
    .upload(path, file);
  // `dbError` mesmo sem `code` de Postgres: o Error passa a ter o objeto
  // original em `.db`, então a tela chama `describeError` como em todo o resto
  // e cai no fallback dela em vez de mostrar o texto do Storage em inglês.
  if (uploadError) throw dbError("enviar anexo", uploadError);

  const { error } = await db.from("lead_attachments").insert({
    lead_id: leadId,
    storage_path: path,
    original_name: file.name,
    stored_name: storedName,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: auth.user.id,
  });
  if (error) {
    // Não deixa arquivo órfão no bucket quando o insert é barrado pela RLS.
    await supabase.storage.from(LEAD_ATTACHMENTS_BUCKET).remove([path]);
    asError("anexar", error);
  }
}

export async function signedAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(LEAD_ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, 60);
  if (error || !data) throw dbError("gerar link do anexo", error ?? { message: "link não gerado" });
  return data.signedUrl;
}

/** Quantos leads a roleta devolveu por estouro de prazo hoje, por corretor. */
export async function listTimeoutReleasesToday(): Promise<Map<string, number>> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { data, error } = await db
    .from("lead_assignments")
    .select("profile_id")
    .eq("release_reason", "timeout")
    .gte("released_at", start.toISOString());
  asError("lead_assignments", error);

  const counts = new Map<string, number>();
  for (const row of data || []) {
    counts.set(row.profile_id, (counts.get(row.profile_id) || 0) + 1);
  }
  return counts;
}

export type GroupQueueEntry = { profile_id: string; full_name: string; queue_position: number };

export type GroupQueue = {
  groupId: string;
  groupName: string;
  kind: string;
  entries: GroupQueueEntry[];
  /** Erro desta fila só. Um grupo recusado não pode apagar os outros da tela. */
  error: unknown;
};

/**
 * A fila de cada grupo ativo — a saúde da roleta para quem responde por ela.
 *
 * `distribution_queue` é a única fonte de "quem está pronto para receber":
 * junta presença aberta, turno já distribuindo, perfil ativo e o bloqueio por
 * leads atrasados. Sem isso, gerente e diretor não tinham onde responder "por
 * que fulano não recebeu lead?" nem enxergar que a roleta está parada.
 *
 * Desde a 0056 a RPC exige ser membro do grupo ou ter `leads.view_queue`: por
 * isso cada grupo carrega o próprio erro em vez de derrubar a lista.
 */
export async function listGroupQueues(): Promise<GroupQueue[]> {
  const { data, error } = await db
    .from("distribution_groups")
    .select("id,name,kind")
    .eq("active", true)
    .order("name");
  asError("distribution_groups", error);

  const groups = (data || []) as { id: string; name: string; kind: string }[];
  return Promise.all(
    groups.map(async (group) => {
      const res = await db.rpc("distribution_queue", { p_group_id: group.id });
      return {
        groupId: group.id,
        groupName: group.name,
        kind: group.kind,
        entries: res.error ? [] : ((res.data || []) as GroupQueueEntry[]),
        error: res.error ? dbError("fila do grupo", res.error) : null,
      };
    }),
  );
}

// -----------------------------------------------------------------------------
// Helpers puros (testados em leads.test.ts)
// -----------------------------------------------------------------------------

/**
 * Segundos restantes da trava de atendimento. `null` quando não há cronômetro
 * correndo — o banco zera `attend_deadline` no `claim_lead`, então "sem prazo"
 * e "já assumido" são o mesmo estado.
 */
export const attendSecondsLeft = (
  lead: Pick<LeadRecord, "status" | "attend_deadline">,
  now: number = Date.now(),
): number | null => {
  if (lead.status !== "assigned" || !lead.attend_deadline) return null;
  const left = new Date(lead.attend_deadline).getTime() - now;
  return Math.max(0, Math.ceil(left / 1000));
};

export const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

/**
 * Quem a tela deixa escrever no lead.
 *
 * Espelha `can_write_lead()` e a policy `leads_update` — dono, admin, gestor do
 * dono, ou lead sem corretor para quem tem `leads.view_queue`. Sem isso a linha
 * mostrava Editar e Converter para todo mundo e o banco recusava com 42501
 * depois do clique: o sócio descobria a falta de permissão preenchendo um
 * formulário inteiro.
 *
 * ponytail: `managesTeam` é `leads.reassign` (gerente/diretor), não a equipe de
 * verdade — o cliente não sabe quem lidera quem. Um gerente ainda pode receber
 * 42501 num lead de outra equipe; evoluir quando a tela carregar a hierarquia.
 */
export type LeadWriteAbility = {
  profileId: string | null;
  isAdmin: boolean;
  /** `can("leads.reassign")` — quem gere equipe. */
  managesTeam: boolean;
  /** `can("leads.view_queue")` — quem alcança lead sem corretor. */
  canViewQueue: boolean;
};

export const canWriteLead = (
  lead: Pick<LeadRecord, "assigned_to">,
  ability: LeadWriteAbility,
): boolean => {
  if (ability.isAdmin) return true;
  if (lead.assigned_to) {
    return lead.assigned_to === ability.profileId || ability.managesTeam;
  }
  return ability.canViewQueue;
};

/** O lead está na minha mão aguardando o clique em "Atender"? */
export const canClaim = (
  lead: Pick<LeadRecord, "status" | "assigned_to">,
  profileId?: string | null,
): boolean => Boolean(profileId) && lead.status === "assigned" && lead.assigned_to === profileId;

/**
 * Mesma definição de "atrasado" de `public.overdue_lead_count`: é o que decide
 * o bloqueio de check-in. Qualquer heurística de tela que discorde disso mente
 * para o corretor.
 */
export const isLeadOverdue = (
  lead: Pick<LeadRecord, "status" | "next_action_at">,
  now: number = Date.now(),
): boolean => {
  if (!["assigned", "attending", "in_progress"].includes(lead.status)) return false;
  if (!lead.next_action_at) return false;
  return new Date(lead.next_action_at).getTime() < now;
};

/**
 * O lead saiu da roleta por falta de atendimento (bandeja do gestor).
 *
 * Mesma condição de `assign_lead` (0074): parado na fila com o teto de voltas
 * batido. A roleta não o oferece mais a ninguém — só o botão "Distribuir" do
 * gestor ou uma realocação tiram ele daqui, e é por isso que a tela precisa
 * separá-lo do lead que acabou de chegar.
 */
export const isLeadUnattended = (
  lead: Pick<LeadRecord, "status" | "roulette_misses">,
  maxRounds: number,
): boolean => lead.status === "queued" && maxRounds > 0 && lead.roulette_misses >= maxRounds;

export type SourcePerformance = {
  source: string;
  totalLeads: number;
  converted: number;
  conversionRate: number;
  avgDaysToConvert: number;
};

/**
 * Desempenho por origem — o requisito de "quais campanhas convertem mais" da
 * ata 23/07. Usa `converted_at`, então o tempo médio é real (o cálculo antigo
 * media até hoje, não até a conversão).
 */
export const sourcePerformance = (
  leads: Pick<LeadRecord, "source" | "status" | "created_at" | "converted_at">[],
): SourcePerformance[] => {
  const acc = new Map<string, { total: number; converted: number; days: number }>();

  for (const lead of leads) {
    const key = lead.source || "Sem origem";
    const row = acc.get(key) || { total: 0, converted: 0, days: 0 };
    row.total += 1;
    if (lead.status === "converted") {
      row.converted += 1;
      const end = lead.converted_at ? new Date(lead.converted_at).getTime() : null;
      const start = new Date(lead.created_at).getTime();
      if (end && end >= start) row.days += Math.floor((end - start) / 86_400_000);
    }
    acc.set(key, row);
  }

  return Array.from(acc, ([source, row]) => ({
    source,
    totalLeads: row.total,
    converted: row.converted,
    conversionRate: row.total ? Math.round((row.converted / row.total) * 100) : 0,
    avgDaysToConvert: row.converted ? Math.round(row.days / row.converted) : 0,
  })).sort((a, b) => b.conversionRate - a.conversionRate);
};

/** Campos de rastreio para exibição (ata 23/07: UTM, campanha, anúncio). */
export const trackingFields = (
  lead: LeadRecord,
): { label: string; value: string }[] =>
  (
    [
      ["Origem (UTM)", lead.utm_source],
      ["Mídia", lead.utm_medium],
      ["Campanha (UTM)", lead.utm_campaign],
      ["Conteúdo", lead.utm_content],
      ["Termo", lead.utm_term],
      ["Campanha", lead.campaign_name || lead.campaign_id],
      ["Conjunto", lead.adset_name || lead.adset_id],
      ["Anúncio", lead.ad_name || lead.ad_id],
      ["Formulário", lead.form_id],
      ["Landing page", lead.landing_page],
      ["ID na origem", lead.external_id],
    ] as [string, string | null | undefined][]
  )
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value: String(value) }));
