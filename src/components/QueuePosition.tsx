import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListOrdered, Loader2, RefreshCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getMyQueues, type QueueEntry } from "@/integrations/supabase/checkin";
import { describeError } from "@/lib/supabaseError";

/**
 * A fila abre sozinha no horário de distribuição do turno, e nada muda em
 * `checkins` nem em `lead_assignments` nesse instante: sem releitura, quem
 * bateu ponto às 08:05 leria "a fila abre às 08:30" até um F5.
 */
const QUEUE_POLL_MS = 60_000;

type Props = {
  /** Presença aberta no turno vigente — quem sabe disso é a tela de check-in. */
  checkedIn: boolean;
  /** "HH:MM" em que a distribuição do turno vigente começa; null fora de turno. */
  opensAt?: string | null;
  /**
   * Check-in travado por leads atrasados (`checkin_eligibility`). A fila usa a
   * mesma trava (0014): quem estoura o limite depois de bater ponto sai dela, e
   * "a fila abre às HH:MM" seria mentira embaixo do banner de bloqueio.
   */
  blocked?: boolean;
};

/**
 * Posição do corretor na roleta (ata 23/07).
 *
 * Desde a 0014 a fila ordena pelo *fim* da última vez (`last_turn_at`), então
 * quem estoura o prazo cai para o fim — e é exatamente isso que este indicador
 * deixa visível. Sem ele, o corretor perde a vez e não entende por quê.
 *
 * A fila só existe a partir da distribuição do turno (`distribution_queue`
 * filtra por `now() >= distribution_start`). Entre o check-in e essa hora ela é
 * vazia para todo mundo, e a RPC não diz se o corretor bateu ponto — por isso
 * a tela de check-in informa `checkedIn`/`opensAt`: sem isso, quem acabara de
 * cumprir o requisito lia que "é preciso estar em check-in".
 *
 * Atualiza por realtime em `lead_assignments` (toda entrada e saída da roleta
 * passa por lá) e em `checkins` — é a presença que coloca o corretor na fila.
 */
export default function QueuePosition({ checkedIn, opensAt, blocked = false }: Props) {
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
      setError(describeError(e, "Não foi possível carregar sua posição na fila."));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // `checkedIn` nas dependências: a própria tela de check-in já sabe que a
  // presença mudou antes de o realtime avisar.
  useEffect(() => { void load(); }, [load, checkedIn]);

  useEffect(() => {
    const timer = setInterval(() => { void load(); }, QUEUE_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`queue-position-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${user.id}` }, () => void load())
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

  // Erro com saída: era um `<p>` sem nada para fazer, enquanto o resto do
  // sistema oferece "Tentar de novo". Falha de rede na hora do check-in deixava
  // o corretor sem saber a própria posição e sem como reconsultar, a não ser
  // recarregando a página inteira.
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-destructive">{error}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => { setLoading(true); void load(); }}
        >
          <RefreshCcw className="h-3 w-3" aria-hidden /> Tentar de novo
        </Button>
      </div>
    );
  }

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
          <div key={q.groupId} className="space-y-2 rounded-md border border-border/40 p-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <ListOrdered className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-medium">{q.groupName}:</span>
              {mine >= 0 ? (
                <Badge variant="default">
                  você é o {q.entries[mine].queue_position}º de {q.entries.length}
                </Badge>
              ) : !checkedIn ? (
                <span className="text-xs text-muted-foreground">
                  fora da fila agora — é preciso estar em check-in no turno
                </span>
              ) : q.entries.length === 0 && !blocked ? (
                <span className="text-xs text-muted-foreground">
                  check-in confirmado — a fila abre {opensAt ? `às ${opensAt}` : "no horário de distribuição do turno"}
                </span>
              ) : blocked ? (
                <span className="text-xs text-muted-foreground">
                  fora da fila: leads atrasados demais — regularize para voltar a receber
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  em check-in, mas fora da fila agora
                </span>
              )}
            </div>

            {/* A ordem aparecia sem o critério: o corretor perdia a posição e
                não entendia por quê. Desde a 0014 a fila ordena pelo FIM da
                última vez (`last_turn_at`), então deixar o prazo vencer conta
                como vez consumida — decisão de 30/07 com o cliente. */}
            <p className="text-xs text-muted-foreground">
              A vez é de quem está há mais tempo sem receber. Deixar o prazo de atendimento vencer
              conta como vez usada: o lead volta para a fila e você vai para o fim.
            </p>
            {q.entries.length > 0 && (
              <ol aria-label={`Fila ${q.groupName}`} className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {q.entries.map((entry) => {
                  const isMine = entry.profile_id === user?.id;
                  return (
                    <li key={entry.profile_id} className="flex items-center gap-2 rounded bg-secondary/40 px-2 py-1 text-xs">
                      <Badge variant={isMine ? "default" : "outline"} className="min-w-7 justify-center px-1.5">
                        {entry.queue_position}º
                      </Badge>
                      <span className="truncate">{entry.full_name}{isMine ? " (você)" : ""}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
