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
import { supabase } from "./client";
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
  return {
    ...complete,
    raw_payload: complete.raw_payload == null ? null : payload,
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

/** Template de mensagem cadastrado no módulo SDR (`whatsapp_templates`). */
export type WhatsappTemplate = { id: string; name: string; body: string };

/**
 * Templates ativos de WhatsApp. Fica aqui, e não na tela, porque o erro precisa
 * chegar embrulhado por `dbError` para o `describeError` traduzir o `code` —
 * lendo `.from()` direto da tela o motivo do RLS chegava cru, em inglês (A05).
 */
export async function listWhatsappTemplates(): Promise<WhatsappTemplate[]> {
  const { data, error } = await db
    .from("whatsapp_templates")
    .select("id,name,body")
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
};

const AUTOMATION_DEFAULTS: AutomationSettings = {
  attend_timeout_seconds: 300,
  overdue_block_threshold: 20,
  inactivity_alert_hours: 48,
  no_response_hours: 24,
  leads_paused: false,
};

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const { data, error } = await db
    .from("automation_settings")
    .select(
      "attend_timeout_seconds,overdue_block_threshold,inactivity_alert_hours,no_response_hours,leads_paused",
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
};

export async function listLeads(options: ListLeadsOptions = {}): Promise<LeadRecord[]> {
  let query = db.from("leads").select("*").order("created_at", { ascending: false });
  if (options.statuses?.length) query = query.in("status", options.statuses);
  if (options.limit) query = query.limit(options.limit);

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
};

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
    })
    .select("*")
    .single();
  asError("criar lead", error);
  return decorateLead(data, new Map(), new Map());
}

export async function createLeads(inputs: NewLeadInput[]): Promise<number> {
  if (!inputs.length) return 0;
  const { data, error } = await db
    .from("leads")
    .insert(
      inputs.map((input) => ({
        full_name: input.full_name.trim(),
        phone: input.phone || null,
        email: input.email || null,
        document: input.document || null,
        source_id: input.source_id || null,
        utm_source: input.utm_source || null,
        utm_campaign: input.utm_campaign || null,
        notes: input.notes || null,
      })),
    )
    .select("id");
  asError("importar leads", error);
  return (data || []).length;
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
  const { error } = await db.from("leads").update(patch).eq("id", id);
  asError("atualizar lead", error);
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
 */
export async function convertLeadToDeal(input: ConvertLeadInput): Promise<void> {
  const { error } = await db.rpc("convert_lead_to_deal", {
    p_lead_id: input.leadId,
    p_developer_id: input.developerId,
    p_project_id: input.projectId || null,
    p_unit: input.unit || null,
    p_vgv_gross: input.vgvGross ?? null,
  });
  asError("converter lead", error);
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

export async function uploadLeadAttachment(leadId: string, file: File): Promise<void> {
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
