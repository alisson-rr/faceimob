import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, Check, Loader2, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  createTask,
  isTaskOverdue,
  listTasksFor,
  setTaskStatus,
  type TaskPriority,
  type TaskRecord,
  type TaskRefType,
} from "@/integrations/supabase/activities";
import { describeError } from "@/lib/supabaseError";

type Props = {
  refType: TaskRefType;
  refId: string;
  /** Responsável padrão da atividade — normalmente o dono do lead/negócio. */
  defaultAssignee?: string | null;
};

const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Baixa", normal: "Normal", high: "Alta" };

const formatDue = (v: string | null) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "sem prazo");

/**
 * Atividades com vencimento (ata 14/07).
 *
 * O prazo não é só lembrete: `tasks_sync_lead_deadline` propaga `due_at` para o
 * `next_action_at` do lead, e é isso que `overdue_lead_count()` conta no
 * bloqueio de check-in. Atividade esquecida vira trava de roleta.
 */
export default function TaskPanel({ refType, refId, defaultAssignee }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasksFor(refType, refId));
    } catch (e) {
      toast({
        title: "Falha ao carregar atividades",
        description: describeError(e, "Não foi possível carregar as atividades."),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [refType, refId, toast]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const t = title.trim();
    if (!t) return toast({ title: "Descreva a atividade", variant: "destructive" });
    const assignee = defaultAssignee || user?.id;
    if (!assignee) return toast({ title: "Sem responsável definido", variant: "destructive" });

    setBusy("new");
    try {
      await createTask({
        title: t,
        assignedTo: assignee,
        // datetime-local não traz fuso; o navegador interpreta como hora local,
        // que é o que o corretor digitou.
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        priority,
        refType,
        refId,
      });
      setTitle(""); setDueAt(""); setPriority("normal");
      await load();
      toast({ title: "Atividade criada" });
    } catch (e) {
      toast({
        title: "Não foi possível criar",
        description: describeError(e, "Não foi possível criar a atividade."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const change = async (task: TaskRecord, status: "done" | "cancelled") => {
    setBusy(task.id);
    try {
      await setTaskStatus(task.id, status);
      await load();
    } catch (e) {
      toast({
        title: "Não foi possível atualizar",
        description: describeError(e, "Não foi possível mudar o status da atividade."),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const open = tasks.filter((t) => t.status === "open");
  const closed = tasks.filter((t) => t.status !== "open");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-primary" />
        <p className="text-sm font-bold">Atividades</p>
        {open.some((t) => isTaskOverdue(t)) && (
          <Badge variant="destructive">
            {open.filter((t) => isTaskOverdue(t)).length} vencida(s)
          </Badge>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-2">
        <Input
          placeholder="Ex: retornar ligação"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-8 text-xs"
          aria-label="Título da atividade"
        />
        <Input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="h-8 text-xs md:w-52"
          aria-label="Prazo da atividade"
        />
        <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
          <SelectTrigger className="h-8 text-xs md:w-32" aria-label="Prioridade"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
              <SelectItem key={p} value={p} className="text-xs">{PRIORITY_LABEL[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={add} disabled={busy === "new"} className="h-8 text-xs gap-1">
          {busy === "new" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Criar
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
        </div>
      ) : (
        <div className="space-y-1">
          {open.length === 0 && closed.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Nenhuma atividade registrada.</p>
          )}
          {[...open, ...closed].map((t) => {
            const overdue = isTaskOverdue(t);
            return (
              <div
                key={t.id}
                className={`flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs ${
                  t.status !== "open" ? "opacity-60 border-border/30" : overdue ? "border-destructive/50 bg-destructive/5" : "border-border/50"
                }`}
              >
                <span className="truncate">
                  <span className={t.status === "done" ? "line-through" : ""}>{t.title}</span>
                  <span className={`ml-2 ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                    {formatDue(t.due_at)}
                  </span>
                  {t.priority !== "normal" && (
                    <Badge variant="outline" size="sm" className="ml-1">{PRIORITY_LABEL[t.priority]}</Badge>
                  )}
                </span>
                {t.status === "open" && (
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => change(t, "done")}
                      disabled={busy === t.id}
                      aria-label={`Concluir ${t.title}`}
                      className="text-success hover:text-success"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => change(t, "cancelled")}
                      disabled={busy === t.id}
                      aria-label={`Cancelar ${t.title}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
