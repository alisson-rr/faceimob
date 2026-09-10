import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarCheck, CalendarClock, CalendarDays, CalendarX2, Check, Inbox, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, KpiCard, LoadingState, PageHeader, SectionCard } from "@/components/shared";
import { useAuth } from "@/contexts/AuthContext";
import { dateTime, num } from "@/lib/format";
import { resolveLink } from "@/lib/notificationLink";
import { describeError } from "@/lib/supabaseError";
import {
  DUE_BUCKETS,
  groupTasksByDue,
  listOpenTasksVisible,
  setTaskStatus,
  TASK_PRIORITY_LABEL,
  TASK_REF_LABEL,
  type TaskStatus,
  type TaskWithAssignee,
} from "@/integrations/supabase/activities";

const QUERY_KEY = ["tasks", "open"];
const ALL = "all";
/** Quem enxerga a equipe pelo RLS ganha o filtro por pessoa. */
const TEAM_ROLES = ["admin", "director", "manager", "partner"];

/**
 * Só lead tem destino que abre o registro (`/leads?lead=`, tratado em Leads.tsx).
 * Pipeline e CCA não leem query string, então negócio e caso ficam só no rótulo:
 * link para a lista genérica fingiria abrir o negócio.
 */
const refLink = (task: TaskWithAssignee): string | null =>
  task.ref_type === "lead" && task.ref_id ? resolveLink(`/leads/${task.ref_id}`) : null;

/**
 * Agenda: o que a pessoa marcou dentro de um lead ou negócio e ainda não fez.
 *
 * "Atividade vencida" aqui é compromisso da pessoa (CONTEXT.md), não o lead
 * vencido da roleta. Nada acontece sozinho quando vence — o valor da tela é
 * alguém ver que venceu. Criar continua dentro do lead/negócio (`TaskPanel`).
 */
export default function Activities() {
  const { roles } = useAuth();
  const queryClient = useQueryClient();
  const [assignee, setAssignee] = useState(ALL);
  const [busy, setBusy] = useState<string | null>(null);

  const tasksQuery = useQuery({ queryKey: QUERY_KEY, queryFn: listOpenTasksVisible });
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const canFilter = roles.some((role) => TEAM_ROLES.includes(role));

  // Lista de responsáveis sai das próprias atividades carregadas: sem consulta
  // extra, e nunca oferece alguém cujas atividades o RLS não entregaria.
  const assignees = useMemo(() => {
    const byId = new Map<string, string>();
    for (const task of tasks) if (task.assigned_to) byId.set(task.assigned_to, task.assignee_name ?? "Sem nome");
    return [...byId]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [tasks]);

  const visible = assignee === ALL ? tasks : tasks.filter((task) => task.assigned_to === assignee);
  const groups = groupTasksByDue(visible);

  const change = async (task: TaskWithAssignee, status: TaskStatus) => {
    setBusy(task.id);
    try {
      await setTaskStatus(task.id, status);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(status === "done" ? "Atividade concluída" : "Atividade cancelada");
    } catch (error) {
      toast.error(describeError(error, "Não foi possível atualizar a atividade."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Atividades"
        eyebrow="Agenda"
        icon={CalendarClock}
        description="Compromissos em aberto marcados dentro de um lead ou de um negócio."
        actions={
          canFilter && assignees.length > 0 ? (
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Responsável">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os responsáveis</SelectItem>
                {assignees.map((person) => (
                  <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />

      {tasksQuery.error ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar as atividades"
          description={describeError(tasksQuery.error, "o servidor não respondeu; verifique a conexão e tente de novo")}
          action={
            <Button disabled={tasksQuery.isFetching} onClick={() => void tasksQuery.refetch()}>
              {tasksQuery.isFetching ? "Tentando…" : "Tentar de novo"}
            </Button>
          }
        />
      ) : tasksQuery.isPending ? (
        <LoadingState variant="kpi" rows={3} label="Carregando atividades…" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              label="Atrasadas"
              value={num(groups.atrasadas.length)}
              icon={CalendarX2}
              variant={groups.atrasadas.length > 0 ? "highlight" : "default"}
            />
            <KpiCard label="Vencem hoje" value={num(groups.hoje.length)} icon={CalendarCheck} />
            <KpiCard label="Próximos 7 dias" value={num(groups.semana.length)} icon={CalendarDays} />
          </div>

          {tasks.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nenhuma atividade em aberto"
              description="Atividade se cria dentro do lead ou do negócio, na aba Agenda."
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nenhuma atividade para este responsável"
              action={<Button variant="outline" onClick={() => setAssignee(ALL)}>Ver todos</Button>}
            />
          ) : (
            DUE_BUCKETS.filter((bucket) => groups[bucket.id].length > 0).map((bucket) => (
              <SectionCard
                key={bucket.id}
                title={bucket.label}
                description={`${num(groups[bucket.id].length)} atividade(s)`}
                flush
              >
                <ul className="divide-y divide-border">
                  {groups[bucket.id].map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      overdue={bucket.id === "atrasadas"}
                      busy={busy === task.id}
                      onChange={change}
                    />
                  ))}
                </ul>
              </SectionCard>
            ))
          )}
        </>
      )}
    </div>
  );
}

function TaskRow({
  task,
  overdue,
  busy,
  onChange,
}: {
  task: TaskWithAssignee;
  overdue: boolean;
  busy: boolean;
  onChange: (task: TaskWithAssignee, status: TaskStatus) => void;
}) {
  const link = refLink(task);
  const refLabel = task.ref_type ? TASK_REF_LABEL[task.ref_type] : null;

  return (
    <li
      className={`flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between ${
        overdue ? "bg-destructive/5" : ""
      }`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 break-words text-sm font-semibold text-foreground">{task.title}</p>
          {task.priority !== "normal" && (
            <Badge
              variant="outline"
              size="sm"
              className={task.priority === "high" ? "border-warning text-warning" : ""}
            >
              {TASK_PRIORITY_LABEL[task.priority]}
            </Badge>
          )}
        </div>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{task.assignee_name ?? "Sem responsável"}</span>
          <span className={overdue ? "font-semibold text-destructive" : ""}>
            {task.due_at ? `Prazo ${dateTime(task.due_at)}` : "Sem prazo"}
          </span>
          {refLabel &&
            (link ? (
              <Link to={link} className="text-primary hover:underline">{refLabel}</Link>
            ) : (
              <span>{refLabel}</span>
            ))}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-success hover:text-success"
          disabled={busy}
          aria-label={`Concluir ${task.title}`}
          onClick={() => onChange(task, "done")}
        >
          <Check />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          disabled={busy}
          aria-label={`Cancelar ${task.title}`}
          onClick={() => onChange(task, "cancelled")}
        >
          <X />
        </Button>
      </div>
    </li>
  );
}
