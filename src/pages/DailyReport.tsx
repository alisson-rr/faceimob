import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Swords, Shield, Flame, Trophy, Sparkles, Lock, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import logoWhite from "@/assets/logo-faceimob-white.png";

type Roster = { broker_id: string; broker_name: string };
type TeamInfo = { team_id: string; team_name: string; has_pin: boolean };

const FIELDS = [
  { key: "leads", label: "Leads", color: "text-cyan-400" },
  { key: "ligacoes", label: "Ligações", color: "text-sky-400" },
  { key: "coleta_docs", label: "Coleta Docs", color: "text-indigo-400" },
  { key: "analises", label: "Análise Env.", color: "text-amber-400" },
  { key: "aprovados", label: "Análise Aprov.", color: "text-emerald-400" },
  { key: "vendas", label: "Venda", color: "text-yellow-400" },
] as const;

type FieldKey = typeof FIELDS[number]["key"];
type EntryState = Record<string, Record<FieldKey, number>>;

export default function DailyReport() {
  const { teamId } = useParams<{ teamId: string }>();
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

  useEffect(() => {
    if (!teamId) return;
    (async () => {
      const { data } = await supabase.functions.invoke("daily-team-info", { body: { team_id: teamId } });
      if (data?.info) setTeam(data.info as TeamInfo);
    })();
  }, [teamId]);

  const totals = useMemo(() => {
    const t: Record<FieldKey, number> = FIELDS.reduce((a, f) => ({ ...a, [f.key]: 0 }), {} as Record<FieldKey, number>);
    Object.values(entries).forEach((row) => FIELDS.forEach((f) => { t[f.key] += row[f.key] || 0; }));
    return t;
  }, [entries]);

  const xpEarned = totals.vendas * 100 + totals.aprovados * 40 + totals.analises * 10 + totals.leads;

  const handleUnlock = async () => {
    if (!pin || pin.length < 4) return toast({ title: "Digite o PIN da equipe" });
    const { data, error } = await supabase.functions.invoke("daily-team-info", { body: { team_id: teamId, pin } });
    if (error || !data?.pin_ok) {
      return toast({ title: "PIN incorreto", variant: "destructive" });
    }
    const list = (data.roster as Roster[]) ?? [];
    setRoster(list);
    const initial: EntryState = {};
    list.forEach((b) => {
      initial[b.broker_id] = FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: 0 }), {} as Record<FieldKey, number>);
    });
    setEntries(initial);
    setUnlocked(true);
  };

  const setField = (bid: string, key: FieldKey, val: string) => {
    const n = Math.max(0, Math.min(9999, parseInt(val || "0", 10) || 0));
    setEntries((prev) => ({ ...prev, [bid]: { ...prev[bid], [key]: n } }));
  };

  const submit = async () => {
    if (!filledBy.trim()) return toast({ title: "Informe seu nome" });
    setSubmitting(true);
    const payload = {
      team_id: teamId, pin, report_date: date, filled_by_name: filledBy, notes: notes || null,
      entries: roster.map((b) => ({ broker_id: b.broker_id, broker_name: b.broker_name, ...entries[b.broker_id] })),
    };
    const { data, error } = await supabase.functions.invoke("submit-daily-report", { body: payload });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      return toast({ title: "Falha ao enviar", description: (data as any)?.error || error?.message, variant: "destructive" });
    }
    setXpBurst(xpEarned);
    toast({ title: `🎮 Missão concluída! +${xpEarned} XP`, description: "Dados da equipe registrados." });
    setTimeout(() => setXpBurst(0), 3000);
  };

  if (!teamId) return <div className="p-8 text-center">Equipe inválida.</div>;

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
            <Swords className="h-3 w-3 text-primary" /> Missão Diária
          </div>
          <h1 className="text-4xl font-black bg-gradient-to-r from-primary via-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">
            {team?.team_name ?? "Carregando equipe..."}
          </h1>
          <p className="text-xs text-muted-foreground">Registre a performance da guilda de hoje</p>
        </header>

        {!unlocked ? (
          <Card className="max-w-md mx-auto border-primary/30 bg-card/60 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-4 w-4 text-primary" /> Portão da Guilda</CardTitle>
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
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" />
                </CardContent>
              </Card>
              <Card className="border-primary/30 bg-card/60 backdrop-blur-xl">
                <CardContent className="p-3">
                  <label className="text-[10px] uppercase text-muted-foreground">Gerente</label>
                  <Input value={filledBy} onChange={(e) => setFilledBy(e.target.value)} placeholder="Seu nome" className="h-8 text-xs" />
                </CardContent>
              </Card>
              <Card className="border-yellow-400/40 bg-yellow-400/5 backdrop-blur-xl">
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase text-muted-foreground">XP acumulado</p>
                    <p className="text-xl font-black text-yellow-400">{xpEarned.toLocaleString()}</p>
                  </div>
                  <Trophy className="h-8 w-8 text-yellow-400" />
                </CardContent>
              </Card>
            </div>

            {/* Broker cards */}
            {roster.length === 0 ? (
              <Card className="p-8 text-center text-sm text-muted-foreground">Nenhum corretor vinculado a esta equipe.</Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {roster.map((b, i) => (
                  <Card key={b.broker_id} className="border-primary/20 bg-card/60 backdrop-blur-xl hover:border-primary/50 transition group">
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-3">
                        <div className="relative w-11 h-11 rounded-lg bg-gradient-to-br from-primary/40 to-fuchsia-500/30 flex items-center justify-center font-black text-lg border border-primary/40">
                          {b.broker_name.charAt(0).toUpperCase()}
                          <Shield className="absolute -bottom-1 -right-1 h-4 w-4 text-cyan-400 bg-background rounded-full p-0.5" />
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-sm">{b.broker_name}</CardTitle>
                          <p className="text-[10px] text-muted-foreground">Nível {Math.floor(i / 2) + 1} · Guerreiro</p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {FIELDS.reduce((s, f) => s + (entries[b.broker_id]?.[f.key] || 0), 0)} ações
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-4 gap-2">
                        {FIELDS.map((f) => (
                          <div key={f.key}>
                            <label className={`text-[9px] uppercase font-bold ${f.color}`}>{f.label}</label>
                            <Input
                              type="number" min={0}
                              value={entries[b.broker_id]?.[f.key] ?? 0}
                              onChange={(e) => setField(b.broker_id, f.key, e.target.value)}
                              className="h-8 text-center text-sm font-bold px-1"
                            />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
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
                  Concluir Missão
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
