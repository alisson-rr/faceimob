import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Atividades (`tasks`) e visitas (`visits`).
 *
 * As duas tabelas existiam desde a 0011/0006 sem nenhuma tela. `tasks` importa
 * além da agenda: o trigger `tasks_sync_lead_deadline` liga o prazo da atividade
 * ao `next_action_at` do lead, que é o que `overdue_lead_count()` conta — ou
 * seja, atividade vencida entra no bloqueio de check-in dos 20 atrasados.
 */

export type TaskStatus = "open" | "done" | "cancelled";
export type TaskPriority = "low" | "normal" | "high";
export type TaskRefType = "lead" | "deal" | "cca_case";

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string | null;
  created_by: string | null;
  due_at: string | null;
  completed_at: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  ref_type: TaskRefType | null;
  ref_id: string | null;
  created_at: string;
};

const TASK_COLUMNS =
  "id,title,description,assigned_to,created_by,due_at,completed_at,status,priority,ref_type,ref_id,created_at";

export async function listTasksFor(refType: TaskRefType, refId: string): Promise<TaskRecord[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("ref_type", refType)
    .eq("ref_id", refId)
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw dbError("tasks", error);
  return (data ?? []) as TaskRecord[];
}

/** Minhas atividades em aberto, das mais vencidas para as mais distantes. */
export async function listMyOpenTasks(profileId: string): Promise<TaskRecord[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("assigned_to", profileId)
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw dbError("tasks", error);
  return (data ?? []) as TaskRecord[];
}

export type CreateTaskInput = {
  title: string;
  description?: string;
  assignedTo: string;
  dueAt: string | null;
  priority: TaskPriority;
  refType: TaskRefType;
  refId: string;
};

export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title: input.title,
      description: input.description || null,
      assigned_to: input.assignedTo,
      created_by: auth.user?.id ?? null,
      due_at: input.dueAt,
      priority: input.priority,
      ref_type: input.refType,
      ref_id: input.refId,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw dbError("criar atividade", error);
  return data as TaskRecord;
}

/**
 * `tasks_done_consistency` exige que `status = 'done'` e `completed_at` andem
 * juntos — mudar só um dos dois derruba a constraint.
 */
export async function setTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status, completed_at: status === "done" ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw dbError("atualizar atividade", error);
}

export const isTaskOverdue = (task: TaskRecord, now: Date = new Date()) =>
  task.status === "open" && task.due_at !== null && new Date(task.due_at) < now;

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta" };
export const TASK_REF_LABEL: Record<TaskRefType, string> = { lead: "Lead", deal: "Negócio", cca_case: "Caso CCA" };

export type TaskWithAssignee = TaskRecord & { assignee_name: string | null };

/**
 * Atividades em aberto que o usuário enxerga. Quem recorta é o RLS de `tasks`
 * (`assigned_to` em `auth_visible_profiles()` ou `created_by = auth.uid()`):
 * o corretor recebe as dele, gerente e diretor recebem as da equipe. Nenhum
 * filtro de papel aqui, para a hierarquia continuar mudando em um lugar só.
 *
 * `tasks` tem duas FKs para `profiles` (`assigned_to` e `created_by`); sem o
 * nome da constraint o PostgREST recusa o embed por ambiguidade.
 */
export async function listOpenTasksVisible(): Promise<TaskWithAssignee[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(`${TASK_COLUMNS},assignee:profiles!tasks_assigned_to_fkey(full_name)`)
    .eq("status", "open")
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw dbError("tasks", error);
  const rows = (data ?? []) as unknown as (TaskRecord & { assignee: { full_name: string } | null })[];
  return rows.map(({ assignee, ...task }) => ({ ...task, assignee_name: assignee?.full_name ?? null }));
}

export type DueBucket = "atrasadas" | "hoje" | "semana" | "depois" | "sem_prazo";

/** Ordem em que a agenda mostra as faixas. */
export const DUE_BUCKETS: { id: DueBucket; label: string }[] = [
  { id: "atrasadas", label: "Atrasadas" },
  { id: "hoje", label: "Vencem hoje" },
  { id: "semana", label: "Próximos 7 dias" },
  { id: "depois", label: "Depois" },
  { id: "sem_prazo", label: "Sem prazo" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Faixa de prazo de uma atividade. "Hoje" vai até 23:59:59 no fuso do
 * navegador — quem marca compromisso pensa em dia de calendário, não em 24 h
 * contadas a partir de agora. Os 7 dias são inclusivos.
 */
export function dueBucket(dueAt: string | null, now: Date = new Date()): DueBucket {
  if (!dueAt) return "sem_prazo";
  const due = new Date(dueAt).getTime();
  if (due < now.getTime()) return "atrasadas";
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - 1;
  if (due <= endOfToday) return "hoje";
  if (due <= now.getTime() + 7 * DAY_MS) return "semana";
  return "depois";
}

export function groupTasksByDue<T extends { due_at: string | null }>(
  tasks: T[],
  now: Date = new Date(),
): Record<DueBucket, T[]> {
  const groups: Record<DueBucket, T[]> = { atrasadas: [], hoje: [], semana: [], depois: [], sem_prazo: [] };
  for (const task of tasks) groups[dueBucket(task.due_at, now)].push(task);
  return groups;
}

// -----------------------------------------------------------------------------
// Visitas
// -----------------------------------------------------------------------------

export type VisitResult = "scheduled" | "completed" | "no_show" | "cancelled";

export type VisitRecord = {
  id: string;
  deal_id: string | null;
  lead_id: string | null;
  broker_id: string | null;
  scheduled_at: string;
  performed_at: string | null;
  result: VisitResult;
  notes: string | null;
};

export const VISIT_RESULT_LABEL: Record<VisitResult, string> = {
  scheduled: "Agendada",
  completed: "Realizada",
  no_show: "Não compareceu",
  cancelled: "Cancelada",
};

const VISIT_COLUMNS = "id,deal_id,lead_id,broker_id,scheduled_at,performed_at,result,notes";

export async function listVisitsFor(ref: { leadId?: string; dealId?: string }): Promise<VisitRecord[]> {
  let query = supabase.from("visits").select(VISIT_COLUMNS);
  if (ref.leadId) query = query.eq("lead_id", ref.leadId);
  else if (ref.dealId) query = query.eq("deal_id", ref.dealId);
  else return [];
  const { data, error } = await query.order("scheduled_at", { ascending: false });
  if (error) throw dbError("visits", error);
  return (data ?? []) as VisitRecord[];
}

export async function scheduleVisit(input: {
  leadId?: string;
  dealId?: string;
  brokerId: string;
  scheduledAt: string;
  notes?: string;
}): Promise<VisitRecord> {
  const { data, error } = await supabase
    .from("visits")
    .insert({
      lead_id: input.leadId ?? null,
      deal_id: input.dealId ?? null,
      broker_id: input.brokerId,
      scheduled_at: input.scheduledAt,
      notes: input.notes || null,
    })
    .select(VISIT_COLUMNS)
    .single();
  if (error) throw dbError("agendar visita", error);
  return data as VisitRecord;
}

/** Fecha a visita. `performed_at` só faz sentido quando ela aconteceu. */
export async function setVisitResult(id: string, result: VisitResult, notes?: string): Promise<void> {
  const { error } = await supabase
    .from("visits")
    .update({
      result,
      performed_at: result === "completed" ? new Date().toISOString() : null,
      ...(notes !== undefined ? { notes: notes || null } : {}),
    })
    .eq("id", id);
  if (error) throw dbError("atualizar visita", error);
}
