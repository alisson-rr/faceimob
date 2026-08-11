import { useState, useMemo, useEffect, useCallback } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { GamificationAdmin, GamificationBanners } from '@/components/GamificationAdmin';
import { motion } from "framer-motion";
import {
  closeGameSeason,
  getCurrentSeasonId,
  listEffectiveScoringRules,
  listRanking,
  listSeasonResults,
  listSeasons,
  setDefaultScoringPoints,
  type RankingRow,
  type ScoringRule,
} from '@/integrations/supabase/game';

// Os pesos vivem em `game_scoring_rules`; estes rótulos só traduzem o código do
// banco para a tela. Os códigos são os de `game_events.event_code` — o front
// usava um vocabulário próprio que nunca casaria com o que o banco pontua.
const EVENT_LABELS: Record<string, string> = {
  incompleto_com_doc: 'Incompleto (c/ doc)',
  esteira: 'Envio Esteira Ágil',
  aprovado: 'Aprovado',
  venda: 'Venda',
  distrato: 'Distrato/Queda',
};
type ScoringConfig = Record<string, number>;

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

/**
 * Monta as linhas da tela a partir do ranking do servidor.
 *
 * Os pontos vêm de `visible_game_ranking` (agregação de `game_events`), não de um
 * cálculo sobre `deals`: o cálculo no cliente dependia de pesos em `useState`,
 * então cada usuário podia ver um ranking diferente e nada era auditável.
 */
function buildScores(
  ranking: RankingRow[],
): BrokerScore[] {
  return ranking
    .filter((row) => row.active)
    .map((row) => {
      const breakdown = row.breakdown ?? {};
      return {
        brokerId: row.profile_id,
        brokerName: row.full_name,
        team: row.team_name || 'Sem equipe',
        managerId: row.manager_id ?? undefined,
        managerName: row.manager_name ?? undefined,
        directorshipId: row.director_id ?? undefined,
        directorship: row.director_name ?? undefined,
        vendas: row.sales,
        vgv: Number(row.vgv),
        points: row.points,
        breakdown: {
          incompletos: Number(breakdown.incompleto_com_doc ?? 0),
          esteiras: Number(breakdown.esteira ?? 0),
          aprovados: Number(breakdown.aprovado ?? 0),
          vendas: Number(breakdown.venda ?? 0),
          distratos: Number(breakdown.distrato ?? 0),
        },
      };
    })
    .sort((a, b) => b.points - a.points);
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

  const now = useMemo(() => new Date(), []);
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [loading, setLoading] = useState(true);

  const [closedGames, setClosedGames] = useState<GameRecord[]>([]);
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [scoring, setScoring] = useState<ScoringConfig>({});
  const [pendingScoring, setPendingScoring] = useState<ScoringConfig>({});
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [closing, setClosing] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  /** Temporada corrente, regras vigentes, ranking e histórico congelado. */
  const fetchGameState = useCallback(async () => {
    setLoading(true);
    try {
      const current = await getCurrentSeasonId();

      const [effectiveRules, allSeasons, currentRanking] = await Promise.all([
        listEffectiveScoringRules(current),
        listSeasons(),
        current ? listRanking(current) : Promise.resolve([]),
      ]);
      setRules(effectiveRules);
      const asMap = Object.fromEntries(effectiveRules.map((r) => [r.event_code, r.points]));
      setScoring(asMap);
      setPendingScoring(asMap);

      setRanking(currentRanking);

      // Temporadas fechadas trazem o ranking congelado em game_season_results.
      // Nome, equipe e diretoria vêm do escopo atual — o resultado
      // numérico é o congelado; só a identificação é resolvida na leitura.
      const currentById = new Map(currentRanking.map((row) => [row.profile_id, row]));
      const closed = allSeasons.filter((s) => s.closed_at);
      const records = await Promise.all(
        closed.map(async (s) => {
          const results = await listSeasonResults(s.id);
          return {
            id: s.id,
            month: s.period_start.slice(0, 7),
            label: s.label,
            closed: true,
            closedAt: s.closed_at ?? undefined,
            scores: results.filter((r) => currentById.has(r.profile_id)).map((r) => {
              const person = currentById.get(r.profile_id);
              return {
                brokerId: r.profile_id,
                brokerName: person?.full_name ?? '—',
                team: person?.team_name || 'Sem equipe',
                managerId: person?.manager_id ?? undefined,
                managerName: person?.manager_name ?? undefined,
                directorshipId: person?.director_id ?? undefined,
                directorship: person?.director_name ?? undefined,
                vendas: r.sales,
                vgv: Number(r.vgv),
                points: r.points,
                breakdown: {
                  incompletos: Number(r.breakdown?.incompleto_com_doc ?? 0),
                  esteiras: Number(r.breakdown?.esteira ?? 0),
                  aprovados: Number(r.breakdown?.aprovado ?? 0),
                  vendas: Number(r.breakdown?.venda ?? 0),
                  distratos: Number(r.breakdown?.distrato ?? 0),
                },
              };
            }) as BrokerScore[],
          };
        }),
      );
      setClosedGames(records);
    } catch (error) {
      console.error('Falha ao carregar o estado do jogo:', error);
      toast({ title: 'Erro ao carregar a gamificação', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchGameState(); }, [fetchGameState]);

  const currentScores = useMemo(
    () => buildScores(ranking),
    [ranking],
  );
  const isCurrentMonth = selectedMonth === currentMonthKey;
  const closedGame = closedGames.find(g => g.month === selectedMonth);
  const scores = closedGame ? closedGame.scores : currentScores;
  const isClosed = !!closedGame?.closed;

  /**
   * Encerra a temporada de verdade.
   *
   * `close_game_season()` congela o ranking em `game_season_results` e abre a
   * próxima na mesma transação — a versão anterior só empilhava um objeto em
   * `useState`, então o "fechamento mensal zerando o jogo" (ata 14/07) sumia no
   * primeiro reload. Os pesos novos são gravados ANTES do fechamento para valer
   * já na temporada que abre.
   */
  const handleCloseGame = async () => {
    if (!isAdmin || closing) return;
    setClosing(true);
    try {
      const changed = rules.filter((r) => pendingScoring[r.event_code] !== scoring[r.event_code]);
      for (const rule of changed) {
        await setDefaultScoringPoints(rule.event_code, rule.label, pendingScoring[rule.event_code]);
      }

      const label = getMonthLabel(now);
      await closeGameSeason(undefined, true);
      await fetchGameState();
      setCloseConfirmOpen(false);
      toast({ title: `Temporada "${label}" encerrada. Ranking congelado e novo ciclo aberto.` });
    } catch (e) {
      toast({
        title: 'Não foi possível encerrar a temporada',
        description: e instanceof Error ? e.message : 'Erro desconhecido',
        variant: 'destructive',
      });
    } finally {
      setClosing(false);
    }
  };

  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string; closed: boolean }[] = [];
    closedGames.forEach(g => opts.push({ value: g.month, label: g.label, closed: true }));
    if (!closedGames.find(g => g.month === currentMonthKey)) {
      opts.push({ value: currentMonthKey, label: getMonthLabel(now) + ' (ativo)', closed: false });
    }
    return opts.sort((a, b) => b.value.localeCompare(a.value));
  }, [closedGames, currentMonthKey, now]);

  const top3General = scores.slice(0, 3);

  // Diretorias reais: agrupa o placar pelos director_id das equipes.
  const directorshipRankings = useMemo(() => {
    const byDir = new Map<string, { id: string; name: string; all: BrokerScore[] }>();
    scores.forEach(s => {
      if (!s.directorshipId) return;
      const cur = byDir.get(s.directorshipId) ?? { id: s.directorshipId, name: s.directorship || '—', all: [] };
      cur.all.push(s);
      byDir.set(s.directorshipId, cur);
    });
    return Array.from(byDir.values())
      .map(d => ({ ...d, all: [...d.all].sort((a, b) => b.points - a.points) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [scores]);

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
          <Button variant="destructive" size="sm" onClick={() => { setPendingScoring(scoring); setCloseConfirmOpen(true); }} className="gap-1">
            <Target className="h-4 w-4" /> Fechar Gameficação
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
            {rules.map((rule) => (
              <Badge key={rule.event_code} variant="secondary" className="gap-1">
                {EVENT_LABELS[rule.event_code] ?? rule.label}:{' '}
                <span className={rule.points < 0 ? 'text-destructive font-bold' : 'text-primary font-bold'}>
                  {rule.points} pts
                </span>
              </Badge>
            ))}
            {rules.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Nenhuma regra de pontuação ativa em <code>game_scoring_rules</code>.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <GamificationBanners />

      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList className={`grid ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'} w-full max-w-lg mx-auto`}>
          <TabsTrigger value="geral">Geral</TabsTrigger>
          <TabsTrigger value="diretoria">Diretorias</TabsTrigger>
          <TabsTrigger value="gerencia">Gerências</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
        </TabsList>

        {/* ========== GERAL ========== */}
        <TabsContent value="geral" className="space-y-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5 text-warning" /> Campeões Gerais — {displayLabel}
          </h2>

          {/* Top 3 podium */}
          <div className="grid grid-cols-3 gap-4">
            {top3General.map((s, i) => (
              // Pódio animado (ata 14/07: ranking mais atrativo que o Bubble).
              // A ordem de entrada é 3º → 2º → 1º e a altura acompanha a
              // colocação: o primeiro chega por último e fica acima dos outros.
              <motion.div
                key={s.brokerId}
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={{ opacity: 1, y: i === 0 ? -12 : 0, scale: i === 0 ? 1.04 : 1 }}
                transition={{ delay: (2 - i) * 0.18, type: "spring", stiffness: 200, damping: 16 }}
              >
                <Card className={`text-center glass h-full ${i === 0 ? 'border-yellow-500/40 glow-warning' : i === 1 ? 'border-gray-400/30' : 'border-amber-700/30'}`}>
                  <CardContent className="pt-6 space-y-2">
                    <motion.div
                      animate={i === 0 ? { scale: [1, 1.18, 1] } : undefined}
                      transition={i === 0 ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" } : undefined}
                      className="flex justify-center"
                    >
                      <MedalIcon position={i} />
                    </motion.div>
                    <p className="font-semibold text-foreground">{s.brokerName}</p>
                    <p className="text-xs text-muted-foreground">{s.team}</p>
                    <motion.p
                      key={s.points}
                      initial={{ scale: 1.4, color: "#fbbf24" }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 14 }}
                      className="text-2xl font-bold text-warning"
                    >
                      {s.points}
                    </motion.p>
                    <p className="text-xs text-muted-foreground">pontos</p>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <p>{s.vendas} vendas</p>
                      <p>VGV: {(s.vgv / 1000000).toFixed(1)}M</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
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

          {directorshipRankings.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma diretoria configurada — defina o diretor de cada equipe em Equipes.
            </p>
          )}

          {directorshipRankings.map(dir => (
            <Card key={dir.id} className="glass">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Diretoria {dir.name}
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

        {isAdmin && (
          <TabsContent value="admin" className="space-y-4">
            <GamificationAdmin />
          </TabsContent>
        )}
      </Tabs>

      {/* ── CLOSE GAME CONFIRMATION DIALOG ─── */}
      <Dialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <DialogContent className="glass-strong max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-destructive" />
              Fechar Gameficação & Definir Próximo Ciclo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Congela a pontuação de <strong className="text-foreground">{getMonthLabel(now)}</strong> e inicia um novo ciclo com os pontos definidos abaixo para cada movimento.
            </p>

            <div className="grid grid-cols-2 gap-3">
              {rules.map((rule) => (
                <div key={rule.event_code} className="space-y-1">
                  <Label className="text-xs">{EVENT_LABELS[rule.event_code] ?? rule.label}</Label>
                  <Input
                    type="number"
                    value={pendingScoring[rule.event_code] ?? rule.points}
                    onChange={(e) =>
                      setPendingScoring(p => ({ ...p, [rule.event_code]: Number(e.target.value) }))
                    }
                    className="h-8"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Esta ação não pode ser desfeita. As novas pontuações valem a partir do próximo ciclo.
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleCloseGame} disabled={closing}>
              {closing ? 'Encerrando...' : 'Confirmar Fechamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
