import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, LogIn, LogOut, ShieldCheck, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type Window = { id: string; code: string; label: string; checkin_start: string; distribution_start: string; checkout_time: string };
type Checkin = { id: string; shift_id: string; work_date: string; checked_in_at: string; checked_out_at: string | null; leads_received: number };

function nowBRT() {
  const d = new Date();
  return new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}
function inSlot(w: Window, t: Date) {
  const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return hhmm >= w.checkin_start.slice(0, 5) && hhmm < w.checkout_time.slice(0, 5);
}

export default function Checkin() {
  const { user } = useAuth();
  const [windows, setWindows] = useState<Window[]>([]);
  const [today, setToday] = useState<Checkin[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const OVERDUE_LIMIT = 20;

  const incentives = [
    "Boa! Agora é atacar cada lead como se fosse o próximo contrato assinado. 🚀",
    "Check-in confirmado! Velocidade no primeiro contato = mais vendas. ⚡",
    "Você está na fila! Atenda rápido, escute com atenção e conduza até a visita. 🏆",
    "Bora! Cada lead tratado hoje é um passo a mais rumo à sua meta. 💪",
  ];
  const [incentive, setIncentive] = useState("");

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = async () => {
    const { data: w } = await (supabase as any).from("work_shifts").select("*").eq("active", true).order("position");
    setWindows((w as any) || []);
    if (!user) return;
    const brt = nowBRT();
    const workDate = brt.toISOString().slice(0, 10);
    const { data: c } = await (supabase as any).from("checkins")
      .select("*").eq("profile_id", user.id).eq("work_date", workDate);
    setToday((c as any) || []);

    const { data: overdue } = await (supabase as any).rpc("overdue_lead_count", {
      who: user.id,
    });
    setOverdueCount(Number(overdue || 0));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user]);

  const now = nowBRT();
  const activeWindow = windows.find((w) => inSlot(w, now));
  const activeCheckin = activeWindow ? today.find((c) => c.shift_id === activeWindow.id && !c.checked_out_at) : undefined;

  const action = async (act: "checkin" | "checkout") => {
    if (act === "checkin" && overdueCount > OVERDUE_LIMIT) {
      toast.error(`Check-in bloqueado: você tem ${overdueCount} leads atrasados. Trate até ficar com ≤ ${OVERDUE_LIMIT}.`);
      return;
    }
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess?.session) throw new Error("Você precisa estar logado. Faça login novamente.");
      const { data, error } = await supabase.functions.invoke("broker-checkin", { body: { action: act } });
      if (error) {
        // Try to read the real error message from the function response body
        let msg = error.message;
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch {}
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      if (act === "checkin") {
        setIncentive(incentives[Math.floor(Math.random() * incentives.length)]);
        setConfirmOpen(true);
      } else {
        toast.success("Check-out realizado!");
      }
      await load();
    } catch (e: any) {
      toast.error(e.message || "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Check-in de Corretor</h1>
        <p className="text-sm text-muted-foreground">Faça check-in dentro da janela para entrar na fila de distribuição de leads Meta Ads.</p>
      </div>

      <Card className="border-primary/20">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Janela atual</CardTitle>
          <Badge variant={activeWindow ? "default" : "secondary"}>
            {activeWindow ? activeWindow.label : "Fora do expediente"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeWindow ? (
            <div className="text-sm text-muted-foreground">
              Check-in: {activeWindow.checkin_start.slice(0, 5)} · Distribuição inicia: {activeWindow.distribution_start.slice(0, 5)} · Check-out: {activeWindow.checkout_time.slice(0, 5)}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Nenhuma janela ativa agora. Volte em: 09:00, 12:00 ou 16:00.</div>
          )}
          {overdueCount > 0 && (
            <div className={`text-xs rounded-md px-3 py-2 border ${overdueCount > OVERDUE_LIMIT ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-amber-500/40 bg-amber-500/10 text-amber-600"}`}>
              Você tem <b>{overdueCount}</b> lead(s) atrasado(s).
              {overdueCount > OVERDUE_LIMIT
                ? ` Check-in bloqueado — reduza para ≤ ${OVERDUE_LIMIT} para voltar à fila.`
                : ` Limite para check-in: ${OVERDUE_LIMIT}.`}
            </div>
          )}
          <div className="flex gap-3">
            <Button disabled={loading || !activeWindow || !!activeCheckin || overdueCount > OVERDUE_LIMIT} onClick={() => action("checkin")}>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Janelas de trabalho</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3">
            {windows.map((w) => {
              const c = today.find((x) => x.shift_id === w.id);
              const done = c?.checked_out_at;
              const activeNow = inSlot(w, now);
              return (
                <div key={w.id} className={`rounded-lg border p-4 ${activeNow ? "border-primary bg-primary/5" : ""}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">{w.label}</div>
                    {c && (done ? <Badge variant="outline">encerrado</Badge> : <Badge>ativo</Badge>)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {w.checkin_start.slice(0, 5)} → {w.checkout_time.slice(0, 5)}<br/>
                    Distribui a partir de {w.distribution_start.slice(0, 5)}
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
