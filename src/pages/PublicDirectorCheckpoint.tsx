import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Loader2, Target } from "lucide-react";
import { addDays, endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DirectorFunnelCard } from "@/pages/Checkpoint";
import logoWhite from "@/assets/logo-faceimob-white.png";

type TeamOut = {
  id: string;
  name: string;
  aggr: { leads: number; ligacoes: number; coleta_docs: number; enviadas: number; aprovadas: number; vendas: number };
  targets: { analise_enviada_pct: number; aprovada_pct: number; venda_pct: number };
};

export default function PublicDirectorCheckpoint() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [weekStart, setWeekStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const [loading, setLoading] = useState(true);
  const [director, setDirector] = useState<{ name: string } | null>(null);
  const [teams, setTeams] = useState<TeamOut[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      const { data, error } = await supabase.functions.invoke("director-weekly", {
        body: { slug, week_start: format(weekStart, "yyyy-MM-dd") },
      });
      if (error || (data as any)?.error) {
        setError((data as any)?.error || error?.message || "Erro ao carregar");
        setTeams([]); setDirector(null);
      } else {
        setDirector((data as any).director);
        setTeams((data as any).teams || []);
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

  // Adapters to reuse DirectorFunnelCard from Checkpoint page (same visuals)
  const teamRows = teams.map(t => ({ id: t.id, name: t.name, display_name: t.name, manager_id: null } as any));
  const aggregate = (teamId: string) => {
    const t = teams.find(x => x.id === teamId);
    return t ? { ...t.aggr } : { leads: 0, ligacoes: 0, coleta_docs: 0, enviadas: 0, aprovadas: 0, vendas: 0 };
  };
  const targetsFor = (teamId: string) => teams.find(x => x.id === teamId)?.targets ?? targets;
  const teamNameFor = (t: any) => t.name;

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
          <DirectorFunnelCard
            title={director.name}
            aggr={totals}
            targets={targets}
            teams={teamRows}
            aggregate={aggregate}
            targetsFor={targetsFor}
            teamNameFor={teamNameFor}
          />
        )}
      </div>
    </div>
  );
}
