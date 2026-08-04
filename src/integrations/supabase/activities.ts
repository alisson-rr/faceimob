import { supabase } from "./client";

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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
}

export const isTaskOverdue = (task: TaskRecord, now: Date = new Date()) =>
  task.status === "open" && task.due_at !== null && new Date(task.due_at) < now;

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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
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
  if (error) throw new Error(error.message);
}
