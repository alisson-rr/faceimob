import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ListOrdered, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getMyQueues, type QueueEntry } from "@/integrations/supabase/checkin";

/**
 * Posição do corretor na roleta (ata 23/07).
 *
 * Desde a 0014 a fila ordena pelo *fim* da última vez (`last_turn_at`), então
 * quem estoura o prazo cai para o fim — e é exatamente isso que este indicador
 * deixa visível. Sem ele, o corretor perde a vez e não entende por quê.
 *
 * Atualiza por realtime em `lead_assignments`: toda entrada e saída da roleta
 * passa por lá, então é o gatilho certo — mais barato que polling e não perde
 * evento como um intervalo fixo perderia.
 */
export default function QueuePosition() {
  const { user } = useAuth();
  const [queues, setQueues] = useState<{ groupId: string; groupName: string; entries: QueueEntry[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      setQueues(await getMyQueues(user.id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao ler a fila");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`queue-position-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments" }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Consultando a fila...
      </div>
    );
  }

  if (error) return <p className="text-xs text-destructive">{error}</p>;

  if (queues.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Você não está em nenhum grupo de distribuição.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {queues.map((q) => {
        const mine = q.entries.findIndex((e) => e.profile_id === user?.id);
        return (
          <div key={q.groupId} className="flex items-center gap-2 flex-wrap">
            <ListOrdered className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-medium">{q.groupName}:</span>
            {mine >= 0 ? (
              <Badge variant="default" className="text-[11px]">
                você é o {q.entries[mine].queue_position}º de {q.entries.length}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                fora da fila agora — é preciso estar em check-in no turno
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
