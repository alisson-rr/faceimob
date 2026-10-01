import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getCheckinEligibility,
  getCurrentShiftId,
  listTodayCheckins,
  performBrokerPresence,
} from "@/integrations/supabase/checkin";
import { cn } from "@/lib/utils";

const REFRESH_MS = 60_000;

/**
 * Presença compacta para o funil de leads.
 *
 * O botão não inventa regra no navegador: turno, presença e bloqueio vêm do
 * banco, e a gravação passa pela mesma Edge Function da página /checkin. Assim
 * o corretor entra na roleta sem abandonar o contexto em que vai trabalhar.
 */
export function LeadCheckinButton() {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [checkingIn, setCheckingIn] = useState(false);

  const currentShift = useQuery({
    queryKey: ["checkin", "current-shift"],
    queryFn: getCurrentShiftId,
    refetchInterval: REFRESH_MS,
  });
  const today = useQuery({
    queryKey: ["checkin", "today", profileId],
    queryFn: () => listTodayCheckins(profileId as string),
    enabled: Boolean(profileId),
    refetchInterval: REFRESH_MS,
  });
  const eligibility = useQuery({
    queryKey: ["checkin", "eligibility"],
    queryFn: getCheckinEligibility,
    refetchInterval: REFRESH_MS,
  });

  useEffect(() => {
    if (!profileId) return;
    const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["checkin"] }); };
    const channel = supabase
      .channel(`lead-checkin-${profileId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${profileId}`,
      }, invalidate)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [profileId, queryClient]);

  const activeCheckin = (today.data ?? []).find((record) => !record.checked_out_at);
  const loading = currentShift.isPending || today.isPending || eligibility.isPending;
  const failed = currentShift.isError || today.isError || eligibility.isError;
  const blocked = eligibility.data ? !eligibility.data.allowed : true;
  const outsideShift = !currentShift.data;

  const checkin = async () => {
    if (loading || failed || activeCheckin || blocked || outsideShift) return;
    setCheckingIn(true);
    try {
      await performBrokerPresence("checkin");
      toast.success("Check-in confirmado", {
        description: "Você está ativo na roleta. Agora é hora de conduzir os leads até a conversão.",
      });
      await queryClient.invalidateQueries({ queryKey: ["checkin"] });
    } catch (error) {
      toast.error("Não foi possível fazer o check-in", {
        description: error instanceof Error ? error.message : "Tente de novo em instantes.",
      });
    } finally {
      setCheckingIn(false);
    }
  };

  if (activeCheckin) {
    return (
      <Button
        type="button"
        size="sm"
        variant="tintSuccess"
        className="relative overflow-hidden border-success/70 bg-success/15 disabled:opacity-100"
        disabled
        aria-label="Check-in ativo: você está na roleta"
      >
        <span className="absolute inset-0 bg-success/10 motion-safe:animate-pulse" aria-hidden />
        <CheckCircle2 className="relative h-4 w-4 text-success" />
        <span className="relative">Check-in ativo</span>
        <span className="relative h-2 w-2 rounded-full bg-success shadow-[0_0_10px_hsl(var(--success))] motion-safe:animate-pulse" aria-hidden />
      </Button>
    );
  }

  const reason = loading
    ? "Verificando sua presença e o turno atual."
    : failed
      ? "Não foi possível consultar seu check-in."
    : outsideShift && !loading
      ? "Fora da janela de check-in."
      : blocked
        ? eligibility.data?.reason || "Check-in bloqueado."
        : "Faça check-in para entrar na roleta.";

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant={blocked || failed ? "outline" : "highlight"}
        className={cn(
          !loading && !blocked && !outsideShift && !failed && "motion-safe:animate-pulse",
          (blocked || failed) && "border-destructive/40 text-destructive",
        )}
        disabled={loading || checkingIn || blocked || outsideShift || failed}
        aria-busy={loading || checkingIn}
        aria-describedby="lead-checkin-status"
        onClick={() => void checkin()}
      >
        {loading || checkingIn ? <Loader2 className="h-4 w-4 animate-spin" />
          : blocked || failed ? <AlertTriangle className="h-4 w-4" />
            : <LogIn className="h-4 w-4" />}
        {loading ? "Verificando check-in…" : checkingIn ? "Fazendo check-in…" : "Fazer check-in"}
      </Button>
      <span id="lead-checkin-status" className={cn(
        "max-w-64 text-xs leading-tight",
        blocked || failed ? "text-destructive" : "text-muted-foreground",
      )}>
        {reason}
      </span>
    </div>
  );
}
