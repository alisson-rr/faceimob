import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared";
import QueuePosition from "@/components/QueuePosition";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  getCheckinEligibility,
  getCurrentShiftId,
  listTodayCheckins,
  listWorkShifts,
} from "@/integrations/supabase/checkin";
import { supabase } from "@/integrations/supabase/client";
import { functionErrorMessage } from "@/lib/functionError";

const POLL_MS = 60_000;
const hhmm = (value: string) => value.slice(0, 5);

/**
 * Presença e posição da roleta dentro da tela de Leads.
 *
 * Usa as mesmas RPCs e a mesma Edge Function da tela de Check-in: o card é só
 * uma porta mais curta para o corretor não precisar sair do quadro onde atende.
 */
export function LeadsCheckinCard() {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"checkin" | "checkout" | null>(null);

  const shifts = useQuery({ queryKey: ["checkin", "shifts"], queryFn: listWorkShifts });
  const currentShift = useQuery({
    queryKey: ["checkin", "current-shift"],
    queryFn: getCurrentShiftId,
    refetchInterval: POLL_MS,
  });
  const today = useQuery({
    queryKey: ["checkin", "today", userId],
    queryFn: () => listTodayCheckins(userId as string),
    enabled: Boolean(userId && role === "broker"),
  });
  const eligibility = useQuery({
    queryKey: ["checkin", "eligibility"],
    queryFn: getCheckinEligibility,
    enabled: Boolean(userId && role === "broker"),
    refetchInterval: POLL_MS,
  });

  useEffect(() => {
    if (!userId || role !== "broker") return;
    const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["checkin"] }); };
    const channel = supabase
      .channel(`leads-checkin-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments", filter: `profile_id=eq.${userId}` }, invalidate)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient, role, userId]);

  const activeShift = useMemo(
    () => (shifts.data ?? []).find((shift) => shift.id === currentShift.data) ?? null,
    [currentShift.data, shifts.data],
  );
  const activeCheckin = activeShift
    ? (today.data ?? []).find((record) => record.shift_id === activeShift.id && !record.checked_out_at)
    : null;
  const blocked = eligibility.data ? !eligibility.data.allowed : true;
  const loading = shifts.isPending || currentShift.isPending || today.isPending || eligibility.isPending;
  const error = shifts.error ?? currentShift.error ?? today.error ?? eligibility.error;

  if (role !== "broker") return null;

  const act = async (action: "checkin" | "checkout") => {
    if (action === "checkin" && blocked) {
      toast.error("Check-in bloqueado", { description: eligibility.data?.reason || "Regularize seus leads e tente de novo." });
      return;
    }
    setPending(action);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("broker-checkin", { body: { action } });
      if (invokeError) throw new Error(await functionErrorMessage(invokeError, "O servidor de check-in não respondeu."));
      const returned = (data as { error?: string } | null)?.error;
      if (returned) throw new Error(returned);
      toast.success(action === "checkin" ? "Check-in realizado — você entrou na fila" : "Check-out realizado");
      await queryClient.invalidateQueries({ queryKey: ["checkin"] });
    } catch (cause) {
      toast.error(action === "checkin" ? "Não foi possível fazer o check-in" : "Não foi possível fazer o check-out", {
        description: cause instanceof Error ? cause.message : "Tente de novo em instantes.",
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="rounded-2xl border border-primary/35 bg-primary/5 p-4" aria-labelledby="leads-checkin-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-primary" aria-hidden />
            <h2 id="leads-checkin-title" className="font-display text-sm font-bold">Seu turno e sua fila</h2>
            {activeCheckin ? (
              <StatusBadge tone="success" icon={ShieldCheck} className="animate-pulse">Check-in ativo</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Inativo</StatusBadge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {activeShift
              ? `${activeShift.label} · distribuição ${hhmm(activeShift.distribution_start)} · saída ${hhmm(activeShift.checkout_time)}`
              : "Nenhum turno de check-in está aberto agora."}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant={activeCheckin ? "outline" : "highlight"}
          disabled={loading || Boolean(error) || pending !== null || (!activeCheckin && (!activeShift || blocked))}
          onClick={() => void act(activeCheckin ? "checkout" : "checkin")}
          aria-busy={pending !== null}
        >
          {activeCheckin ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {pending ? "Aguarde…" : activeCheckin ? "Fazer check-out" : "Fazer check-in"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden /> Não consegui confirmar seu turno. Atualize a tela e tente de novo.
        </p>
      )}
      {!error && eligibility.data && blocked && (
        <p role="status" className="mt-3 flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {eligibility.data.reason}
        </p>
      )}

      {!error && !loading && (
        <div className="mt-3 border-t border-border/70 pt-3">
          <QueuePosition
            checkedIn={Boolean(activeCheckin)}
            opensAt={activeShift ? hhmm(activeShift.distribution_start) : null}
            blocked={blocked}
          />
        </div>
      )}
    </section>
  );
}
