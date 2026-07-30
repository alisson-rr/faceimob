import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Swords, Flame, Trophy, Sparkles, Lock, Loader2, Info, AlertTriangle, RefreshCw, TrendingUp, History, Pencil, Target, Users, UserPlus, UserMinus, ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { format, startOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import logoWhite from "@/assets/logo-faceimob-white.png";
import { UpdateBanner } from "@/components/UpdateNotifier";
import { CompactFunnel, type FunnelStep } from "@/components/ComparativeFunnel";

type Roster = { broker_id: string; broker_name: string; active?: boolean; is_custom?: boolean };
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
  const identifier = params.slug || params.teamId || "";
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
  const [manageOpen, setManageOpen] = useState(false);
  const [newBrokerName, setNewBrokerName] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Roster | null>(null);
  const [brokerMonth, setBrokerMonth] = useState<Record<string, Record<FieldKey, number> & { days_filled?: number }>>({});
  const [expandedBroker, setExpandedBroker] = useState<Record<string, boolean>>({});


  const yesterday = new Date();
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const todayFilled = filledDates.includes(todayStr);

  const activeRoster = useMemo(() => roster.filter((b) => b.active !== false), [roster]);

  const fetchPublicTeam = async (rawPin: string) => {
    const { data, error } = await (supabase as any).rpc("public_daily_team", {
      p_slug: identifier,
      p_pin: rawPin || null,
    });
    if (error) return null;
    const payload = data as any;
    if (!payload) return null;
    const list = ((payload.roster as any[]) || []).map(row => ({
      broker_id: row.profile_id,
      broker_name: row.full_name,
      active: true,
    })) as Roster[];
    setTeam({ team_id: payload.team_id, team_name: payload.team_name, has_pin: payload.has_pin });
    setResolvedTeamId(payload.team_id);
    setRoster(list);
    setEntries((prev) => {
      const next: EntryState = { ...prev };
      list.forEach((b) => {
        if (!next[b.broker_id]) next[b.broker_id] = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
      });
      return next;
    });
    return { payload, list };
  };

  const addBroker = async () => {
    toast({ title: "Gerencie os membros em Equipes", description: "A escala do diário agora acompanha os membros ativos da equipe." });
  };

  const confirmRemoveBroker = async () => {
    const target = pendingRemove;
    if (!target) return;
    toast({ title: "Gerencie os membros em Equipes", description: "O diário usa a composição oficial da equipe." });
    setPendingRemove(null);
  };


  const openTodayForm = async () => {
    setDate(todayStr);
    setFormOpen(true);
    await loadDay(todayStr);
  };



  const loadMonth = async () => {
    setLoadingMonth(true);
    const result = await fetchPublicTeam(pin);
    let mt: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
    let filledDates: string[] = [];
    const rows = (result?.payload?.today || []) as any[];
    if (rows.length) {
      rows.forEach(row => {
        mt.leads += Number(row.leads) || 0;
        mt.ligacoes += Number(row.calls) || 0;
        mt.coleta_docs += Number(row.doc_collections) || 0;
        mt.visitas_agendadas += Number(row.visits_scheduled) || 0;
        mt.visitas_realizadas += Number(row.visits_done) || 0;
        mt.analises += Number(row.analyses_sent) || 0;
        mt.aprovados += Number(row.analyses_approved) || 0;
        mt.vendas += Number(row.sales) || 0;
      });
      filledDates = [todayStr];
    }
    setMonthTotals(mt);
    setFilledDates(filledDates);
    setMissingDays([]);
    const map: Record<string, Record<FieldKey, number> & { days_filled?: number }> = {};
    rows.forEach((r) => {
      map[r.profile_id] = {
        leads: Number(r.leads) || 0,
        ligacoes: Number(r.calls) || 0,
        coleta_docs: Number(r.doc_collections) || 0,
        visitas_agendadas: Number(r.visits_scheduled) || 0,
        visitas_realizadas: Number(r.visits_done) || 0,
        analises: Number(r.analyses_sent) || 0,
        aprovados: Number(r.analyses_approved) || 0,
        vendas: Number(r.sales) || 0,
        days_filled: 1,
      };
    });
    setBrokerMonth(map);

    setLoadingMonth(false);
  };

  const loadDay = async (targetDate: string) => {
    if (!resolvedTeamId) return;
    setLoadingDay(true);
    const result = await fetchPublicTeam(pin);
    setDate(targetDate);
    setHistoryOpen(false);
    setFormOpen(true);
    if (targetDate === todayStr && result?.payload?.today?.length) {
      const list = result.payload.today as any[];
      const next: EntryState = {};
      roster.forEach((b) => {
        const found = list.find((e) => e.profile_id === b.broker_id);
        next[b.broker_id] = {
          leads: Number(found?.leads) || 0,
          ligacoes: Number(found?.calls) || 0,
          coleta_docs: Number(found?.doc_collections) || 0,
          visitas_agendadas: Number(found?.visits_scheduled) || 0,
          visitas_realizadas: Number(found?.visits_done) || 0,
          analises: Number(found?.analyses_sent) || 0,
          aprovados: Number(found?.analyses_approved) || 0,
          vendas: Number(found?.sales) || 0,
        };
      });
      setEntries(next);
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
      const result = await fetchPublicTeam("");
      if (result) {
        setUnlocked(true);
        await loadMonth();
      }
    })();
  }, [identifier]);


  const totals = useMemo(() => {
    const t: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
    Object.values(entries).forEach((row) => FIELDS.forEach((f) => { t[f.key] += row[f.key] || 0; }));
    return t;
  }, [entries]);

  const xpEarned = totals.vendas * 100 + totals.aprovados * 40 + totals.analises * 10 + totals.leads;
  const xpMonth = monthTotals.vendas * 100 + monthTotals.aprovados * 40 + monthTotals.analises * 10 + monthTotals.leads;
  const xpDisplay = formOpen ? xpEarned : xpMonth;


  const emptyBrokers = useMemo(() => {
    return activeRoster.filter((b) => {
      const row = entries[b.broker_id];
      if (!row) return true;
      // "sem lançamento" = nenhum campo com valor > 0 (0/undefined/null contam como vazio).
      return FIELDS.every((f) => !row[f.key]);
    });
  }, [activeRoster, entries]);


  const handleUnlock = async () => {
    if (!pin || pin.length < 4) return toast({ title: "Digite o PIN da equipe" });
    const result = await fetchPublicTeam(pin);
    if (!result) {
      return toast({ title: "PIN incorreto", variant: "destructive" });
    }
    const list = result.list;
    const initial: EntryState = {};
    list.forEach((b) => {
      initial[b.broker_id] = FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: 0 }), {} as Record<FieldKey, number>);
    });
    setEntries(initial);
    setUnlocked(true);
    await loadMonth();

  };

  const setField = (bid: string, key: FieldKey, val: string) => {
    const raw = parseFloat((val || "0").replace(",", ".")) || 0;
    // aceita apenas incrementos de 0.5
    const n = Math.max(0, Math.min(9999, Math.round(raw * 2) / 2));
    setEntries((prev) => ({ ...prev, [bid]: { ...prev[bid], [key]: n } }));
  };

  const submit = async () => {
    if (!filledBy.trim()) {
      toast({ title: "Informe seu nome no campo 'Gerente' antes de salvar", variant: "destructive" });
      const el = document.getElementById("filled-by-input") as HTMLInputElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus();
      return;
    }
    setSubmitting(true);
    const payload = roster.map((b) => ({
      profile_id: b.broker_id,
      leads: entries[b.broker_id]?.leads || 0,
      calls: entries[b.broker_id]?.ligacoes || 0,
      doc_collections: entries[b.broker_id]?.coleta_docs || 0,
      visits_scheduled: entries[b.broker_id]?.visitas_agendadas || 0,
      visits_done: entries[b.broker_id]?.visitas_realizadas || 0,
      analyses_sent: entries[b.broker_id]?.analises || 0,
      analyses_approved: entries[b.broker_id]?.aprovados || 0,
      sales: entries[b.broker_id]?.vendas || 0,
    }));
    const { error } = await (supabase as any).rpc("public_daily_submit", {
      p_slug: identifier,
      p_pin: pin || null,
      p_entries: payload,
    });
    setSubmitting(false);
    if (error) {
      return toast({ title: "Falha ao enviar", description: error.message || "Erro desconhecido", variant: "destructive" });
    }
    setXpBurst(xpEarned);
    toast({ title: `🎯 Checkpoint concluído! +${xpEarned} XP`, description: "Dados da equipe registrados." });
    setTimeout(() => setXpBurst(0), 3000);
    if (resolvedTeamId) loadMonth();
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
          <p className="text-xs text-muted-foreground">Registre a performance da sua equipe de ontem</p>
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
                  <label className="text-[10px] uppercase text-muted-foreground">Data {formOpen && date !== todayStr ? "(editando)" : "(ontem)"}</label>
                  <Input type="date" value={date} readOnly disabled className="h-8 text-xs [color-scheme:dark] opacity-70 cursor-not-allowed" />

                </CardContent>
              </Card>
              <Card className={`bg-card/60 backdrop-blur-xl ${!filledBy.trim() && formOpen ? "border-rose-500/60 ring-2 ring-rose-500/30 animate-pulse" : "border-primary/30"}`}>
                <CardContent className="p-3">
                  <label className="text-[10px] uppercase text-muted-foreground">Gerente {!filledBy.trim() && formOpen && <span className="text-rose-400">*obrigatório</span>}</label>
                  <Input id="filled-by-input" value={filledBy} onChange={(e) => setFilledBy(e.target.value)} placeholder="Seu nome" className="h-8 text-xs" />
                </CardContent>
              </Card>
              <TooltipProvider>
                <Card className="border-yellow-400/40 bg-yellow-400/5 backdrop-blur-xl">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-[10px] uppercase text-muted-foreground">{formOpen ? "XP do checkpoint" : "XP do mês"}</p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button type="button"><Info className="h-3 w-3 text-muted-foreground hover:text-yellow-400" /></button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs max-w-[260px]">
                            <p className="font-bold mb-1">Como é calculado:</p>
                            <ul className="space-y-0.5">
                              <li>• Venda = <b>100 XP</b></li>
                              <li>• Análise aprovada = <b>40 XP</b></li>
                              <li>• Análise enviada = <b>10 XP</b></li>
                              <li>• Lead recebido = <b>1 XP</b></li>
                            </ul>
                            <p className="mt-2 text-[10px] text-muted-foreground">Fechado: mostra o acumulado do mês. Editando: mostra o XP do dia.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <p className="text-xl font-black text-yellow-400">{xpDisplay.toLocaleString()}</p>
                    </div>

                    <Trophy className="h-8 w-8 text-yellow-400" />
                  </CardContent>
                </Card>
              </TooltipProvider>
            </div>

            {/* Funil do mês — sempre visível para acompanhamento */}
            <CompactFunnel
              title="Funil do mês — acumulado"
              subtitle="metas: 100 → 10% → 40% → 50%"
              accent="hsl(280 90% 65%)"
              steps={[
                { key: "leads",     label: "Leads",      value: monthTotals.leads     || 0, targetPct: 100 },
                { key: "analises",  label: "Análises",   value: monthTotals.analises  || 0, targetPct: 10 },
                { key: "aprovados", label: "Aprovações", value: monthTotals.aprovados || 0, targetPct: 40 },
                { key: "vendas",    label: "Vendas",     value: monthTotals.vendas    || 0, targetPct: 50 },
              ] as FunnelStep[]}
            />

            {/* Funil IDEAL — 4 estágios 3D, compacto */}
            <div className="flex items-center gap-4 px-3 py-2 rounded-lg border border-border/40 bg-muted/10">
              <div className="flex items-center gap-1.5 shrink-0">
                <Target className="h-3.5 w-3.5 text-yellow-400/80" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Funil Ideal</span>
              </div>

              <svg viewBox="0 0 140 160" className="h-24 shrink-0" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="funil3d" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%"   stopColor="hsl(217 85% 30%)" />
                    <stop offset="50%"  stopColor="hsl(217 91% 55%)" />
                    <stop offset="100%" stopColor="hsl(217 85% 28%)" />
                  </linearGradient>
                </defs>
                {[
                  { y: 2,   top: 130, bot: 100, h: 22 },
                  { y: 40,  top: 100, bot: 74,  h: 20 },
                  { y: 76,  top: 74,  bot: 48,  h: 18 },
                  { y: 110, top: 48,  bot: 26,  h: 16 },
                ].map((s, i) => {
                  const cx = 70;
                  const topRx = s.top / 2, botRx = s.bot / 2;
                  const yTop = s.y, yBot = s.y + s.h;
                  const ellipseRy = topRx * 0.18;
                  // Body path: trapezoid sides + bottom ellipse arc
                  const d = `
                    M ${cx - topRx} ${yTop}
                    L ${cx - botRx} ${yBot}
                    A ${botRx} ${botRx * 0.22} 0 0 0 ${cx + botRx} ${yBot}
                    L ${cx + topRx} ${yTop}
                    A ${topRx} ${ellipseRy} 0 0 1 ${cx - topRx} ${yTop} Z
                  `;
                  return (
                    <g key={i}>
                      <path d={d} fill="url(#funil3d)" stroke="hsl(217 60% 20%)" strokeWidth="0.5" />
                      {/* Top ellipse rim highlight */}
                      <ellipse cx={cx} cy={yTop} rx={topRx} ry={ellipseRy} fill="hsl(217 85% 35%)" opacity="0.9" />
                      <ellipse cx={cx} cy={yTop - 0.4} rx={topRx * 0.95} ry={ellipseRy * 0.7} fill="none" stroke="hsl(217 100% 75%)" strokeWidth="0.5" opacity="0.6" />
                    </g>
                  );
                })}
              </svg>

              <div className="flex flex-col justify-between h-24 py-1 text-[10px] leading-tight">
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">100%</b><span className="text-muted-foreground">Leads</span></div>
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">10%</b><span className="text-muted-foreground">Análises</span></div>
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">40%</b><span className="text-muted-foreground">Aprovações</span></div>
                <div className="flex items-center gap-1.5"><span className="text-muted-foreground">→</span><b className="text-foreground">50%</b><span className="text-muted-foreground">Vendas</span></div>
              </div>


              <div className="flex-1 min-w-0 border-l border-border/40 pl-4 ml-1 text-[10px] leading-snug space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-yellow-400/80 font-semibold">Instrua seu time</p>
                <p className="text-muted-foreground">
                  A cada <b className="text-foreground">100 leads</b> trabalhados, o esperado é:
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-foreground">
                  <span><b className="text-cyan-300">10</b> análises</span>
                  <span className="text-muted-foreground">→</span>
                  <span><b className="text-emerald-300">4</b> aprovações</span>
                  <span className="text-muted-foreground">→</span>
                  <span><b className="text-yellow-300">2</b> vendas</span>
                </div>
                <p className="text-muted-foreground pt-0.5">
                  Cálculo: 100 × 10% = <b className="text-foreground">10</b> · 10 × 40% = <b className="text-foreground">4</b> · 4 × 50% = <b className="text-foreground">2</b>
                </p>
              </div>
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
                          {eachDayOfInterval({ start: startOfMonth(new Date()), end: yesterday }).map((d) => {
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
                  <Button size="sm" variant="outline" onClick={() => resolvedTeamId && loadMonth()} disabled={loadingMonth} className="h-7 text-xs">
                    {loadingMonth ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Atualizar
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 justify-items-center max-w-3xl mx-auto">
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


            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Users className="h-3 w-3" /> {activeRoster.length} corretor{activeRoster.length === 1 ? "" : "es"} ativo{activeRoster.length === 1 ? "" : "s"}
                {roster.length !== activeRoster.length && <span className="text-rose-400 ml-1">• {roster.length - activeRoster.length} desligado{roster.length - activeRoster.length === 1 ? "" : "s"}</span>}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setManageOpen(true)}
              >
                <Users className="h-3 w-3 mr-1" /> Gerenciar equipe do daily
              </Button>
            </div>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Gerenciar corretores da equipe</DialogTitle>
                </DialogHeader>
                <p className="text-[11px] text-muted-foreground">
                  Esta lista é <b>independente</b> da aba Equipes. Ao desligar, o corretor permanece na lista (ofuscado) para preservar suas métricas históricas, mas fica bloqueado para novos lançamentos.
                </p>
                <div className="flex gap-2">
                  <Input
                    value={newBrokerName}
                    onChange={(e) => setNewBrokerName(e.target.value)}
                    placeholder="Nome do novo corretor"
                    className="h-8 text-xs"
                    onKeyDown={(e) => e.key === "Enter" && addBroker()}
                  />
                  <Button size="sm" onClick={addBroker} disabled={!newBrokerName.trim()} className="h-8">
                    <UserPlus className="h-3 w-3 mr-1" />
                    Adicionar
                  </Button>
                </div>
                <div className="max-h-72 overflow-auto divide-y divide-border/40 rounded-md border border-border/40">
                  {roster.map((b) => {
                    const inactive = b.active === false;
                    return (
                      <div key={b.broker_id} className={`flex items-center justify-between gap-2 px-3 py-2 text-xs ${inactive ? "opacity-50" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{b.broker_name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {b.is_custom ? "Adicionado no daily" : "Base da equipe"}
                            {inactive && " • desligado"}
                          </p>
                        </div>
                        {inactive ? (
                          <Badge variant="outline" className="text-[9px]">desligado</Badge>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setPendingRemove(b)} className="h-7 text-[11px] text-rose-400 hover:text-rose-300">
                            <UserMinus className="h-3 w-3 mr-1" /> Desligar
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {roster.length === 0 && <p className="p-4 text-center text-[11px] text-muted-foreground">Nenhum corretor.</p>}
                </div>
              </DialogContent>
            </Dialog>

            <AlertDialog open={!!pendingRemove} onOpenChange={(v) => !v && setPendingRemove(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Desligar {pendingRemove?.broker_name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    O histórico do corretor é preservado, mas ele ficará bloqueado para novos lançamentos neste daily.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={confirmRemoveBroker} className="bg-rose-500 hover:bg-rose-600">
                    <UserMinus className="h-3 w-3 mr-1" />
                    Desligar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>



            {!formOpen ? (

              <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-fuchsia-500/5 to-primary/10 backdrop-blur-xl">
                <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                  <Sparkles className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-sm font-bold">Pronto para registrar o dia de ontem?</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Clique abaixo para abrir o checkpoint de <b>ontem ({format(yesterday, "dd/MM", { locale: ptBR })})</b> com todos os corretores da equipe.
                    </p>
                    {todayFilled && (
                      <p className="text-xs text-emerald-400 mt-2 flex items-center justify-center gap-1">
                        <Info className="h-3 w-3" /> O checkpoint de ontem já foi preenchido — você pode editar os valores.
                      </p>
                    )}
                  </div>
                  <Button size="lg" onClick={openTodayForm} disabled={loadingDay || roster.length === 0} className="bg-gradient-to-r from-primary to-fuchsia-500 hover:opacity-90">
                    {loadingDay ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Pencil className="h-4 w-4 mr-2" />}
                    {todayFilled ? "Editar daily de ontem" : "Preencher o daily de ontem"}
                  </Button>
                  <p className="text-[10px] text-muted-foreground">Para editar outros dias, use o botão <b>Histórico</b> acima.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Broker cards */}
                {roster.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum corretor vinculado a esta equipe.</Card>
                ) : (
                  <>
                    {date !== todayStr && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400" />
                        Editando um dia anterior: <b>{format(parseISO(date), "dd/MM/yyyy", { locale: ptBR })}</b>
                      </div>
                    )}
                    {date === todayStr && todayFilled && (
                      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs flex items-center gap-2">
                        <Info className="h-4 w-4 text-emerald-400" />
                        Este dia já foi preenchido — alterações vão sobrescrever o checkpoint.
                      </div>
                    )}
                    {emptyBrokers.length > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-amber-300">
                            {emptyBrokers.length} de {roster.length} corretor{emptyBrokers.length === 1 ? "" : "es"} sem lançamentos
                          </p>
                          <p className="text-muted-foreground mt-0.5">{emptyBrokers.map((b) => b.broker_name).join(" • ")}</p>
                        </div>
                      </div>
                    )}
                    <Card className="border-primary/20 bg-card/60 backdrop-blur-xl overflow-hidden">

                      <div
                        className="hidden md:grid gap-2 px-3 py-2 border-b border-border/40 bg-secondary/30 text-[9px] uppercase font-bold tracking-wider text-muted-foreground md:[grid-template-columns:minmax(140px,1.4fr)_repeat(8,minmax(52px,1fr))_56px]"
                      >
                        <span>Corretor</span>
                        {FIELDS.map((f) => <span key={f.key} className={`text-center ${f.color}`}>{f.label}</span>)}
                        <span className="text-center">Total</span>
                      </div>
                      <div className="divide-y divide-border/30">
                        {roster.filter((b) => b.active !== false || showInactive).map((b) => {
                          const total = FIELDS.reduce((s, f) => s + (entries[b.broker_id]?.[f.key] || 0), 0);
                          const inactive = b.active === false;
                          const bm = brokerMonth[b.broker_id];
                          const isExp = !!expandedBroker[b.broker_id];
                          return (
                            <div key={b.broker_id} className={inactive ? "opacity-40 grayscale bg-muted/10" : "hover:bg-primary/5"}>
                            <div
                              className={`grid grid-cols-3 md:!grid gap-2 px-3 py-2 items-center transition md:[grid-template-columns:minmax(140px,1.4fr)_repeat(8,minmax(52px,1fr))_56px]`}
                              title={inactive ? "Corretor desligado — histórico preservado, sem novas inserções" : undefined}
                            >
                              <div className="flex items-center gap-2 col-span-3 md:col-span-1 min-w-0">
                                <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary/40 to-fuchsia-500/30 flex items-center justify-center font-black text-xs border border-primary/40 shrink-0">
                                  {b.broker_name.charAt(0).toUpperCase()}
                                </div>
                                <span className="text-xs font-medium truncate flex-1">
                                  {b.broker_name}
                                  {inactive && <span className="ml-1 text-[9px] uppercase text-rose-400">(desligado)</span>}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setExpandedBroker((p) => ({ ...p, [b.broker_id]: !p[b.broker_id] }))}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-primary/30 text-primary/90 hover:bg-primary/10 flex items-center gap-1 shrink-0"
                                  title="Mostrar/ocultar totais do mês"
                                >
                                  <BarChart3 className="h-3 w-3" />
                                  {isExp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                </button>
                              </div>
                              {FIELDS.map((f) => (
                                <div key={f.key} className="flex flex-col md:block min-w-0">
                                  <label className={`md:hidden text-[9px] uppercase font-bold ${f.color} truncate`}>{f.label}</label>
                                  <Input
                                    type="number" min={0} step={0.5}
                                    inputMode="decimal"
                                    disabled={inactive}
                                    value={entries[b.broker_id]?.[f.key] ?? ""}
                                    onChange={(e) => setField(b.broker_id, f.key, e.target.value)}
                                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                    onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(); }}
                                    placeholder="0"
                                    className="h-8 w-full min-w-0 text-center text-xs font-bold px-1 placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 disabled:cursor-not-allowed"
                                  />
                                </div>
                              ))}
                              <Badge variant="outline" className="text-[10px] justify-center col-span-3 md:col-span-1">Total {total}</Badge>
                            </div>
                            {isExp && (
                              <div className="px-3 pb-2 -mt-1">
                                <div className="rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider text-primary/80 font-bold flex items-center gap-1">
                                      <BarChart3 className="h-3 w-3" /> Totais do mês
                                    </span>
                                    <span className="text-[9px] text-muted-foreground">
                                      {bm?.days_filled ? `${bm.days_filled} dia${bm.days_filled === 1 ? "" : "s"} preenchidos` : "sem lançamentos"}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-4 md:grid-cols-8 gap-1">
                                    {FIELDS.map((f) => (
                                      <div key={f.key} className="text-center px-1 py-1 rounded bg-background/40 border border-border/30">
                                        <p className={`text-[9px] uppercase ${f.color} truncate`}>{f.label}</p>
                                        <p className="text-sm font-black">{bm?.[f.key] ?? 0}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                            </div>
                          );
                        })}
                        {roster.some((b) => b.active === false) && (
                          <div className="px-3 py-2 flex justify-center">
                            <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => setShowInactive((v) => !v)}>
                              {showInactive
                                ? "Ocultar corretores desligados"
                                : `Mostrar ${roster.filter((b) => b.active === false).length} corretor${roster.filter((b) => b.active === false).length === 1 ? "" : "es"} desligado${roster.filter((b) => b.active === false).length === 1 ? "" : "s"}`}
                            </Button>
                          </div>
                        )}
                      </div>

                    </Card>

                  </>
                )}

                <Card className="border-primary/20 bg-card/60 backdrop-blur-xl">
                  <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-orange-400" /> Observações do dia</CardTitle></CardHeader>
                  <CardContent>
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contexto, dificuldades, vitórias..." rows={3} className="text-xs" />
                  </CardContent>
                </Card>

                {/* Funis compactos: dia + mês */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <CompactFunnel
                    title="Funil do dia — declarado"
                    subtitle="metas: 100 → 10% → 40% → 50%"
                    accent="hsl(217 91% 60%)"
                    steps={[
                      { key: "leads",     label: "Leads",      value: totals.leads     || 0, targetPct: 100 },
                      { key: "analises",  label: "Análises",   value: totals.analises  || 0, targetPct: 10 },
                      { key: "aprovados", label: "Aprovações", value: totals.aprovados || 0, targetPct: 40 },
                      { key: "vendas",    label: "Vendas",     value: totals.vendas    || 0, targetPct: 50 },
                    ] as FunnelStep[]}
                  />
                  <CompactFunnel
                    title="Funil do mês — acumulado"
                    subtitle="metas: 100 → 10% → 40% → 50%"
                    accent="hsl(280 90% 65%)"
                    steps={[
                      { key: "leads",     label: "Leads",      value: monthTotals.leads     || 0, targetPct: 100 },
                      { key: "analises",  label: "Análises",   value: monthTotals.analises  || 0, targetPct: 10 },
                      { key: "aprovados", label: "Aprovações", value: monthTotals.aprovados || 0, targetPct: 40 },
                      { key: "vendas",    label: "Vendas",     value: monthTotals.vendas    || 0, targetPct: 50 },
                    ] as FunnelStep[]}
                  />
                </div>


                {/* Totals + submit */}
                <Card className="border-primary/40 bg-gradient-to-r from-primary/10 via-fuchsia-500/5 to-primary/10 backdrop-blur-xl sticky bottom-4 shadow-2xl shadow-primary/20">
                  <CardContent className="p-4 flex flex-col items-center gap-3">
                    <div className="grid grid-cols-4 md:grid-cols-8 gap-3 justify-items-center w-full max-w-2xl">
                      {FIELDS.map((f) => (
                        <div key={f.key} className="text-center min-w-0">
                          <p className="text-[9px] uppercase text-muted-foreground truncate">{f.label}</p>
                          <p className={`text-lg font-black ${f.color}`}>{totals[f.key]}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2 w-full">
                      <Button size="lg" variant="outline" onClick={() => setFormOpen(false)}>
                        Fechar
                      </Button>
                      <Button size="lg" onClick={submit} disabled={submitting || roster.length === 0} className="bg-gradient-to-r from-primary to-fuchsia-500 hover:opacity-90">
                        {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                        Salvar Checkpoint
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

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
