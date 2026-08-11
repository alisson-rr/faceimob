import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Loader2, Lock, Target, TrendingUp } from "lucide-react";
import { addDays, endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CompactFunnel } from "@/components/ComparativeFunnel";
import logoWhite from "@/assets/logo-faceimob-white.png";

const MONTH_FIELDS = [
  { key: "leads", label: "Leads", color: "text-cyan-400" },
  { key: "ligacoes", label: "Ligações", color: "text-sky-400" },
  { key: "coleta_docs", label: "Coleta Docs", color: "text-indigo-400" },
  { key: "visitas_agendadas", label: "Visita Agend.", color: "text-fuchsia-400" },
  { key: "visitas_realizadas", label: "Visita Real.", color: "text-pink-400" },
  { key: "analises", label: "Análise Env.", color: "text-amber-400" },
  { key: "aprovados", label: "Análise Aprov.", color: "text-emerald-400" },
  { key: "vendas", label: "Venda", color: "text-yellow-400" },
] as const;

type TeamOut = {
  id: string;
  name: string;
  slug: string;
  manager_name: string | null;
  aggr: { leads: number; ligacoes: number; coleta_docs: number; enviadas: number; aprovadas: number; vendas: number };
  targets: { analise_enviada_pct: number; aprovada_pct: number; venda_pct: number };
};

type MissingDay = { date: string; teams: { id: string; name: string; manager_name: string | null }[] };

type DirectorPayload = {
  pin_required?: boolean;
  director?: string;
  targets?: {
    lead_to_analysis_pct?: number;
    analysis_to_approval_pct?: number;
    approval_to_sale_pct?: number;
  };
  teams?: Array<{
    team_id?: string;
    team_name?: string;
    daily_slug?: string | null;
    totals?: {
      leads?: number;
      calls?: number;
      doc_collections?: number;
      analyses_sent?: number;
      analyses_approved?: number;
      sales?: number;
    };
    missing_days?: string[];
  }>;
};

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const safeTargets = (value: Partial<TeamOut["targets"]> | null | undefined) => ({
  analise_enviada_pct: Number(value?.analise_enviada_pct) || 10,
  aprovada_pct: Number(value?.aprovada_pct) || 40,
  venda_pct: Number(value?.venda_pct) || 50,
});

const emptyAggr = { leads: 0, ligacoes: 0, coleta_docs: 0, enviadas: 0, aprovadas: 0, vendas: 0 };

function DirectorSummaryCard({
  title,
  aggr,
  targets,
  teams,
  aggregate,
  targetsFor,
}: {
  title: string;
  aggr: typeof emptyAggr;
  targets: TeamOut["targets"];
  teams: TeamOut[];
  aggregate: (teamId: string) => typeof emptyAggr;
  targetsFor: (teamId: string) => TeamOut["targets"];
}) {
  const pEnv = aggr.leads ? (aggr.enviadas / aggr.leads) * 100 : 0;
  const pApr = aggr.enviadas ? (aggr.aprovadas / aggr.enviadas) * 100 : 0;
  const pVen = aggr.aprovadas ? (aggr.vendas / aggr.aprovadas) * 100 : 0;
  const rows = [
    { key: "leads", label: "Leads", value: aggr.leads, pct: 100, target: 100 },
    { key: "env", label: "Análises", value: aggr.enviadas, pct: pEnv, target: targets.analise_enviada_pct },
    { key: "apr", label: "Aprovações", value: aggr.aprovadas, pct: pApr, target: targets.aprovada_pct },
    { key: "ven", label: "Vendas", value: aggr.vendas, pct: pVen, target: targets.venda_pct },
  ];

  return (
    <Card className="border-yellow-400/30 bg-card/60 backdrop-blur-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="h-4 w-4 text-yellow-400" /> Diretor: {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {rows.map((r, i) => {
            const below = i > 0 && r.pct < r.target;
            const above = i > 0 && r.pct >= r.target;
            return (
              <div key={r.key} className={`px-2 py-1.5 rounded-md border bg-secondary/20 ${below ? "border-rose-500/50 bg-rose-500/5" : above ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/40"}`}>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-[9px] uppercase text-muted-foreground truncate">{r.label}</span>
                  {i > 0 && <span className="text-[8px] text-muted-foreground">m{r.target}%</span>}
                </div>
                <div className="flex items-baseline justify-between gap-1">
                  <span className={`text-lg font-black leading-none ${below ? "text-rose-400" : above ? "text-emerald-400" : "text-foreground"}`}>{r.value}</span>
                  <span className={`text-[10px] font-semibold ${below ? "text-rose-400" : above ? "text-emerald-400" : "text-muted-foreground"}`}>{r.pct.toFixed(0)}%</span>
                </div>
                <div className="h-0.5 rounded-full bg-border/50 overflow-hidden mt-1">
                  <div className={below ? "h-full bg-rose-500" : "h-full bg-emerald-500"} style={{ width: `${Math.min(100, r.pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {teams.map((team) => {
            const a = aggregate(team.id);
            const tg = targetsFor(team.id);
            const anPct = a.leads ? (a.enviadas / a.leads) * 100 : 0;
            return (
              <div key={team.id} className="rounded-md border border-border/40 bg-secondary/20 px-2 py-1.5 text-xs">
                <div className="font-semibold truncate">{team.name}</div>
                <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] text-muted-foreground">
                  <span>Leads <b className="text-cyan-400">{a.leads}</b></span>
                  <span>An. <b className={anPct >= tg.analise_enviada_pct ? "text-emerald-400" : "text-rose-400"}>{a.enviadas}</b></span>
                  <span>Aprov. <b className="text-emerald-400">{a.aprovadas}</b></span>
                  <span>Venda <b className="text-yellow-400">{a.vendas}</b></span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PublicDirectorCheckpoint() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const [loading, setLoading] = useState(true);
  const [director, setDirector] = useState<{ name: string } | null>(null);
  const [teams, setTeams] = useState<TeamOut[]>([]);
  const [month, setMonth] = useState<{ totals: Record<string, number>; missing_days: MissingDay[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const [needsPin, setNeedsPin] = useState(false);
  const [pin, setPin] = useState("");
  const [submittedPin, setSubmittedPin] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      const { data, error } = await supabase.rpc("public_director_checkpoint", {
        p_slug: slugify(slug),
        p_week_start: format(weekStart, "yyyy-MM-dd"),
        p_pin: submittedPin,
      });
      if (error) {
        setError("Erro de conexão — tente novamente");
        setTeams([]); setDirector(null); setMonth(null);
      } else {
        const payload = data as DirectorPayload | null;
        if (payload?.pin_required) {
          setNeedsPin(true);
          setTeams([]); setDirector(null); setMonth(null);
          setLoading(false);
          return;
        }
        if (!payload) {
          setNeedsPin(Boolean(submittedPin));
          setError(submittedPin ? "PIN incorreto" : "Link inválido ou inativo");
          setTeams([]); setDirector(null); setMonth(null);
          setLoading(false);
          return;
        }

        setNeedsPin(false);
        const rawTeams = payload.teams || [];
        const safeTeams = rawTeams.map((t) => ({
          id: String(t.team_id || ""),
          name: String(t.team_name || "Equipe"),
          slug: String(t.daily_slug || slugify(String(t.team_name || "equipe"))),
          manager_name: null,
          aggr: {
            leads: Number(t.totals?.leads) || 0,
            ligacoes: Number(t.totals?.calls) || 0,
            coleta_docs: Number(t.totals?.doc_collections) || 0,
            enviadas: Number(t.totals?.analyses_sent) || 0,
            aprovadas: Number(t.totals?.analyses_approved) || 0,
            vendas: Number(t.totals?.sales) || 0,
          },
          targets: safeTargets({
            analise_enviada_pct: payload.targets?.lead_to_analysis_pct,
            aprovada_pct: payload.targets?.analysis_to_approval_pct,
            venda_pct: payload.targets?.approval_to_sale_pct,
          }),
        })).filter((t) => t.id);
        setDirector(payload.director ? { name: payload.director } : null);
        setTeams(safeTeams);
        const totals = safeTeams.reduce((acc: Record<string, number>, team: TeamOut) => {
          acc.leads += team.aggr.leads;
          acc.ligacoes += team.aggr.ligacoes;
          acc.coleta_docs += team.aggr.coleta_docs;
          acc.analises += team.aggr.enviadas;
          acc.aprovados += team.aggr.aprovadas;
          acc.vendas += team.aggr.vendas;
          return acc;
        }, { leads: 0, ligacoes: 0, coleta_docs: 0, analises: 0, aprovados: 0, vendas: 0 });
        const missingByDate = new Map<string, MissingDay>();
        rawTeams.forEach((team) => (team.missing_days || []).forEach((date) => {
          const row = missingByDate.get(date) || { date, teams: [] };
          row.teams.push({ id: String(team.team_id || ""), name: String(team.team_name || "Equipe"), manager_name: null });
          missingByDate.set(date, row);
        }));
        setMonth({ totals, missing_days: Array.from(missingByDate.values()) });
      }
      setLoading(false);
    })();
  }, [attempt, slug, submittedPin, weekStart]);

  const totals = useMemo(() => {
    const acc = { ...emptyAggr };
    teams.forEach(t => {
      acc.leads += t.aggr.leads;
      acc.ligacoes += t.aggr.ligacoes;
      acc.coleta_docs += t.aggr.coleta_docs;
      acc.enviadas += t.aggr.enviadas;
      acc.aprovadas += t.aggr.aprovadas;
      acc.vendas += t.aggr.vendas;
    });
    return acc;
  }, [teams]);

  const targets = safeTargets(teams[0]?.targets);

  const aggregate = (teamId: string) => {
    const t = teams.find(x => x.id === teamId);
    return t ? { ...emptyAggr, ...t.aggr } : emptyAggr;
  };
  const targetsFor = (teamId: string) => safeTargets(teams.find(x => x.id === teamId)?.targets ?? targets);

  const monthFunnelSteps = useMemo(() => {
    const t = month?.totals || {};
    return [
      { key: "leads", label: "Leads", value: t.leads || 0, targetPct: 100 },
      { key: "analises", label: "Análises", value: t.analises || 0, targetPct: 10 },
      { key: "aprovados", label: "Aprovações", value: t.aprovados || 0, targetPct: 40 },
      { key: "vendas", label: "Vendas", value: t.vendas || 0, targetPct: 50 },
    ];
  }, [month]);

  const funnelSummary = useMemo(() => {
    const t: Record<string, number> = month?.totals || {};
    const leads = t.leads || 0, an = t.analises || 0, ap = t.aprovados || 0, vd = t.vendas || 0;
    const pAn = leads ? (an / leads) * 100 : 0;
    const pAp = an ? (ap / an) * 100 : 0;
    const pVd = ap ? (vd / ap) * 100 : 0;
    const issues: string[] = [];
    if (leads && pAn < 10) issues.push(`Conversão de análises baixa (${pAn.toFixed(1)}% / meta 10%)`);
    if (an && pAp < 40) issues.push(`Aprovação abaixo da meta (${pAp.toFixed(1)}% / meta 40%)`);
    if (ap && pVd < 50) issues.push(`Fechamento abaixo da meta (${pVd.toFixed(1)}% / meta 50%)`);
    return { pAn, pAp, pVd, issues };
  }, [month]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0F0E19] via-[#12122a] to-[#0F0E19] text-foreground">
      <div className="max-w-6xl mx-auto p-6 space-y-4">
        <header className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <img src={logoWhite} alt="Faceimob" className="h-8 object-contain" />
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">Checkpoint Semanal — Diretor</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button aria-label="Semana anterior" size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="px-3 py-1 rounded-md border border-primary/30 bg-primary/5 text-xs">
              {format(weekStart, "dd MMM", { locale: ptBR })} — {format(weekEnd, "dd MMM yyyy", { locale: ptBR })}
            </div>
            <Button aria-label="Próxima semana" size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
          </div>
        </header>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…</div>
        ) : needsPin ? (
          <Card className="max-w-md mx-auto border-primary/30 bg-card/60 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-4 w-4 text-primary" /> Acesso da Diretoria</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (pin.length < 4) return;
                  setSubmittedPin(pin);
                  setAttempt((value) => value + 1);
                }}
              >
                <p className="text-xs text-muted-foreground">Digite o PIN entregue pela administração.</p>
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={10}
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                  className="text-center text-2xl tracking-[0.5em] font-bold h-14"
                  autoFocus
                />
                {error && <p className="text-sm text-rose-400 text-center">{error}</p>}
                <Button type="submit" className="w-full" disabled={pin.length < 4}>Entrar</Button>
              </form>
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="p-8 text-center text-sm text-rose-400">{error}</Card>
        ) : !director ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Diretor não encontrado.</Card>
        ) : teams.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma equipe vinculada a este diretor.</Card>
        ) : (
          <div className="space-y-4">
            {/* Preencher daily — links das equipes do diretor */}
            <Card className="border-primary/30 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ExternalLink className="h-4 w-4 text-primary" /> Preencher meu daily
                </CardTitle>
                <p className="text-[10px] text-muted-foreground mt-0.5">Acesse o daily de cada equipe para preenchimento.</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {teams.map(t => (
                  <a key={t.id} href={`/daily/${t.slug}?director=${encodeURIComponent(slug)}`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <ExternalLink className="h-3 w-3" />
                      {t.name}
                    </Button>
                  </a>
                ))}
              </CardContent>
            </Card>

            <DirectorSummaryCard
              title={`${director.name} — Semana ${format(weekStart, "dd/MM")} a ${format(weekEnd, "dd/MM")}`}
              aggr={totals}
              targets={targets}
              teams={teams}
              aggregate={aggregate}
              targetsFor={targetsFor}
            />

            {/* Funil acumulado do mês — mesmo card do Daily */}
            {month && (
              <CompactFunnel
                title={`Funil acumulado — mês de ${format(new Date(), "MMMM", { locale: ptBR })}`}
                subtitle={`metas 100 / 10 / 40 / 50 — soma de todas as equipes`}
                steps={monthFunnelSteps}
                accent="hsl(280 90% 65%)"
              />
            )}

            {/* Resumo textual do funil para o diretor */}
            {month && (
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" /> Resumo do funil
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  <p>Leads → Análises: <span className={funnelSummary.pAn >= 10 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{funnelSummary.pAn.toFixed(1)}%</span> (meta 10%)</p>
                  <p>Análises → Aprovações: <span className={funnelSummary.pAp >= 40 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{funnelSummary.pAp.toFixed(1)}%</span> (meta 40%)</p>
                  <p>Aprovações → Vendas: <span className={funnelSummary.pVd >= 50 ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>{funnelSummary.pVd.toFixed(1)}%</span> (meta 50%)</p>
                  {funnelSummary.issues.length === 0 ? (
                    <p className="text-emerald-400 mt-2">Funil dentro das metas em todas as etapas.</p>
                  ) : (
                    <ul className="mt-2 list-disc list-inside text-rose-400">
                      {funnelSummary.issues.map((i, k) => <li key={k}>{i}</li>)}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            {month && (
              <Card className="border-cyan-400/30 bg-card/60 backdrop-blur-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-cyan-400" /> Resumo do mês ({format(new Date(), "MMMM", { locale: ptBR })}) — Diretoria
                  </CardTitle>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Somatório de todas as equipes do diretor</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-2 justify-items-center max-w-3xl mx-auto">
                    {MONTH_FIELDS.map(f => (
                      <div key={f.key} className="px-2 py-1.5 rounded-md border border-border/40 bg-secondary/20 text-center">
                        <p className="text-[9px] uppercase text-muted-foreground">{f.label}</p>
                        <p className={`text-lg font-black ${f.color}`}>{month.totals?.[f.key] ?? 0}</p>
                      </div>
                    ))}
                  </div>
                  {month.missing_days?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMissingOpen(true)}
                      className="w-full rounded-md border border-rose-500/40 bg-rose-500/5 p-2 flex items-start gap-2 text-left hover:bg-rose-500/10 transition"
                    >
                      <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="text-xs flex-1">
                        <p className="font-bold text-rose-400">
                          Checkpoints não efetuados ({month.missing_days.length} {month.missing_days.length === 1 ? "dia" : "dias"}) — clique para ver quem não preencheu
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          {month.missing_days.map(d => format(parseISO(d.date), "dd/MM", { locale: ptBR })).join(" • ")}
                        </p>
                      </div>
                    </button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <Dialog open={missingOpen} onOpenChange={setMissingOpen}>
          <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-400">
                <AlertTriangle className="h-4 w-4" /> Pendências do mês
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {month?.missing_days?.map(md => (
                <div key={md.date} className="rounded-md border border-border/50 p-3">
                  <p className="text-sm font-bold mb-1.5">{format(parseISO(md.date), "dd/MM (EEEE)", { locale: ptBR })}</p>
                  <ul className="text-xs space-y-1">
                    {md.teams.map(t => (
                      <li key={t.id} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="text-muted-foreground">Gerente:</span>{" "}
                          <span className="font-semibold">{t.manager_name || "—"}</span>
                          <span className="text-muted-foreground"> • {t.name}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {(!month?.missing_days || month.missing_days.length === 0) && (
                <p className="text-center text-sm text-muted-foreground py-4">Sem pendências.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
