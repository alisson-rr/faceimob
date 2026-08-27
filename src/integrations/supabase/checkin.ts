import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Check-in, turno e fila de distribuição.
 *
 * A tela calculava a janela do turno no cliente lendo `work_shifts` e usava
 * `overdue_lead_count` cru, sem saber o motivo do bloqueio. O banco já resolvia
 * as duas coisas: `current_shift()` respeita o fuso America/Sao_Paulo e
 * `checkin_eligibility()` devolve o motivo em texto — foi feita assim
 * justamente para a tela poder explicar ao corretor por que ele está travado.
 */

export type CheckinEligibility = {
  allowed: boolean;
  reason: string;
  overdue_count: number;
  threshold: number;
};

export type WorkShift = {
  id: string;
  code: string;
  label: string;
  checkin_start: string;
  distribution_start: string;
  checkout_time: string;
  position: number;
};

export type CheckinRecord = {
  id: string;
  shift_id: string;
  work_date: string;
  checked_in_at: string;
  checked_out_at: string | null;
  leads_received: number;
};

export type QueueEntry = {
  profile_id: string;
  full_name: string;
  queue_position: number;
  last_assigned_at: string | null;
};

export async function getCheckinEligibility(): Promise<CheckinEligibility> {
  const { data, error } = await supabase.rpc("checkin_eligibility");
  if (error) throw dbError("checkin_eligibility", error);
  const row = (data as CheckinEligibility[] | null)?.[0];
  // Falha fechada: sem resposta, não liberar o check-in por omissão.
  return row ?? { allowed: false, reason: "Não foi possível verificar sua elegibilidade.", overdue_count: 0, threshold: 20 };
}

/** Id do turno vigente agora, ou null fora de qualquer janela. */
export async function getCurrentShiftId(): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_shift");
  if (error) throw dbError("current_shift", error);
  return (data as string | null) ?? null;
}

export async function listWorkShifts(): Promise<WorkShift[]> {
  const { data, error } = await supabase
    .from("work_shifts")
    .select("id,code,label,checkin_start,distribution_start,checkout_time,position")
    .eq("active", true)
    .order("position");
  if (error) throw dbError("work_shifts", error);
  return (data ?? []) as WorkShift[];
}

/** Data usada pelo banco nas presenças e na fila; não depende do relógio do navegador. */
export async function getCurrentWorkDate(): Promise<string> {
  const { data, error } = await supabase.rpc("current_work_date");
  if (error) throw dbError("current_work_date", error);
  return data;
}

export async function listTodayCheckins(profileId: string): Promise<CheckinRecord[]> {
  const workDate = await getCurrentWorkDate();
  const { data, error } = await supabase
    .from("checkins")
    .select("id,shift_id,work_date,checked_in_at,checked_out_at,leads_received")
    .eq("profile_id", profileId)
    .eq("work_date", workDate);
  if (error) throw dbError("checkins", error);
  return (data ?? []) as CheckinRecord[];
}

/**
 * Fila do grupo de distribuição do corretor.
 *
 * `distribution_queue` recebe o grupo, então o grupo é resolvido antes. Um
 * corretor pode estar em mais de um grupo; devolvemos a fila de cada um, porque
 * a posição só faz sentido dentro do grupo que vai receber o lead.
 */
export async function getMyQueues(profileId: string): Promise<{ groupId: string; groupName: string; entries: QueueEntry[] }[]> {
  const { data: memberships, error: memberError } = await supabase
    .from("distribution_group_members")
    .select("group_id, distribution_groups(name)")
    .eq("profile_id", profileId)
    .eq("active", true);
  if (memberError) throw dbError("distribution_group_members", memberError);

  const groups = (memberships ?? []) as unknown as { group_id: string; distribution_groups: { name: string } | null }[];

  const results = await Promise.all(
    groups.map(async (g) => {
      const { data, error } = await supabase.rpc("distribution_queue", { p_group_id: g.group_id });
      if (error) throw dbError("distribution_queue", error);
      return {
        groupId: g.group_id,
        groupName: g.distribution_groups?.name ?? "Grupo",
        entries: (data ?? []) as QueueEntry[],
      };
    }),
  );
  return results;
}

export type LeadCounts = { today: number; week: number; month: number };

/**
 * Leads recebidos hoje / na semana / no mês (ata 23/07).
 *
 * Conta `lead_assignments`, não `leads`: o que interessa é quantos chegaram
 * para o corretor, incluindo os que ele perdeu por prazo. Contar `leads` por
 * `assigned_to` mostraria só o que ainda está com ele.
 *
 * O dia vem de `current_work_date()`, não do relógio do navegador: é a mesma
 * data que `assign_lead` e `checkins` usam. Com a meia-noite local, entre 21h e
 * meia-noite em Brasília o "hoje" da tela já era o dia anterior do banco e o
 * contador divergia do check-in (F13).
 */
export async function getLeadCounts(profileId: string): Promise<LeadCounts> {
  const workDate = await getCurrentWorkDate(); // "AAAA-MM-DD" na data do banco
  const dayStart = new Date(`${workDate}T00:00:00Z`);
  // Semana começa na segunda: é como a operação fala de "essa semana".
  const weekday = (dayStart.getUTCDay() + 6) % 7;
  const weekStart = new Date(dayStart);
  weekStart.setUTCDate(dayStart.getUTCDate() - weekday);
  const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));

  const countSince = async (since: Date) => {
    const { count, error } = await supabase
      .from("lead_assignments")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .gte("assigned_at", since.toISOString());
    if (error) throw dbError("lead_assignments", error);
    return count ?? 0;
  };

  const [today, week, month] = await Promise.all([
    countSince(dayStart),
    countSince(weekStart),
    countSince(monthStart),
  ]);
  return { today, week, month };
}

/** Confere se um IP está liberado para o usuário — usado pelo admin de IPs. */
export async function checkIpAllowed(ip: string, profileId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("ip_is_allowed", { candidate: ip, who: profileId });
  if (error) throw dbError("ip_is_allowed", error);
  return Boolean(data);
}
