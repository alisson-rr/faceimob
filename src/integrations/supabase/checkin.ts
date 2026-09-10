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
  /** `true` quando quem encerrou foi o cron do fim do turno, não o corretor. */
  auto_checkout: boolean;
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
    .select("id,shift_id,work_date,checked_in_at,checked_out_at,auto_checkout,leads_received")
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
 * Fuso do dia operacional. America/Sao_Paulo é UTC-3 fixo desde o fim do
 * horário de verão (2019) — o mesmo deslocamento que `current_work_date()`,
 * `current_shift()` e `auto_checkout_expired` usam no banco.
 */
const SAO_PAULO_UTC_OFFSET = "-03:00";

/**
 * Início do dia / da semana / do mês a partir do dia operacional do banco.
 *
 * `new Date("AAAA-MM-DDT00:00:00Z")` seria meia-noite UTC, que é 21:00 do dia
 * ANTERIOR em Brasília: o "hoje" do contador pegaria as três últimas horas do
 * turno da noite de ontem, todo dia. `current_work_date()` devolve a data de
 * São Paulo (0057), então a hora zero dela também tem de ser a de São Paulo.
 *
 * A semana começa na segunda — é como a operação fala de "essa semana".
 */
export function leadCountWindows(workDate: string): { day: Date; week: Date; month: Date } {
  const day = new Date(`${workDate}T00:00:00${SAO_PAULO_UTC_OFFSET}`);
  // Meia-noite em SP é 03:00 UTC do MESMO dia, então os componentes `getUTC*`
  // continuam sendo os do dia operacional.
  const week = new Date(day);
  week.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const month = new Date(`${workDate.slice(0, 8)}01T00:00:00${SAO_PAULO_UTC_OFFSET}`);
  return { day, week, month };
}

/**
 * Leads recebidos hoje / na semana / no mês (ata 23/07).
 *
 * Conta `lead_assignments`, não `leads`: o que interessa é quantos chegaram
 * para o corretor, incluindo os que ele perdeu por prazo. Contar `leads` por
 * `assigned_to` mostraria só o que ainda está com ele.
 *
 * O dia vem de `current_work_date()`, não do relógio do navegador: é a mesma
 * data que `assign_lead` e `checkins` usam.
 */
export async function getLeadCounts(profileId: string): Promise<LeadCounts> {
  const workDate = await getCurrentWorkDate(); // "AAAA-MM-DD" na data do banco
  const { day: dayStart, week: weekStart, month: monthStart } = leadCountWindows(workDate);

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

export type IpCoverage = {
  /** O que `ip_is_allowed` responde para este perfil (faixa OU bypass). */
  allowed: boolean;
  /** `profiles.bypass_ip_check` do perfil: com ele ligado, `allowed` é true para qualquer IP. */
  bypass: boolean;
};

/**
 * Confere se um IP está liberado para o usuário — usado pelo admin de IPs.
 *
 * `ip_is_allowed` curto-circuita no bypass individual do perfil antes de olhar
 * faixa nenhuma, então um admin com bypass via "coberto por faixa" para todo
 * IP e saía sem cadastrar o da loja. A flag volta junto para a tela dizer a
 * verdade: com bypass, o teste não prova nada sobre faixas.
 */
export type BypassProfile = { id: string; full_name: string; email: string | null };

/**
 * Quem está dispensado da trava de IP.
 *
 * A liberação individual (`profiles.bypass_ip_check`) é a exceção à regra
 * antifraude da ata de 14/07: com ela ligada, `ip_is_allowed` devolve true para
 * QUALQUER endereço. Até aqui a coluna não tinha tela nenhuma — liberar um
 * corretor de IP dinâmico exigia um UPDATE direto no banco — e, pior, ninguém
 * conseguia ver quem já estava dispensado.
 */
export async function listIpBypassProfiles(): Promise<BypassProfile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,email")
    .eq("bypass_ip_check", true)
    .order("full_name");
  if (error) throw dbError("profiles.bypass_ip_check", error);
  return (data ?? []) as BypassProfile[];
}

/**
 * Liga/desliga a liberação individual de IP.
 *
 * O gatilho `profiles_guard_admin_columns` (0012) recusa esta coluna para quem
 * não é admin — inclusive para o gestor do perfil. Um UPDATE barrado por RLS,
 * porém, volta 204 sem erro: por isso o retorno é conferido linha a linha, em
 * vez de confiar na ausência de `error`.
 */
export async function setIpBypass(profileId: string, enabled: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ bypass_ip_check: enabled })
    .eq("id", profileId)
    .select("id,bypass_ip_check")
    .maybeSingle();
  if (error) throw dbError("profiles.bypass_ip_check", error);
  if (!data || data.bypass_ip_check !== enabled) {
    throw new Error("A alteração não foi gravada — só o administrador libera a validação de IP.");
  }
}

export type ObservedIp = {
  ip: string;
  /** `true` quando o endereço tem `:` — a única distinção que a tela precisa. */
  ipv6: boolean;
  checkins: number;
  lastSeen: string;
};

/** Quantas presenças recentes a agregação olha. */
const OBSERVED_LIMIT = 500;

/**
 * Endereços que o SERVIDOR de fato gravou nos check-ins recentes.
 *
 * A tela de faixas descobre o IP do admin por `api.ipify.org`, que responde só
 * em IPv4, enquanto quem decide é o gateway: se ele enxergar o corretor em
 * IPv6, a faixa v4 cadastrada nunca casa e a tela ainda diz "já coberto". Aqui
 * a fonte é `checkins.ip_address`, preenchido por `perform_checkin` com o
 * endereço que a edge function leu do cabeçalho — é a única resposta que não
 * depende de serviço externo nem de suposição sobre a hospedagem.
 *
 * Todo endereço desta lista foi ACEITO no momento do check-in (a RPC recusa IP
 * não autorizado): um endereço aqui que não esteja coberto por nenhuma faixa
 * entrou pela liberação individual (`bypass_ip_check`).
 */
export async function listObservedCheckinIps(): Promise<ObservedIp[]> {
  const { data, error } = await supabase
    .from("checkins")
    .select("ip_address,checked_in_at")
    .not("ip_address", "is", null)
    .order("checked_in_at", { ascending: false })
    .limit(OBSERVED_LIMIT);
  if (error) throw dbError("checkins.ip_address", error);
  return groupObservedIps((data ?? []) as { ip_address: string | null; checked_in_at: string }[]);
}

/**
 * Agrupa as presenças por endereço. Separado da consulta para ser testável.
 *
 * Não confia na ordem que veio do banco: o `lastSeen` é o MAIOR `checked_in_at`
 * de cada endereço, não o primeiro que apareceu na página.
 */
export function groupObservedIps(
  rows: { ip_address: string | null; checked_in_at: string }[],
): ObservedIp[] {
  const porIp = new Map<string, ObservedIp>();
  for (const { ip_address: ip, checked_in_at: quando } of rows) {
    if (!ip) continue;
    const atual = porIp.get(ip);
    if (atual) {
      atual.checkins += 1;
      if (quando > atual.lastSeen) atual.lastSeen = quando;
      continue;
    }
    porIp.set(ip, { ip, ipv6: ip.includes(":"), checkins: 1, lastSeen: quando });
  }
  return [...porIp.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export async function checkIpAllowed(ip: string, profileId: string): Promise<IpCoverage> {
  const [allowed, profile] = await Promise.all([
    supabase.rpc("ip_is_allowed", { candidate: ip, who: profileId }),
    // A policy `profiles_select` libera o próprio perfil.
    supabase.from("profiles").select("bypass_ip_check").eq("id", profileId).maybeSingle(),
  ]);
  if (allowed.error) throw dbError("ip_is_allowed", allowed.error);
  if (profile.error) throw dbError("profiles.bypass_ip_check", profile.error);
  return { allowed: Boolean(allowed.data), bypass: Boolean(profile.data?.bypass_ip_check) };
}
