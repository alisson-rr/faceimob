import { useState } from "react";
import { LogIn, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { functionErrorMessage } from "@/lib/functionError";
import { useAuth } from "@/contexts/AuthContext";
import { useCheckinQueue } from "./data";

/**
 * Fila de atendimento — a mesma da tela `/checkin`, resumida.
 *
 * Estado local (só o "enviando"): a fila em si vem do `useQuery` com realtime,
 * porque quem muda a fila é a roleta no banco, não esta tela.
 *
 * Nenhum `celebrate("checkin")` aqui: o `EngagementLayer` já dispara o som e o
 * toast pelo INSERT em `checkins`. Chamar dos dois lados tocaria duas vezes.
 */
export function CheckinQueueBar() {
  const { user } = useAuth();
  const { data: queue = [], refetch } = useCheckinQueue();
  const [sending, setSending] = useState(false);

  const inQueue = Boolean(user?.id) && queue.some((row) => row.broker_id === user?.id);

  const invoke = async (action: "checkin" | "checkout") => {
    setSending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) throw new Error("Você precisa estar logado.");
      const { data, error } = await supabase.functions.invoke("broker-checkin", { body: { action } });
      if (error) throw new Error(await functionErrorMessage(error, "Falha no check-in"));
      const responseError = data && typeof data === "object" && "error" in data
        ? (data as { error?: unknown }).error
        : null;
      if (typeof responseError === "string" && responseError) throw new Error(responseError);
      await refetch();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Erro no check-in",
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" aria-hidden />
        <span>Fila: <span className="font-semibold tabular-nums text-foreground">{queue.length}</span></span>
        {queue.length > 0 && (
          <ul className="ml-1 flex -space-x-1.5" aria-label="Corretores na fila">
            {queue.slice(0, 5).map((row) => (
              <li
                key={row.id}
                title={`${row.name} · ${row.checkedInAt}`}
                className="grid h-6 w-6 place-items-center rounded-full border border-background bg-primary/20 text-xs font-bold text-primary"
              >
                <span aria-hidden>{row.name.charAt(0)}</span>
                <span className="sr-only">{row.name}</span>
              </li>
            ))}
            {queue.length > 5 && (
              <li className="grid h-6 w-6 place-items-center rounded-full border border-background bg-muted text-xs text-muted-foreground">
                +{queue.length - 5}
              </li>
            )}
          </ul>
        )}
      </div>

      {inQueue ? (
        <Button size="sm" variant="ghost" disabled={sending} onClick={() => void invoke("checkout")} className="h-7 text-xs text-destructive">
          <LogOut className="mr-1 h-3.5 w-3.5" /> {sending ? "Saindo…" : "Check-out"}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={sending} onClick={() => void invoke("checkin")} className="h-7 text-xs text-success">
          <LogIn className="mr-1 h-3.5 w-3.5" /> {sending ? "Entrando…" : "Check-in"}
        </Button>
      )}
    </div>
  );
}
