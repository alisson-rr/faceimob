import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, Loader2, Target, TrendingUp } from "lucide-react";
import { addDays, endOfWeek, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DirectorFunnelCard } from "@/pages/Checkpoint";
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

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      const { data, error } = await supabase.functions.invoke("director-weekly", {
        body: { slug, week_start: format(weekStart, "yyyy-MM-dd") },
      });
      if (error || (data as any)?.error) {
        setError((data as any)?.error || error?.message || "Erro ao carregar");
        setTeams([]); setDirector(null); setMonth(null);
      } else {
        setDirector((data as any).director);
        setTeams((data as any).teams || []);
        setMonth((data as any).month || null);
      }
      setLoading(false);
    })();
  }, [slug, weekStart]);

  const totals = useMemo(() => {
    const acc = { leads: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
    teams.forEach(t => { acc.leads += t.aggr.leads; acc.enviadas += t.aggr.enviadas; acc.aprovadas += t.aggr.aprovadas; acc.vendas += t.aggr.vendas; });
    return acc;
  }, [teams]);

  const targets = teams[0]?.targets ?? { analise_enviada_pct: 10, aprovada_pct: 40, venda_pct: 50 };

  const teamRows = teams.map(t => ({ id: t.id, name: t.name, display_name: t.name, manager_id: null } as any));
  const aggregate = (teamId: string) => {
    const t = teams.find(x => x.id === teamId);
    return t ? { ...t.aggr } : { leads: 0, ligacoes: 0, coleta_docs: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
  };
  const targetsFor = (teamId: string) => teams.find(x => x.id === teamId)?.targets ?? targets;
  const teamNameFor = (t: any) => t.name;

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
    const t = month?.totals || {} as any;
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
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="px-3 py-1 rounded-md border border-primary/30 bg-primary/5 text-xs">
              {format(weekStart, "dd MMM", { locale: ptBR })} — {format(weekEnd, "dd MMM yyyy", { locale: ptBR })}
            </div>
            <Button size="sm" variant="outline" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Hoje</Button>
          </div>
        </header>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Carregando…</div>
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

            <DirectorFunnelCard
              title={`${director.name} — Semana ${format(weekStart, "dd/MM")} a ${format(weekEnd, "dd/MM")}`}
              aggr={totals}
              targets={targets}
              teams={teamRows}
              aggregate={aggregate}
              targetsFor={targetsFor}
              teamNameFor={teamNameFor}
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
