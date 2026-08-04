import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, LogIn, LogOut, ShieldCheck, Rocket, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import QueuePosition from "@/components/QueuePosition";
import LeadCounter from "@/components/LeadCounter";
import {
  getCheckinEligibility,
  getCurrentShiftId,
  listTodayCheckins,
  listWorkShifts,
  type CheckinEligibility,
  type CheckinRecord,
  type WorkShift,
} from "@/integrations/supabase/checkin";

const hhmm = (t: string) => t.slice(0, 5);

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
 * `checkin_eligibility()`), não de cálculo no cliente. A versão anterior
 * comparava horários em JS — o que ignorava o fuso America/Sao_Paulo que a
 * função do banco respeita — e travava com `> 20` fixo, enquanto o banco bloqueia
 * com `>= automation_settings.overdue_block_threshold`. No limite exato a tela
 * liberava o botão e o servidor recusava.
 */
export default function Checkin() {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [today, setToday] = useState<CheckinRecord[]>([]);
  const [currentShiftId, setCurrentShiftId] = useState<string | null>(null);
  const [eligibility, setEligibility] = useState<CheckinEligibility | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [incentive, setIncentive] = useState("");

  const load = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [shiftList, checkins, shiftId, elig] = await Promise.all([
        listWorkShifts(),
        listTodayCheckins(user.id),
        getCurrentShiftId(),
        getCheckinEligibility(),
      ]);
      setShifts(shiftList);
      setToday(checkins);
      setCurrentShiftId(shiftId);
      setEligibility(elig);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar o check-in");
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  // O turno vira sozinho: sem esta releitura o botão ficaria desabilitado até
  // o usuário recarregar a página na virada da janela.
  useEffect(() => {
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const activeShift = shifts.find((s) => s.id === currentShiftId) ?? null;
  const activeCheckin = activeShift
    ? today.find((c) => c.shift_id === activeShift.id && !c.checked_out_at)
    : undefined;
  const blocked = eligibility ? !eligibility.allowed : true;

  const action = async (act: "checkin" | "checkout") => {
    if (act === "checkin" && blocked) {
      toast.error(eligibility?.reason || "Check-in bloqueado.");
      return;
    }
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) throw new Error("Você precisa estar logado. Faça login novamente.");
      const { data, error } = await supabase.functions.invoke("broker-checkin", { body: { action: act } });
      if (error) {
        // A mensagem útil vem no corpo da resposta da function, não no error.message.
        let msg = error.message;
        try {
          const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
          if (ctx?.json) {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* mantém error.message */ }
        throw new Error(msg);
      }
      if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
      if (act === "checkin") {
        setIncentive(incentives[Math.floor(Math.random() * incentives.length)]);
        setConfirmOpen(true);
      } else {
        toast.success("Check-out realizado!");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Check-in de Corretor</h1>
        <p className="text-sm text-muted-foreground">
          Faça check-in dentro da janela para entrar na fila de distribuição de leads Meta Ads.
        </p>
      </div>

      <Card className="border-primary/20">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Janela atual</CardTitle>
          <Badge variant={activeShift ? "default" : "secondary"}>
            {activeShift ? activeShift.label : "Fora do expediente"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeShift ? (
            <div className="text-sm text-muted-foreground">
              Check-in: {hhmm(activeShift.checkin_start)} · Distribuição inicia: {hhmm(activeShift.distribution_start)} · Check-out: {hhmm(activeShift.checkout_time)}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              Nenhuma janela ativa agora.
              {shifts.length > 0 && ` Volte em: ${shifts.map((s) => hhmm(s.checkin_start)).join(", ")}.`}
            </div>
          )}

          {eligibility && !eligibility.allowed && (
            <div className="text-xs rounded-md px-3 py-2 border border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {eligibility.reason}
                {eligibility.overdue_count > 0 && (
                  <> Você tem <b>{eligibility.overdue_count}</b> lead(s) atrasado(s); o limite é {eligibility.threshold}.</>
                )}
              </span>
            </div>
          )}

          {eligibility?.allowed && eligibility.overdue_count > 0 && (
            <div className="text-xs rounded-md px-3 py-2 border border-amber-500/40 bg-amber-500/10 text-amber-600">
              Você tem <b>{eligibility.overdue_count}</b> lead(s) atrasado(s). O check-in trava em {eligibility.threshold}.
            </div>
          )}

          <div className="flex gap-3">
            <Button disabled={loading || !activeShift || !!activeCheckin || blocked} onClick={() => action("checkin")}>
              <LogIn className="h-4 w-4 mr-2" /> Fazer Check-in
            </Button>
            <Button variant="outline" disabled={loading || !activeCheckin} onClick={() => action("checkout")}>
              <LogOut className="h-4 w-4 mr-2" /> Check-out
            </Button>
            {activeCheckin && (
              <Badge variant="secondary" className="ml-auto self-center">
                <ShieldCheck className="h-3 w-3 mr-1" /> {activeCheckin.leads_received} lead(s) recebidos
              </Badge>
            )}
          </div>

          <div className="pt-2 border-t border-border/40 space-y-3">
            <QueuePosition />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Leads recebidos</CardTitle></CardHeader>
        <CardContent><LeadCounter /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Janelas de trabalho</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {shifts.map((w) => {
              const c = today.find((x) => x.shift_id === w.id);
              const done = c?.checked_out_at;
              const activeNow = w.id === currentShiftId;
              return (
                <div key={w.id} className={`rounded-lg border p-4 ${activeNow ? "border-primary bg-primary/5" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">{w.label}</div>
                    {c && (done ? <Badge variant="outline">encerrado</Badge> : <Badge>ativo</Badge>)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {hhmm(w.checkin_start)} → {hhmm(w.checkout_time)}<br />
                    Distribui a partir de {hhmm(w.distribution_start)}
                  </div>
                  {c && <div className="text-xs mt-2">Leads recebidos: <b>{c.leads_received}</b></div>}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="glass-strong glow-primary max-w-sm text-center border-primary/20">
          <DialogHeader>
            <div className="mx-auto w-14 h-14 rounded-full bg-primary/20 flex items-center justify-center mb-2">
              <Rocket className="w-7 h-7 text-primary" />
            </div>
            <DialogTitle className="text-center">Check-in confirmado! ✅</DialogTitle>
            <DialogDescription className="text-center text-sm leading-relaxed pt-2">
              {incentive}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button onClick={() => setConfirmOpen(false)} className="glow-primary">
              Bora atender! 💪
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
