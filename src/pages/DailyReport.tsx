import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Swords, Shield, Flame, Trophy, Sparkles, Lock, Loader2, Info, AlertTriangle, RefreshCw, TrendingUp, History, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { format, startOfMonth, eachDayOfInterval, isAfter, isWeekend, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { UpdateBanner } from "@/components/UpdateNotifier";

type Roster = { broker_id: string; broker_name: string };
type TeamInfo = { team_id: string; team_name: string; has_pin: boolean };

const FIELDS = [
  { key: "leads", label: "Leads", color: "text-cyan-400" },
  { key: "ligacoes", label: "Ligações", color: "text-sky-400" },
  { key: "coleta_docs", label: "Coleta Docs", color: "text-indigo-400" },
  { key: "visitas_agendadas", label: "Visita Agend.", color: "text-fuchsia-400" },
  { key: "visitas_realizadas", label: "Visita Real.", color: "text-pink-400" },
  { key: "analises", label: "Análise Env.", color: "text-amber-400" },
  { key: "aprovados", label: "Análise Aprov.", color: "text-emerald-400" },
  { key: "vendas", label: "Venda", color: "text-yellow-400" },
] as const;

type FieldKey = typeof FIELDS[number]["key"];
type EntryState = Record<string, Record<FieldKey, number>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function DailyReport() {
  const params = useParams<{ teamId?: string; slug?: string }>();
  const identifier = params.teamId || params.slug || "";
  const isUuid = UUID_RE.test(identifier);
  const [resolvedTeamId, setResolvedTeamId] = useState<string | null>(isUuid ? identifier : null);
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [roster, setRoster] = useState<Roster[]>([]);
  const [entries, setEntries] = useState<EntryState>({});
  const [filledBy, setFilledBy] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [submitting, setSubmitting] = useState(false);
  const [xpBurst, setXpBurst] = useState(0);
  const [monthTotals, setMonthTotals] = useState<Record<FieldKey, number>>(() => FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>));
  const [missingDays, setMissingDays] = useState<string[]>([]);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [filledDates, setFilledDates] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingDay, setLoadingDay] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayFilled = filledDates.includes(todayStr);

  const openTodayForm = async () => {
    setDate(todayStr);
    setFormOpen(true);
    await loadDay(todayStr);
  };



  const loadMonth = async (tid: string) => {
    setLoadingMonth(true);
    const today = new Date();
    const { data, error } = await supabase.rpc("get_daily_team_month_summary" as any, { _team_id: tid });
    let mt: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
    let filledDates: string[] = [];
    if (!error && data) {
      const totals = (data as any).totals || {};
      FIELDS.forEach(f => { mt[f.key] = Number(totals[f.key]) || 0; });
      filledDates = ((data as any).filled_dates || []) as string[];
    }
    setMonthTotals(mt);
    setFilledDates(filledDates);
    const filledSet = new Set(filledDates);
    const days = eachDayOfInterval({ start: startOfMonth(today), end: today });
    const missing = days
      .filter(d => !isAfter(d, today))
      .map(d => format(d, "yyyy-MM-dd"))
      .filter(d => !filledSet.has(d));
    setMissingDays(missing);
    setLoadingMonth(false);
  };

  const loadDay = async (targetDate: string) => {
    if (!resolvedTeamId) return;
    setLoadingDay(true);
    const { data } = await supabase.rpc("get_daily_team_report" as any, { _team_id: resolvedTeamId, _date: targetDate });
    setDate(targetDate);
    setHistoryOpen(false);
    setFormOpen(true);
    if ((data as any)?.exists) {
      const list = ((data as any).entries || []) as any[];
      const next: EntryState = {};
      roster.forEach((b) => {
        const found = list.find((e) => e.broker_id === b.broker_id);
        next[b.broker_id] = FIELDS.reduce((a, f) => ({ ...a, [f.key]: Number(found?.[f.key]) || 0 }), {} as Record<FieldKey, number>);
      });
      setEntries(next);
      setNotes((data as any).notes || "");
      setFilledBy((data as any).filled_by_name || "");
    } else {
      // dia sem checkpoint: zera formulário
      setEntries(roster.reduce((acc, b) => {
        acc[b.broker_id] = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
        return acc;
      }, {} as EntryState));
      setNotes("");
    }
    setLoadingDay(false);
  };

  // Ao trocar a data para um dia AINDA NÃO preenchido, limpa o formulário.
  // Se o dia já tem checkpoint salvo, o loadDay carrega os valores.
  useEffect(() => {
    if (!roster.length) return;
    if (filledDates.includes(date)) return;
    setEntries(roster.reduce((acc, b) => {
      acc[b.broker_id] = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
      return acc;
    }, {} as EntryState));
  }, [date, roster, filledDates]);

  useEffect(() => {
    if (!identifier) return;
    (async () => {
      const body = isUuid ? { team_id: identifier } : { slug: identifier };
      const { data } = await supabase.functions.invoke("daily-team-info", { body });
      if (data?.info) {
        setTeam(data.info as TeamInfo);
        if ((data.info as any).team_id) setResolvedTeamId((data.info as any).team_id);
      }
    })();
  }, [identifier, isUuid]);

  const totals = useMemo(() => {
    const t: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
    Object.values(entries).forEach((row) => FIELDS.forEach((f) => { t[f.key] += row[f.key] || 0; }));
    return t;
  }, [entries]);

  const xpEarned = totals.vendas * 100 + totals.aprovados * 40 + totals.analises * 10 + totals.leads;

  const handleUnlock = async () => {
    if (!pin || pin.length < 4) return toast({ title: "Digite o PIN da equipe" });
    const body: any = { pin };
    if (resolvedTeamId) body.team_id = resolvedTeamId;
    else if (isUuid) body.team_id = identifier;
    else body.slug = identifier;
    const { data, error } = await supabase.functions.invoke("daily-team-info", { body });
    if (error || !data?.pin_ok) {
      return toast({ title: "PIN incorreto", variant: "destructive" });
    }
    if ((data.info as any)?.team_id) setResolvedTeamId((data.info as any).team_id);
    const list = (data.roster as Roster[]) ?? [];
    setRoster(list);
    const initial: EntryState = {};
    list.forEach((b) => {
      initial[b.broker_id] = FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: 0 }), {} as Record<FieldKey, number>);
    });
    setEntries(initial);
    setUnlocked(true);
    const tid = (data.info as any)?.team_id || resolvedTeamId;
    if (tid) loadMonth(tid);
  };

  const setField = (bid: string, key: FieldKey, val: string) => {
    const raw = parseFloat((val || "0").replace(",", ".")) || 0;
    // aceita apenas incrementos de 0.5
    const n = Math.max(0, Math.min(9999, Math.round(raw * 2) / 2));
    setEntries((prev) => ({ ...prev, [bid]: { ...prev[bid], [key]: n } }));
  };

  const submit = async () => {
    if (!filledBy.trim()) return toast({ title: "Informe seu nome" });
    setSubmitting(true);
    const payload = {
      team_id: resolvedTeamId, pin, report_date: date, filled_by_name: filledBy, notes: notes || null,
      entries: roster.map((b) => ({ broker_id: b.broker_id, broker_name: b.broker_name, ...entries[b.broker_id] })),
    };
    const { data, error } = await supabase.functions.invoke("submit-daily-report", { body: payload });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      return toast({ title: "Falha ao enviar", description: (data as any)?.error || error?.message, variant: "destructive" });
    }
    setXpBurst(xpEarned);
    toast({ title: `🎯 Checkpoint concluído! +${xpEarned} XP`, description: "Dados da equipe registrados." });
    setTimeout(() => setXpBurst(0), 3000);
    if (resolvedTeamId) loadMonth(resolvedTeamId);
  };

  if (!identifier) return <div className="p-8 text-center">Equipe inválida.</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0F0E19] via-[#12122a] to-[#0F0E19] text-foreground">
      {/* Aura */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-primary/10 blur-3xl animate-pulse" />
      </div>

      <div className="relative max-w-6xl mx-auto p-6 space-y-6">
        <header className="text-center space-y-3">
          <img src={logoWhite} alt="Faceimob" className="h-12 mx-auto object-contain" />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-xs uppercase tracking-widest">
            <Swords className="h-3 w-3 text-primary" /> Checkpoint Diário
          </div>
          <h1 className="text-4xl font-black bg-gradient-to-r from-primary via-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
            {team?.team_name ?? "Carregando equipe..."}
          </h1>
          <p className="text-xs text-muted-foreground">Registre a performance da sua equipe de hoje</p>
        </header>

        <UpdateBanner />

        {!unlocked ? (
          <Card className="max-w-md mx-auto border-primary/30 bg-card/60 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-4 w-4 text-primary" /> Acesso da Equipe</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Digite o PIN entregue pela administração.</p>
              <Input
                type="password" inputMode="numeric" maxLength={10}
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
                className="text-center text-2xl tracking-[0.5em] font-bold h-14"
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              />
              <Button onClick={handleUnlock} className="w-full" size="lg">
                <Sparkles className="h-4 w-4 mr-2" /> Entrar na missão
              </Button>
              {team && !team.has_pin && (
                <p className="text-xs text-amber-400">⚠️ Nenhum PIN configurado. Contate o admin.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Meta bar */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="border-primary/30 bg-card/60 backdrop-blur-xl">
                <CardContent className="p-3">
                  <label className="text-[10px] uppercase text-muted-foreground">Data</label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:invert-[.75] [&::-webkit-calendar-picker-indicator]:sepia [&::-webkit-calendar-picker-indicator]:saturate-[6] [&::-webkit-calendar-picker-indicator]:hue-rotate-[358deg] [&::-webkit-calendar-picker-indicator]:brightness-[1.1] [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-card/60 backdrop-blur-xl">
                <CardContent className="p-3">
                  <label className="text-[10px] uppercase text-muted-foreground">Gerente</label>
                  <Input value={filledBy} onChange={(e) => setFilledBy(e.target.value)} placeholder="Seu nome" className="h-8 text-xs" />
                </CardContent>
              </Card>
              <TooltipProvider>
                <Card className="border-yellow-400/40 bg-yellow-400/5 backdrop-blur-xl">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] uppercase text-muted-foreground">XP do checkpoint</p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button"><Info className="h-3 w-3 text-muted-foreground hover:text-yellow-400" /></button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                            <p className="font-bold mb-1">O que é o XP do checkpoint?</p>
                            <p className="mb-2 text-muted-foreground">
                              É a pontuação da sua equipe no dia. Cada ação da equipe soma XP e forma um placar visível para diretoria — quanto mais consistente o gerente registrar os checkpoints, maior o XP acumulado no mês e melhor a posição no ranking de gerentes.
                            </p>
                            <p className="font-bold mb-1">Como é calculado:</p>
                            <ul className="space-y-0.5">
                              <li>• Venda = <b>100 XP</b></li>
                              <li>• Análise aprovada = <b>40 XP</b></li>
                              <li>• Análise enviada = <b>10 XP</b></li>
                              <li>• Lead recebido = <b>1 XP</b></li>
                            </ul>
                            <p className="mt-2 text-[10px] text-muted-foreground">Incentivo: recompensa o gerente que mantém a equipe ativa e o pipeline avançando — não só vendas, mas cada passo do funil conta.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xl font-black text-yellow-400">{xpEarned.toLocaleString()}</p>
                    </div>
                    <Trophy className="h-8 w-8 text-yellow-400" />
                  </CardContent>
                </Card>
              </TooltipProvider>
            </div>

            {/* Month funnel + missing days */}
            <Card className="border-cyan-400/30 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-cyan-400" /> Funil do mês ({format(new Date(), "MMMM", { locale: ptBR })})
                  </CardTitle>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Período considerado: segunda a domingo</p>
                </div>
                <div className="flex items-center gap-2">
                  <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        <History className="h-3 w-3 mr-1" /> Histórico
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                          <History className="h-4 w-4" /> Histórico do mês
                        </DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Preenchido</span>
                          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Não preenchido</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1.5">
                          {eachDayOfInterval({ start: startOfMonth(new Date()), end: new Date() }).map((d) => {
                            const ds = format(d, "yyyy-MM-dd");
                            const done = filledDates.includes(ds);
                            return (
                              <button
                                key={ds}
                                onClick={() => loadDay(ds)}
                                disabled={loadingDay}
                                className={`relative aspect-square rounded-md text-xs font-bold flex flex-col items-center justify-center transition border ${
                                  done
                                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/25"
                                    : "bg-rose-500/10 border-rose-500/40 text-rose-300 hover:bg-rose-500/20"
                                }`}
                                title={done ? "Preenchido — clique para editar" : "Não preenchido"}
                              >
                                <span className="text-sm leading-none">{format(d, "dd")}</span>
                                <span className="text-[8px] uppercase mt-0.5 opacity-70">{format(d, "EEE", { locale: ptBR })}</span>
                                {done && <Pencil className="absolute top-0.5 right-0.5 h-2.5 w-2.5 opacity-70" />}
                              </button>
                            );
                          })}
                        </div>
                        {loadingDay && <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Carregando…</p>}
                      </div>
                    </DialogContent>
                  </Dialog>
                  <Button size="sm" variant="outline" onClick={() => resolvedTeamId && loadMonth(resolvedTeamId)} disabled={loadingMonth} className="h-7 text-xs">
                    {loadingMonth ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {FIELDS.map(f => (
                    <div key={f.key} className="px-2 py-1.5 rounded-md border border-border/40 bg-secondary/20 text-center">
                      <p className="text-[9px] uppercase text-muted-foreground">{f.label}</p>
                      <p className={`text-lg font-black ${f.color}`}>{monthTotals[f.key]}</p>
                    </div>
                  ))}
                </div>
                {missingDays.length > 0 && (
                  <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-2 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-rose-400">Checkpoint não efetuado ({missingDays.length} {missingDays.length === 1 ? "dia" : "dias"}):</p>
                      <p className="text-muted-foreground mt-0.5">
                        {missingDays.map(d => format(parseISO(d), "dd/MM", { locale: ptBR })).join(" • ")}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>


            {/* Broker cards */}
            {roster.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum corretor vinculado a esta equipe.</Card>
            ) : (
              <Card className="border-primary/20 bg-card/60 backdrop-blur-xl overflow-hidden">
                <div
                  className="hidden md:grid gap-2 px-3 py-2 border-b border-border/40 bg-secondary/30 text-[9px] uppercase font-bold tracking-wider text-muted-foreground"
                  style={{ gridTemplateColumns: `minmax(160px,1.4fr) repeat(${FIELDS.length}, minmax(60px,1fr)) 64px` }}
                >
                  <span>Corretor</span>
                  {FIELDS.map((f) => <span key={f.key} className={`text-center ${f.color}`}>{f.label}</span>)}
                  <span className="text-center">Total</span>
                </div>
                <div className="divide-y divide-border/30">
                  {roster.map((b) => {
                    const total = FIELDS.reduce((s, f) => s + (entries[b.broker_id]?.[f.key] || 0), 0);
                    return (
                      <div
                        key={b.broker_id}
                        className="grid grid-cols-2 md:!grid gap-2 px-3 py-2 items-center hover:bg-primary/5 transition"
                        style={{ gridTemplateColumns: `minmax(160px,1.4fr) repeat(${FIELDS.length}, minmax(60px,1fr)) 64px` }}
                      >
                        <div className="flex items-center gap-2 col-span-2 md:col-span-1 min-w-0">
                          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary/40 to-fuchsia-500/30 flex items-center justify-center font-black text-xs border border-primary/40 shrink-0">
                            {b.broker_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-medium truncate">{b.broker_name}</span>
                        </div>
                        {FIELDS.map((f) => (
                          <div key={f.key} className="flex flex-col md:block min-w-0">
                            <label className={`md:hidden text-[9px] uppercase font-bold ${f.color}`}>{f.label}</label>
                            <Input
                              type="number" min={0} step={0.5}
                              value={entries[b.broker_id]?.[f.key] ?? 0}
                              onChange={(e) => setField(b.broker_id, f.key, e.target.value)}
                              className="h-8 text-center text-xs font-bold px-1"
                            />
                          </div>
                        ))}
                        <Badge variant="outline" className="text-[10px] justify-center col-span-2 md:col-span-1">{total}</Badge>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <Card className="border-primary/20 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-orange-400" /> Observações do dia</CardTitle></CardHeader>
              <CardContent>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto, dificuldades, vitórias..." rows={3} className="text-xs" />
              </CardContent>
            </Card>

            {/* Totals + submit */}
            <Card className="border-primary/40 bg-gradient-to-r from-primary/10 via-fuchsia-500/5 to-primary/10 backdrop-blur-xl sticky bottom-4 shadow-2xl shadow-primary/20">
              <CardContent className="p-4 flex flex-wrap items-center gap-4">
                {FIELDS.map((f) => (
                  <div key={f.key} className="text-center">
                    <p className="text-[9px] uppercase text-muted-foreground">{f.label}</p>
                    <p className={`text-lg font-black ${f.color}`}>{totals[f.key]}</p>
                  </div>
                ))}
                <Button size="lg" onClick={submit} disabled={submitting || roster.length === 0} className="ml-auto bg-gradient-to-r from-primary to-fuchsia-500 hover:opacity-90">
                  {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                  Salvar Checkpoint
                </Button>
              </CardContent>
            </Card>
          </>
        )}

        {xpBurst > 0 && (
          <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
            <div className="text-8xl font-black text-yellow-400 animate-scale-in drop-shadow-[0_0_40px_rgba(250,204,21,0.8)]">
              +{xpBurst} XP
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
