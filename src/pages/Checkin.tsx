import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Clock, LogIn, LogOut, Rocket, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from "@/components/shared";
import QueuePosition from "@/components/QueuePosition";
import LeadCounter from "@/components/LeadCounter";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { describeError } from "@/lib/supabaseError";
import { functionErrorMessage } from "@/lib/functionError";
import { num } from "@/lib/format";
import {
  getCheckinEligibility, getCurrentShiftId, getLeadCounts,
  listTodayCheckins, listWorkShifts,
} from "@/integrations/supabase/checkin";

const hhmm = (time: string) => time.slice(0, 5);

/** O turno vira sozinho: sem releitura o botão fica travado até um F5. */
const SHIFT_POLL_MS = 60_000;

/**
 * `broker-checkin` repassa as mensagens em pt-BR das nossas `raise exception`
 * (`perform_checkin`/`perform_checkout`). Só os dois sentinelas dela vêm em
 * inglês e não podem chegar assim ao corretor.
 */
const FUNCTION_ERRORS: Record<string, string> = {
  unauthorized: "Sua sessão expirou. Entre novamente.",
  unknown: "Não foi possível concluir a ação. Tente de novo.",
};
const translateFunctionError = (message: string) => FUNCTION_ERRORS[message] ?? message;

const incentives = [
  "Boa! Agora é atacar cada lead como se fosse o próximo contrato assinado. 🚀",
  "Check-in confirmado! Velocidade no primeiro contato = mais vendas. ⚡",
  "Você está na fila! Atenda rápido, escute com atenção e conduza até a visita. 🏆",
  "Bora! Cada lead tratado hoje é um passo a mais rumo à sua meta. 💪",
];

/**
 * Check-in do corretor.
 *
 * O turno vigente e a elegibilidade vêm do banco (`current_shift()` e
 * `checkin_eligibility()`), não de cálculo no cliente: a função respeita o fuso
 * America/Sao_Paulo e bloqueia com `>= overdue_block_threshold`. No limite exato
 * a tela liberava o botão e o servidor recusava.
 *
 * Nada de `celebrate()` aqui: o `EngagementLayer` já comemora o INSERT em
 * `checkins` por realtime. Chamar direto tocaria o som duas vezes.
 */
export default function Checkin() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [incentive, setIncentive] = useState("");

  const shifts = useQuery({ queryKey: ["checkin", "shifts"], queryFn: listWorkShifts });
  const today = useQuery({
    queryKey: ["checkin", "today", userId],
    queryFn: () => listTodayCheckins(userId as string),
    enabled: Boolean(userId),
  });
  const currentShift = useQuery({
    queryKey: ["checkin", "current-shift"],
    queryFn: getCurrentShiftId,
    refetchInterval: SHIFT_POLL_MS,
  });
  const eligibility = useQuery({
    queryKey: ["checkin", "eligibility"],
    queryFn: getCheckinEligibility,
    refetchInterval: SHIFT_POLL_MS,
  });
  const counts = useQuery({
    queryKey: ["checkin", "counts", userId],
    queryFn: () => getLeadCounts(userId as string),
    enabled: Boolean(userId),
  });

  /**
   * F12 — a tela precisa acompanhar o banco sem F5.
   *
   * `lead_assignments` porque o lead cai pela roleta sem nenhuma ação aqui; e
   * `checkins` porque a presença muda por fora (check-out automático no fim do
   * turno, outra aba, outro dispositivo). Sem o segundo, o corretor continuava
   * vendo "Fazer check-in" depois de já ter batido ponto em outro lugar.
   */
  useEffect(() => {
    if (!userId) return;
    const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["checkin"] }); };
    const channel = supabase
      .channel(`checkin-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lead_assignments", filter: `profile_id=eq.${userId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkins", filter: `profile_id=eq.${userId}` }, invalidate)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, queryClient]);

  const shiftList = shifts.data ?? [];
  const activeShift = shiftList.find((shift) => shift.id === currentShift.data) ?? null;
  const activeCheckin = activeShift
    ? (today.data ?? []).find((record) => record.shift_id === activeShift.id && !record.checked_out_at)
    : undefined;
  const blocked = eligibility.data ? !eligibility.data.allowed : true;

  const loadError = shifts.error ?? today.error ?? currentShift.error ?? eligibility.error ?? counts.error;
  const isLoading = shifts.isPending || currentShift.isPending || eligibility.isPending;

  const action = async (act: "checkin" | "checkout") => {
    if (act === "checkin" && blocked) {
      toast.error(eligibility.data?.reason || "Check-in bloqueado.");
      return;
    }
    setPending(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session) throw new Error("Você precisa estar logado. Faça login novamente.");
      const { data, error } = await supabase.functions.invoke("broker-checkin", { body: { action: act } });
      // A mensagem útil vem no corpo da resposta da function, não no error.message.
      if (error) {
        throw new Error(translateFunctionError(
          await functionErrorMessage(error, "Não foi possível falar com o servidor de check-in."),
        ));
      }
      const returned = (data as { error?: string } | null)?.error;
      if (returned) throw new Error(translateFunctionError(returned));
      if (act === "checkin") {
        setIncentive(incentives[Math.floor(Math.random() * incentives.length)]);
        setConfirmOpen(true);
      } else {
        toast.success("Check-out realizado!");
      }
      await queryClient.invalidateQueries({ queryKey: ["checkin"] });
    } catch (err) {
      // Tudo que chega aqui já é texto nosso em pt-BR (function ou RPC).
      toast.error(err instanceof Error ? err.message : "Não foi possível concluir a ação.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Check-in de corretor"
        eyebrow="Roleta"
        icon={Clock}
        description="Bata o ponto dentro da janela para entrar na fila de distribuição de leads."
        actions={
          <StatusBadge tone={activeShift ? "success" : "neutral"}>
            {activeShift ? activeShift.label : "Fora do expediente"}
          </StatusBadge>
        }
      />

      {loadError ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar o check-in"
          description={describeError(loadError, "o servidor não respondeu; verifique a conexão e tente de novo")}
          action={
            <Button onClick={() => void queryClient.invalidateQueries({ queryKey: ["checkin"] })}>
              Tentar de novo
            </Button>
          }
        />
      ) : isLoading ? (
        <LoadingState variant="block" label="Carregando o turno e a elegibilidade…" />
      ) : (
        <SectionCard title="Janela atual" icon={Clock} contentClassName="space-y-4">
          <p className="text-sm text-muted-foreground">
            {activeShift ? (
              <>
                Check-in {hhmm(activeShift.checkin_start)} · distribuição a partir de{" "}
                {hhmm(activeShift.distribution_start)} · check-out {hhmm(activeShift.checkout_time)}
              </>
            ) : (
              <>
                Nenhuma janela ativa agora.
                {shiftList.length > 0 && ` Volte em: ${shiftList.map((shift) => hhmm(shift.checkin_start)).join(", ")}.`}
              </>
            )}
          </p>

          {eligibility.data && !eligibility.data.allowed && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                {eligibility.data.reason}
                {eligibility.data.overdue_count > 0 && (
                  <> Você tem <b>{num(eligibility.data.overdue_count)}</b> lead(s) atrasado(s); o limite é {num(eligibility.data.threshold)}.</>
                )}
              </span>
            </p>
          )}

          {eligibility.data?.allowed && eligibility.data.overdue_count > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Você tem <b>{num(eligibility.data.overdue_count)}</b> lead(s) atrasado(s).
                O check-in trava em {num(eligibility.data.threshold)}.
              </span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={pending || !activeShift || !!activeCheckin || blocked} onClick={() => action("checkin")}>
              <LogIn className="h-4 w-4" /> Fazer check-in
            </Button>
            <Button variant="outline" disabled={pending || !activeCheckin} onClick={() => action("checkout")}>
              <LogOut className="h-4 w-4" /> Check-out
            </Button>
            {activeCheckin && (
              <StatusBadge tone="success" icon={ShieldCheck} className="sm:ml-auto">
                {counts.data ? `${num(counts.data.today)} lead(s) hoje` : "Check-in ativo"}
              </StatusBadge>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <QueuePosition />
          </div>
        </SectionCard>
      )}

      <SectionCard title="Leads recebidos" description="Atribuições da roleta, incluindo as que já saíram da sua mão" icon={ShieldCheck}>
        <LeadCounter counts={counts.data ?? null} />
      </SectionCard>

      <SectionCard title="Janelas de trabalho" icon={CalendarClock}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shiftList.map((shift) => {
            const record = (today.data ?? []).find((item) => item.shift_id === shift.id);
            const activeNow = shift.id === currentShift.data;
            return (
              <div
                key={shift.id}
                className={`rounded-xl border p-4 ${activeNow ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-semibold">{shift.label}</span>
                  {record && (
                    <StatusBadge tone={record.checked_out_at ? "neutral" : "success"}>
                      {record.checked_out_at ? "Encerrado" : "Ativo"}
                    </StatusBadge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {hhmm(shift.checkin_start)} → {hhmm(shift.checkout_time)}<br />
                  Distribui a partir de {hhmm(shift.distribution_start)}
                </p>
                {/* `checkins.leads_received` só conta o que a roleta entregou neste
                    turno; o total do corretor está no card "Leads recebidos". */}
                {record && (
                  <p className="mt-2 text-xs">
                    Pela roleta neste turno: <b className="tabular-nums">{num(record.leads_received)}</b>
                  </p>
                )}
              </div>
            );
          })}
          {shiftList.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma janela de trabalho cadastrada.</p>
          )}
        </div>
      </SectionCard>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="glass-strong max-w-sm border-primary/20 text-center">
          <DialogHeader>
            <div className="mx-auto mb-2 grid h-14 w-14 place-items-center rounded-full bg-primary/20">
              <Rocket className="h-7 w-7 text-primary" aria-hidden />
            </div>
            <DialogTitle className="text-center">Check-in confirmado! ✅</DialogTitle>
            <DialogDescription className="pt-2 text-center text-sm leading-relaxed">{incentive}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button onClick={() => setConfirmOpen(false)}>Bora atender! 💪</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
