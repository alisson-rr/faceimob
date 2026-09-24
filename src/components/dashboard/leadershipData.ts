import { supabase } from "@/integrations/supabase/client";
import { allRows, displayMonthToIso, type PersonRecord } from "@/integrations/supabase/newSchema";
import { bareStatus, nextMonthBase } from "@/lib/dealStatus";
import { dbError } from "@/lib/supabaseError";
import { ALL_MONTHS, dealCategory, participantsOf, type DealRow } from "./data";

export type LeadershipRole = "director" | "manager";
export type ReportTeam = { id: string; manager_id: string | null; director_id: string | null };
export type ReportMember = { team_id: string; profile_id: string };
export type ReportGoal = { scope: string; profile_id: string | null; team_id: string | null; metric: string; target: number };
export type LeaderScope = { id: string; name: string; role: LeadershipRole; teamIds: string[]; profileIds: string[] };
export type LeadershipContext = { scopes: LeaderScope[]; goals: ReportGoal[]; leads: Record<string, number> };
export type LeadershipRow = { id: string; name: string; role: LeadershipRole; goal: number | null;
  compensationGoal: number | null; reached: number | null; leads: number; agile: number; business: number;
  sales: number; vgv: number; off: number };

export const leaderKey = (leader: Pick<LeaderScope, "id" | "role">) => `${leader.role}:${leader.id}`;
const statusKey = (value: string) => bareStatus(value).normalize("NFD").replace(/\p{M}/gu, "");
// O catálogo já tem "08. VIROU NEGÓCIO". Não confundir com a análise anterior
// a virar negócio, nem criar outro status só para o relatório.
const BUSINESS_STATUSES = new Set(["NEGOCIO", "VIROU NEGOCIO", "NEGOCIO FECHADO"]);

export function leadershipScopes(people: PersonRecord[], teams: ReportTeam[], members: ReportMember[]): LeaderScope[] {
  return (["director", "manager"] as const).flatMap(role => people
    .filter(p => p.active && p.roles.includes(role))
    .map(p => {
      const led = teams.filter(t => (role === "director" ? t.director_id : t.manager_id) === p.id);
      const teamIds = led.map(t => t.id);
      const profiles = new Set([p.id]);
      for (const team of led) if (team.manager_id) profiles.add(team.manager_id);
      for (const member of members) if (teamIds.includes(member.team_id)) profiles.add(member.profile_id);
      return { id: p.id, name: p.name, role, teamIds, profileIds: [...profiles] };
    }));
}

/** Meta própria prevalece; sem ela, soma as metas das equipes, sem misturar global. */
function targetFor(goals: ReportGoal[], leader: LeaderScope, metric: string): number | null {
  const rows = goals.filter(g => g.metric === metric);
  const own = rows.find(g => g.scope === "profile" && g.profile_id === leader.id);
  if (own) return own.target;
  if (!leader.teamIds.length) return null;
  const teamGoals = leader.teamIds.map(id => rows.find(g => g.scope === "team" && g.team_id === id));
  // Uma meta parcial não pode virar um % de desempenho aparentemente completo.
  return teamGoals.every(Boolean) ? teamGoals.reduce((sum, g) => sum + g!.target, 0) : null;
}

export function buildLeadershipReport(deals: DealRow[], context: LeadershipContext, month: string): LeadershipRow[] {
  const period = month === ALL_MONTHS ? deals : deals.filter(d => d.month_base === month);
  return context.scopes.map(leader => {
    const rows = period.filter(d => participantsOf(d, leader.role).some(p => p.id === leader.id));
    const sales = rows.filter(d => dealCategory(d) === "venda");
    const goal = month === ALL_MONTHS ? null : targetFor(context.goals, leader, "sales");
    return { id: leader.id, name: leader.name, role: leader.role, goal,
      compensationGoal: month === ALL_MONTHS ? null : targetFor(context.goals, leader, "sales_comp"),
      reached: goal !== null && goal > 0 ? sales.length / goal * 100 : null,
      leads: context.leads[leaderKey(leader)] ?? 0,
      agile: rows.filter(d => statusKey(d.status) === "ESTEIRA AGIL").length,
      business: rows.filter(d => BUSINESS_STATUSES.has(statusKey(d.status))).length,
      sales: sales.length, vgv: sales.reduce((sum, d) => sum + (d.deal_value || 0), 0),
      off: rows.filter(d => /^OFF(?:\s|$)/.test(statusKey(d.status))).length,
    };
  }).sort((a, b) => b.sales - a.sales || b.vgv - a.vgv || a.name.localeCompare(b.name, "pt-BR"));
}

export async function loadLeadershipContext(month: string, people: PersonRecord[], signal: AbortSignal): Promise<LeadershipContext> {
  const [teams, members, goals] = await Promise.all([
    allRows((from, to, count) => supabase.from("teams").select("id,manager_id,director_id", { count })
      .eq("active", true).order("id").range(from, to).abortSignal(signal)),
    allRows((from, to, count) => supabase.from("team_members").select("team_id,profile_id", { count })
      .is("left_at", null).order("id").range(from, to).abortSignal(signal)),
    month === ALL_MONTHS ? Promise.resolve({ data: [], error: null }) :
      allRows((from, to, count) => supabase.from("goals").select("scope,team_id,profile_id,metric,target", { count })
        .eq("period_type", "month").eq("period", displayMonthToIso(month)).in("metric", ["sales", "sales_comp"])
        .order("id").range(from, to).abortSignal(signal)),
  ]);
  if (teams.error) throw dbError("teams", teams.error);
  if (members.error) throw dbError("team_members", members.error);
  if (goals.error) throw dbError("goals", goals.error);
  const scopes = leadershipScopes(people, teams.data, members.data);
  // HEAD/count exato por escopo: não usa os últimos 1.000 leads do Dashboard,
  // nem baixa os dados pessoais de toda a base para contar no navegador.
  const counts = await Promise.all(scopes.map(async leader => {
    let query = supabase.from("leads").select("id", { count: "exact", head: true }).in("assigned_to", leader.profileIds);
    if (month !== ALL_MONTHS) query = query.gte("created_at", `${displayMonthToIso(month)}T00:00:00-03:00`)
      .lt("created_at", `${displayMonthToIso(nextMonthBase(month))}T00:00:00-03:00`);
    const result = await query.abortSignal(signal);
    if (result.error) throw dbError("leads", result.error);
    if (result.count === null) throw new Error("A contagem de leads não foi devolvida.");
    return [leaderKey(leader), result.count] as const;
  }));
  return { scopes, goals: goals.data.map(g => ({ ...g, target: Number(g.target) })), leads: Object.fromEntries(counts) };
}
