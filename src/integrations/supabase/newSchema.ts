import { differenceInDays, format, parseISO } from "date-fns";
import { supabase } from "./client";
import type { Lead, LeadStatus, PipelineDeal } from "@/types/crm";

const db = supabase as any;

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
  stage_id: string;
  outcome: "open" | "won" | "lost";
  broker1_id: string | null;
  broker2_id: string | null;
  manager1_id: string | null;
  manager2_id: string | null;
  director1_id: string | null;
  director2_id: string | null;
  broker1_name: string | null;
  broker2_name: string | null;
  manager1_name: string | null;
  manager2_name: string | null;
  director1_name: string | null;
  director2_name: string | null;
  developer_id: string | null;
  project_id: string | null;
};

type QueryResult = { data: any[] | null; error: { message?: string } | null };

const throwIfError = (label: string, result: QueryResult) => {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message || "falha ao consultar o banco"}`);
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
  const [profilesRes, rolesRes, membersRes, teamsRes] = (await Promise.all([
    db.from("profiles").select("id,full_name,email,phone,avatar_url,status"),
    db.from("user_roles").select("profile_id,role"),
    db.from("team_members").select("profile_id,team_id,left_at").is("left_at", null),
    db.from("teams").select("id,name,manager_id,director_id,active"),
  ])) as QueryResult[];

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

export async function getCurrentProfile(userId: string) {
  const [profileRes, rolesRes] = await Promise.all([
    db
      .from("profiles")
      .select("id,full_name,email,phone,avatar_url,status")
      .eq("id", userId)
      .maybeSingle(),
    db.from("user_roles").select("role").eq("profile_id", userId),
  ]);
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (rolesRes.error) throw new Error(rolesRes.error.message);
  const roles = ((rolesRes.data || []).map((row: any) => row.role) ||
    []) as NewAppRole[];
  return {
    profile: profileRes.data,
    roles,
    role: primaryRole(roles),
  };
}

const legacyStatus = (outcome: string, lostReason?: string | null) => {
  if (outcome === "won") return "VENDA";
  if (outcome === "lost") {
    return /distrato/i.test(lostReason || "") ? "DISTRATO" : "QUEDA";
  }
  return "PROPOSTA";
};

export async function listLegacyDeals(): Promise<LegacyDealRecord[]> {
  const [
    dealsRes,
    stagesRes,
    developersRes,
    projectsRes,
    clientsRes,
    participantsRes,
    profilesRes,
  ] = (await Promise.all([
    db.from("deals").select("*").order("created_at", { ascending: false }),
    db.from("pipeline_stages").select("id,code,label,position"),
    db.from("developers").select("id,name"),
    db.from("developer_projects").select("id,name"),
    db.from("deal_clients").select("*"),
    db.from("deal_participants").select("*").order("created_at"),
    db.from("profiles").select("id,full_name"),
  ])) as QueryResult[];

  [
    ["deals", dealsRes],
    ["pipeline_stages", stagesRes],
    ["developers", developersRes],
    ["developer_projects", projectsRes],
    ["deal_clients", clientsRes],
    ["deal_participants", participantsRes],
    ["profiles", profilesRes],
  ].forEach(([label, result]) => throwIfError(label as string, result as QueryResult));

  const stageById = new Map((stagesRes.data || []).map((row) => [row.id, row]));
  const developerById = new Map(
    (developersRes.data || []).map((row) => [row.id, row.name]),
  );
  const projectById = new Map(
    (projectsRes.data || []).map((row) => [row.id, row.name]),
  );
  const profileById = new Map(
    (profilesRes.data || []).map((row) => [row.id, row.full_name]),
  );

  const clientsByDeal = new Map<string, any[]>();
  for (const row of clientsRes.data || []) {
    const rows = clientsByDeal.get(row.deal_id) || [];
    rows.push(row);
    clientsByDeal.set(row.deal_id, rows);
  }

  const participantsByDeal = new Map<string, any[]>();
  for (const row of participantsRes.data || []) {
    const rows = participantsByDeal.get(row.deal_id) || [];
    rows.push(row);
    participantsByDeal.set(row.deal_id, rows);
  }

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

    return {
      id: deal.id,
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
      developer: developerById.get(deal.developer_id) || "",
      developer_id: deal.developer_id,
      project: projectById.get(deal.project_id) || "",
      project_id: deal.project_id,
      unit: deal.unit || "",
      status: legacyStatus(deal.outcome, deal.lost_reason),
      stage: (stage?.code || "incomplete") as PipelineDeal["stage"],
      stage_id: deal.stage_id,
      outcome: deal.outcome,
      lead_origin: deal.lead_origin || undefined,
      month_base: isoMonthToDisplay(deal.month_base) || undefined,
      broker1: profileById.get(brokers[0]?.profile_id) || "",
      broker2: profileById.get(brokers[1]?.profile_id) || undefined,
      broker3: profileById.get(brokers[2]?.profile_id) || undefined,
      manager1: profileById.get(managers[0]?.profile_id) || "",
      manager2: profileById.get(managers[1]?.profile_id) || undefined,
      manager3: profileById.get(managers[2]?.profile_id) || undefined,
      broker1_id: brokers[0]?.profile_id || null,
      broker2_id: brokers[1]?.profile_id || null,
      manager1_id: managers[0]?.profile_id || null,
      manager2_id: managers[1]?.profile_id || null,
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
      active: deal.outcome !== "lost",
      created_at: createdAt,
      notes: deal.notes || undefined,
      history: [],
    } satisfies LegacyDealRecord;
  });
}

const legacyLeadStatus = (lead: any): LeadStatus => {
  if (lead.status === "converted") return "converted";
  if (lead.status === "lost" || lead.status === "discarded") return "lost";
  if (lead.funnel_stage === "qualified") return "qualified";
  if (lead.status === "attending" || lead.status === "in_progress") {
    return "contacted";
  }
  return "new";
};

export async function listLegacyLeads(): Promise<Lead[]> {
  const [leadsRes, sourcesRes, profilesRes] = (await Promise.all([
    db.from("leads").select("*").order("created_at", { ascending: false }),
    db.from("lead_sources").select("id,label"),
    db.from("profiles").select("id,full_name"),
  ])) as QueryResult[];
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
  leadsBySource: { name: string; v: number }[];
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

const ccaStatusLabel: Record<string, string> = {
  pending_documents: "Pendente",
  under_review: "Análise de Viabilidade",
  sent_to_developer: "Análise Externa",
  sent_to_agency: "Enviado à Agência",
  approved: "Aprovado Total",
  rejected: "Reprovado",
};

export async function loadDashboardPayload(): Promise<DashboardPayload> {
  const [deals, leads, people, ccaRes, closedRes] = await Promise.all([
    listLegacyDeals(),
    listLegacyLeads(),
    listPeople(),
    db.from("cca_cases").select("status"),
    db.from("closed_months").select("period"),
  ]);
  if (ccaRes.error) throw new Error(ccaRes.error.message);
  if (closedRes.error) throw new Error(closedRes.error.message);

  const sourceCounts = new Map<string, number>();
  for (const lead of leads) {
    const source = lead.source || "Sem origem";
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }

  const ccaCounts: Record<string, number> = {};
  for (const row of ccaRes.data || []) {
    const label = ccaStatusLabel[row.status] || row.status;
    ccaCounts[label] = (ccaCounts[label] || 0) + 1;
  }

  return {
    deals,
    leadsBySource: Array.from(sourceCounts, ([name, v]) => ({ name, v })),
    leadsCount: leads.length,
    ccaCounts,
    staff: {
      brokersTotal: people.filter((person) => person.roles.includes("broker")).length,
      active: people.filter((person) => person.active).length,
      managers: people.filter((person) => person.roles.includes("manager")).length,
      directors: people.filter((person) => person.roles.includes("director")).length,
    },
    closedMonths: (closedRes.data || [])
      .map((row: any) => isoMonthToDisplay(row.period))
      .filter(Boolean) as string[],
  };
}

export async function getStageIdByCode(code: string): Promise<string> {
  const { data, error } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("code", code)
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function listOpenCheckins() {
  const [checkinsRes, profilesRes] = (await Promise.all([
    db
      .from("checkins")
      .select("id,profile_id,checked_in_at,checked_out_at")
      .is("checked_out_at", null),
    db.from("profiles").select("id,full_name"),
  ])) as QueryResult[];
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

export async function listGameRanking() {
  const { data, error } = await db
    .from("game_ranking")
    .select("season_id,profile_id,full_name,points,sales,breakdown")
    .order("points", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export const toIsoMonth = displayMonthToIso;
export const toDisplayMonth = isoMonthToDisplay;
export const todayIso = () => format(new Date(), "yyyy-MM-dd");
