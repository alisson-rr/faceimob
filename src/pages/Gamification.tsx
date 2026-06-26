import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trophy, Crown, Medal, Users, Lock, Unlock, Star, TrendingUp, AlertTriangle, Target, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { mockBrokers as fallbackBrokers, mockDeals as fallbackDeals, mockManagers as fallbackManagers } from '@/data/mockData';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useCallback } from 'react';
import { PipelineDeal, Broker } from '@/types/crm';
import { format, parseISO, differenceInDays } from 'date-fns';

// Default scoring weights based on pipeline movements
const DEFAULT_SCORING = {
  incomplete_with_doc: 10,
  envio_esteira_agil: 140,
  approved: 250,
  venda: 600,
  distrato_penalty: -600,
};
type ScoringConfig = typeof DEFAULT_SCORING;

// Directors (3 directorships)
const DIRECTORS = [
  { id: 'dir1', name: 'André Martins', directorship: 'Diretoria A', teams: ['Alpha'] },
  { id: 'dir2', name: 'Paula Ferreira', directorship: 'Diretoria B', teams: ['Beta'] },
  { id: 'dir3', name: 'Lucas Andrade', directorship: 'Diretoria C', teams: ['Gamma'] },
];

interface GameRecord {
  id: string;
  month: string;
  label: string;
  closed: boolean;
  closedAt?: string;
  scores: BrokerScore[];
}

interface BrokerScore {
  brokerId: string;
  brokerName: string;
  team: string;
  managerId?: string;
  managerName?: string;
  directorshipId?: string;
  directorship?: string;
  vendas: number;
  vgv: number;
  points: number;
  breakdown: {
    incompletos: number;
    esteiras: number;
    aprovados: number;
    vendas: number;
    distratos: number;
  };
}

function computeScores(brokers: Broker[], deals: PipelineDeal[], managers: any[], SCORING: ScoringConfig): BrokerScore[] {
  return brokers.filter(b => b.active).map(broker => {
    const brokerDeals = deals.filter(d => d.broker1 === broker.name || d.broker2 === broker.name);
    const incompletos = brokerDeals.filter(d => d.stage === 'incomplete').length;
    const esteiras = brokerDeals.filter(d => d.stage === 'under_analysis').length;
    const aprovados = brokerDeals.filter(d => d.stage === 'approved').length;
    const vendas = brokerDeals.filter(d => d.stage === 'closed' && d.active).length;
    const distratos = brokerDeals.filter(d => d.stage === 'closed' && !d.active).length;
    const totalVgv = brokerDeals.reduce((s, d) => s + (d.deal_value || 0), 0);

    const points =
      incompletos * SCORING.incomplete_with_doc +
      esteiras * SCORING.envio_esteira_agil +
      aprovados * SCORING.approved +
      vendas * SCORING.venda +
      distratos * SCORING.distrato_penalty;

    const manager = managers.find(m => m.team === broker.team);
    const director = DIRECTORS.find(d => d.teams.includes(broker.team || ''));

    return {
      brokerId: broker.id,
      brokerName: broker.name,
      team: broker.team || 'Default',
      managerId: manager?.id,
      managerName: manager?.name,
      directorshipId: director?.id,
      directorship: director?.directorship,
      vendas,
      vgv: totalVgv,
      points: Math.max(0, points),
      breakdown: { incompletos, esteiras, aprovados, vendas, distratos },
    };
  }).sort((a, b) => b.points - a.points);
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function getMonthLabel(date: Date) {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const MedalIcon = ({ position }: { position: number }) => {
  if (position === 0) return <Crown className="h-5 w-5 text-yellow-400" />;
  if (position === 1) return <Medal className="h-5 w-5 text-gray-300" />;
  if (position === 2) return <Medal className="h-5 w-5 text-amber-600" />;
  return <span className="text-muted-foreground font-mono text-sm">{position + 1}</span>;
};

export default function Gamification() {
  const { role } = useAuth();
  const { toast } = useToast();
  const isAdmin = role === 'admin';

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRealData = useCallback(async () => {
    setLoading(true);
    try {
      const [brokersRes, dealsRes] = await Promise.all([
        supabase.from('brokers').select('*').order('name'),
        supabase.from('deals').select(`
          *,
          broker1:brokers!deals_broker1_id_fkey(name),
          broker2:brokers!deals_broker2_id_fkey(name),
          manager1:brokers!deals_manager1_id_fkey(name),
          manager2:brokers!deals_manager2_id_fkey(name)
        `)
      ]);

      if (brokersRes.error) throw brokersRes.error;
      if (dealsRes.error) throw dealsRes.error;

      const mappedBrokers: Broker[] = (brokersRes.data || []).map(b => ({
        id: b.id,
        name: b.name,
        active: true,
        monthly_sales: 0,
        monthly_vgv: 0,
        team: 'Default'
      }));

      const mappedDeals: PipelineDeal[] = (dealsRes.data || []).map(d => ({
        ...d,
        broker1: (d.broker1 as any)?.name || '',
        broker2: (d.broker2 as any)?.name || undefined,
        manager1: (d.manager1 as any)?.name || '',
        manager2: (d.manager2 as any)?.name || undefined,
        days_in_pipeline: differenceInDays(new Date(), parseISO(d.created_at || new Date().toISOString())),
      })) as any[];

      setBrokers(mappedBrokers);
      setDeals(mappedDeals);
    } catch (error) {
      console.error('Error fetching game data:', error);
      toast({ title: "Erro ao carregar dados do Game", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRealData();
  }, [fetchRealData]);

  const [closedGames, setClosedGames] = useState<GameRecord[]>([]);
  const [scoring, setScoring] = useState<ScoringConfig>(DEFAULT_SCORING);
  const [pendingScoring, setPendingScoring] = useState<ScoringConfig>(DEFAULT_SCORING);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  const currentScores = useMemo(() => computeScores(brokers, deals, [], scoring), [brokers, deals, scoring]);
  const isCurrentMonth = selectedMonth === currentMonthKey;
  const closedGame = closedGames.find(g => g.month === selectedMonth);
  const scores = closedGame ? closedGame.scores : currentScores;
  const isClosed = !!closedGame?.closed;

  const handleCloseGame = () => {
    if (!isAdmin) return;
    const label = getMonthLabel(now);
    setClosedGames(prev => [...prev, {
      id: `game-${currentMonthKey}`,
      month: currentMonthKey,
      label,
      closed: true,
      closedAt: new Date().toISOString(),
      scores: [...currentScores],
    }]);
    setScoring(pendingScoring);
    setCloseConfirmOpen(false);
    toast({ title: `Game "${label}" fechado! Nova pontuação aplicada ao próximo ciclo.` });
  };

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string; closed: boolean }[] = [];
    closedGames.forEach(g => opts.push({ value: g.month, label: g.label, closed: true }));
    if (!closedGames.find(g => g.month === currentMonthKey)) {
      opts.push({ value: currentMonthKey, label: getMonthLabel(now) + ' (ativo)', closed: false });
    }
    return opts.sort((a, b) => b.value.localeCompare(a.value));
  }, [closedGames, currentMonthKey]);

  const top3General = scores.slice(0, 3);

  const directorshipRankings = DIRECTORS.map(dir => {
    const dirScores = scores.filter(s => s.directorship === dir.directorship).sort((a, b) => b.points - a.points);
    return { ...dir, top3: dirScores.slice(0, 3), all: dirScores };
  });

  const managerRankings = useMemo(() => {
    const grouped: Record<string, { manager: string; scores: BrokerScore[] }> = {};
    scores.forEach(s => {
      const key = s.managerName || 'Sem Gerente';
      if (!grouped[key]) grouped[key] = { manager: key, scores: [] };
      grouped[key].scores.push(s);
    });
    return Object.values(grouped).map(g => ({
      ...g,
      scores: g.scores.sort((a, b) => b.points - a.points),
    }));
  }, [scores]);

  const displayLabel = closedGame ? closedGame.label : getMonthLabel(now);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {loading && (
        <div className="flex items-center justify-center p-8">
          <RefreshCw className="h-8 w-8 animate-spin text-warning" />
          <span className="ml-2">Carregando dados reais...</span>
        </div>
      )}
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-3">
          <Crown className="h-8 w-8 text-warning" />
          <h1 className="text-3xl font-bold text-foreground">Ranking Geral</h1>
          <Crown className="h-8 w-8 text-warning" />
        </div>
        <p className="text-muted-foreground">Gamificação • Ranking Mensal</p>
      </div>

      {/* Month selector + close game */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-[260px] border-warning/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>
                {o.label} {o.closed ? '(fechado)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isClosed && (
          <Badge variant="outline" className="border-warning/40 text-warning gap-1">
            <Lock className="h-3 w-3" /> Mês fechado
          </Badge>
        )}

        {isAdmin && isCurrentMonth && !isClosed && (
          <Button variant="destructive" size="sm" onClick={() => setCloseConfirmOpen(true)} className="gap-1">
            <Target className="h-4 w-4" /> Fechar Game
          </Button>
        )}

        {isAdmin && isCurrentMonth && !isClosed && (
          <Badge variant="outline" className="border-green-500/40 text-green-400 gap-1">
            <Unlock className="h-3 w-3" /> Game ativo
          </Badge>
        )}
      </div>

      {/* Scoring weights card */}
      <Card className="glass-subtle border-warning/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
            <Star className="h-4 w-4 text-warning" /> Pontuação por Movimento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 text-xs">
            <Badge variant="secondary" className="gap-1">Incompleto (c/ doc): <span className="text-warning font-bold">{scoring.incomplete_with_doc} pts</span></Badge>
            <Badge variant="secondary" className="gap-1">Envio Esteira Ágil: <span className="text-primary font-bold">{scoring.envio_esteira_agil} pts</span></Badge>
            <Badge variant="secondary" className="gap-1">Aprovado: <span className="text-green-400 font-bold">{scoring.approved} pts</span></Badge>
            <Badge variant="secondary" className="gap-1">Venda: <span className="text-yellow-400 font-bold">{scoring.venda} pts</span></Badge>
            <Badge variant="secondary" className="gap-1">Distrato/Queda: <span className="text-destructive font-bold">{scoring.distrato_penalty} pts</span></Badge>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList className="grid grid-cols-3 w-full max-w-md mx-auto">
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="diretoria">Diretorias</TabsTrigger>
          <TabsTrigger value="gerencia">Gerências</TabsTrigger>
        </TabsList>

        {/* ========== GERAL ========== */}
        <TabsContent value="geral" className="space-y-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" /> Campeões Gerais — {displayLabel}
          </h2>

          {/* Top 3 podium */}
          <div className="grid grid-cols-3 gap-4">
            {top3General.map((s, i) => (
              <Card key={s.brokerId} className={`text-center glass ${i === 0 ? 'border-yellow-500/40 glow-warning' : i === 1 ? 'border-gray-400/30' : 'border-amber-700/30'}`}>
                <CardContent className="pt-6 space-y-2">
                  <MedalIcon position={i} />
                  <p className="font-semibold text-foreground">{s.brokerName}</p>
                  <p className="text-xs text-muted-foreground">{s.team}</p>
                  <p className="text-2xl font-bold text-warning">{s.points}</p>
                  <p className="text-xs text-muted-foreground">pontos</p>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>{s.vendas} vendas</p>
                    <p>VGV: {(s.vgv / 1000000).toFixed(1)}M</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Full ranking table */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" /> Ranking Completo — {displayLabel}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Corretor</TableHead>
                    <TableHead>Equipe</TableHead>
                    <TableHead className="text-center">Vendas</TableHead>
                    <TableHead className="text-right">VGV</TableHead>
                    <TableHead className="text-right">Pontos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scores.map((s, i) => (
                    <TableRow key={s.brokerId} className={i < 3 ? 'bg-warning/5' : ''}>
                      <TableCell><MedalIcon position={i} /></TableCell>
                      <TableCell className="font-medium">{s.brokerName}</TableCell>
                      <TableCell className="text-muted-foreground">{s.team}</TableCell>
                      <TableCell className="text-center">{s.vendas}</TableCell>
                      <TableCell className="text-right">{(s.vgv / 1000).toFixed(0)}k</TableCell>
                      <TableCell className="text-right font-bold text-warning">{s.points}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== DIRETORIAS ========== */}
        <TabsContent value="diretoria" className="space-y-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Crown className="h-5 w-5 text-warning" /> Campeões da Semana por Diretoria
          </h2>
          <p className="text-sm text-muted-foreground">Premiação toda segunda-feira — Top 3 de cada diretoria</p>

          {directorshipRankings.map(dir => (
            <Card key={dir.id} className="glass">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> {dir.directorship} — {dir.name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dir.all.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum corretor nesta diretoria</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Corretor</TableHead>
                        <TableHead>Gerente</TableHead>
                        <TableHead className="text-center">Vendas</TableHead>
                        <TableHead className="text-right">Pontos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dir.all.map((s, i) => (
                        <TableRow key={s.brokerId} className={i < 3 ? 'bg-warning/5' : ''}>
                          <TableCell><MedalIcon position={i} /></TableCell>
                          <TableCell className="font-medium">{s.brokerName}</TableCell>
                          <TableCell className="text-muted-foreground">{s.managerName || '—'}</TableCell>
                          <TableCell className="text-center">{s.vendas}</TableCell>
                          <TableCell className="text-right font-bold text-warning">{s.points}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ========== GERÊNCIAS ========== */}
        <TabsContent value="gerencia" className="space-y-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-warning" /> Campeões por Gerência
          </h2>

          {managerRankings.map(mr => (
            <Card key={mr.manager} className="glass">
              <CardHeader>
                <CardTitle className="text-base">{mr.manager}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Corretor</TableHead>
                      <TableHead>Equipe</TableHead>
                      <TableHead className="text-center">Vendas</TableHead>
                      <TableHead className="text-right">Pontos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mr.scores.map((s, i) => (
                      <TableRow key={s.brokerId} className={i < 3 ? 'bg-warning/5' : ''}>
                        <TableCell><MedalIcon position={i} /></TableCell>
                        <TableCell className="font-medium">{s.brokerName}</TableCell>
                        <TableCell className="text-muted-foreground">{s.team}</TableCell>
                        <TableCell className="text-center">{s.vendas}</TableCell>
                        <TableCell className="text-right font-bold text-warning">{s.points}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {/* ── CLOSE GAME CONFIRMATION DIALOG ─── */}
      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="glass-strong max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-destructive" />
              Fechar Game do Mês
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Ao fechar o game, a pontuação será congelada para{' '}
              <strong className="text-foreground">{getMonthLabel(now)}</strong>{' '}
              e um novo mês será criado com pontuações zeradas.
            </p>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Esta ação não pode ser desfeita. O mês pode ser fechado mesmo após o dia 05 do mês seguinte.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleCloseGame}>
              Confirmar Fechamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
