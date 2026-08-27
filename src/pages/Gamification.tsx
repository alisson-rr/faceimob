import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Crown, Lock, Medal, PauseCircle, Play, Star, Target, Trophy, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { GamificationAdmin, GamificationBanners } from '@/components/GamificationAdmin';
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from '@/components/shared';
import { Podium, type PodiumEntry } from '@/components/engagement';
import { useCurrentSeasonId, useSeasonRanking } from '@/hooks/useGameRanking';
import { brl, date, num } from '@/lib/format';
import { describeError } from '@/lib/supabaseError';
import {
  closeMonthAndSeason,
  gameKeys,
  listEffectiveScoringRules,
  listSeasonResults,
  listSeasons,
  monthStart,
  openGameSeason,
  setDefaultScoringPoints,
  type GameSeason,
  type RankingRow,
  type SeasonResultRow,
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
  avatarUrl: string | null;
}

/**
 * Monta as linhas da tela a partir do ranking do servidor.
 *
 * Os pontos vêm de `visible_game_ranking` (agregação de `game_events`), não de um
 * cálculo sobre `deals`: o cálculo no cliente dependia de pesos em `useState`,
 * então cada usuário podia ver um ranking diferente e nada era auditável.
 */
function buildScores(ranking: RankingRow[]): BrokerScore[] {
  return ranking
    .filter((row) => row.active)
    .map((row) => ({
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
      avatarUrl: row.avatar_url,
    }))
    .sort((a, b) => b.points - a.points);
}

/**
 * Temporada fechada: o número é o congelado em `game_season_results` e só a
 * identificação (nome, equipe, diretoria) é resolvida no ranking de hoje. Quem
 * saiu do escopo do usuário some da lista — é o mesmo recorte do RLS.
 */
function buildFrozenScores(results: SeasonResultRow[], people: Map<string, RankingRow>): BrokerScore[] {
  return results
    .filter((row) => people.has(row.profile_id))
    .map((row) => {
      const person = people.get(row.profile_id) as RankingRow;
      return {
        brokerId: row.profile_id,
        brokerName: person.full_name,
        team: person.team_name || 'Sem equipe',
        managerId: person.manager_id ?? undefined,
        managerName: person.manager_name ?? undefined,
        directorshipId: person.director_id ?? undefined,
        directorship: person.director_name ?? undefined,
        vendas: row.sales,
        vgv: Number(row.vgv),
        points: row.points,
        avatarUrl: person.avatar_url,
      };
    })
    .sort((a, b) => a.points === b.points ? 0 : b.points - a.points);
}

/**
 * O ciclo do jogo não é mês de calendário (decisão de 21/08): começa quando o
 * admin abre e termina quando ele fecha — 02/07 → 05/08 é um ciclo legítimo.
 * A tela mostra o período real, nunca "Agosto 2026" derivado do relógio.
 */
function seasonPeriod(season: GameSeason) {
  return `${date(season.period_start)} → ${season.period_end ? date(season.period_end) : 'em andamento'}`;
}

/** `2026-08-01` → `08/2026`, que é como o mês-base aparece no Pipeline. */
function monthLabel(isoDate: string) {
  const [year, month] = isoDate.split('-');
  return `${month}/${year}`;
}

function nextSeasonLabel() {
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date());
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const MedalIcon = ({ position }: { position: number }) => {
  if (position === 0) return <Crown className="h-5 w-5 text-gold" aria-hidden />;
  if (position === 1) return <Medal className="h-5 w-5 text-silver" aria-hidden />;
  if (position === 2) return <Medal className="h-5 w-5 text-bronze" aria-hidden />;
  return <span className="font-mono text-sm tabular-nums text-muted-foreground">{position + 1}</span>;
};

function RankingTable({ scores, secondColumn }: { scores: BrokerScore[]; secondColumn: 'team' | 'manager' }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Corretor</TableHead>
          <TableHead>{secondColumn === 'team' ? 'Equipe' : 'Gerente'}</TableHead>
          <TableHead className="text-center">Vendas</TableHead>
          <TableHead className="text-right">VGV</TableHead>
          <TableHead className="text-right">Pontos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scores.map((s, i) => (
          <TableRow key={s.brokerId} className={i < 3 ? 'bg-highlight/5' : undefined}>
            <TableCell><MedalIcon position={i} /><span className="sr-only">{i + 1}º</span></TableCell>
            <TableCell className="font-medium">{s.brokerName}</TableCell>
            <TableCell className="text-muted-foreground">
              {secondColumn === 'team' ? s.team : s.managerName || '—'}
            </TableCell>
            <TableCell className="text-center tabular-nums">{num(s.vendas)}</TableCell>
            <TableCell className="text-right tabular-nums">{brl(s.vgv)}</TableCell>
            <TableCell className="text-right font-bold tabular-nums text-primary">{num(s.points)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function Gamification() {
  const { role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = role === 'admin';

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingScoring, setPendingScoring] = useState<Record<string, number>>({});

  const { data: currentSeasonId, isPending: seasonPending } = useCurrentSeasonId();

  const seasonsQuery = useQuery({ queryKey: gameKeys.seasons, queryFn: listSeasons, staleTime: 60_000 });
  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data]);

  const rankingQuery = useSeasonRanking(currentSeasonId);
  const currentRanking = useMemo(() => rankingQuery.data ?? [], [rankingQuery.data]);

  const rulesQuery = useQuery({
    queryKey: gameKeys.rules(currentSeasonId ?? null),
    queryFn: () => listEffectiveScoringRules(currentSeasonId ?? null),
    staleTime: 60_000,
  });
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);

  // Temporada exibida: a aberta por padrão; sem nenhuma aberta, a última fechada.
  const selected = useMemo(
    () => seasons.find((s) => s.id === selectedSeasonId)
      ?? seasons.find((s) => s.id === currentSeasonId)
      ?? seasons[0]
      ?? null,
    [seasons, selectedSeasonId, currentSeasonId],
  );
  const isCurrent = Boolean(selected && selected.id === currentSeasonId);
  const isClosed = Boolean(selected?.closed_at);

  const resultsQuery = useQuery({
    queryKey: gameKeys.results(selected?.id ?? null),
    queryFn: () => listSeasonResults(selected?.id as string),
    enabled: Boolean(selected && isClosed),
    staleTime: 60_000,
  });

  const peopleById = useMemo(
    () => new Map(currentRanking.map((row) => [row.profile_id, row])),
    [currentRanking],
  );

  const scores = useMemo(
    () => (isClosed
      ? buildFrozenScores(resultsQuery.data ?? [], peopleById)
      : buildScores(currentRanking)),
    [isClosed, resultsQuery.data, peopleById, currentRanking],
  );

  const loading = seasonPending || seasonsQuery.isPending
    || (isClosed ? resultsQuery.isPending : rankingQuery.isPending && Boolean(currentSeasonId));
  const loadError = seasonsQuery.error ?? rankingQuery.error ?? resultsQuery.error ?? rulesQuery.error;

  const podium: PodiumEntry[] = scores.slice(0, 3).map((s) => ({
    id: s.brokerId,
    name: s.brokerName,
    points: s.points,
    avatarUrl: s.avatarUrl,
    detail: s.team,
  }));

  // Diretorias reais: agrupa o placar pelos director_id das equipes.
  const directorshipRankings = useMemo(() => {
    const byDir = new Map<string, { id: string; name: string; all: BrokerScore[] }>();
    scores.forEach((s) => {
      if (!s.directorshipId) return;
      const cur = byDir.get(s.directorshipId) ?? { id: s.directorshipId, name: s.directorship || '—', all: [] };
      cur.all.push(s);
      byDir.set(s.directorshipId, cur);
    });
    return Array.from(byDir.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [scores]);

  const managerRankings = useMemo(() => {
    const grouped = new Map<string, BrokerScore[]>();
    scores.forEach((s) => {
      const key = s.managerName || 'Sem gerente';
      grouped.set(key, [...(grouped.get(key) ?? []), s]);
    });
    return Array.from(grouped, ([manager, list]) => ({ manager, scores: list }));
  }, [scores]);

  /**
   * Ponto único de fechamento (achado crítico G01).
   *
   * O botão chamava `close_game_season(p_close_month => true)`, que gravava o
   * mês corrente em `closed_months` SEM migrar as propostas abertas — só
   * `close_month_and_season` faz isso. O trigger `deals_guard_closed_month`
   * passava então a recusar qualquer insert/update de não-admin em negócio
   * daquele mês-base pelo resto do mês. Agora é a mesma RPC do Pipeline, e o
   * mês travado é o do início da temporada, não o do relógio de quem clicou.
   */
  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Nenhuma temporada aberta.');
      const changed = rules.filter((rule) => {
        const next = pendingScoring[rule.event_code];
        return Number.isFinite(next) && next !== rule.points;
      });
      // Os pesos novos são gravados ANTES do fechamento para valerem já na
      // temporada que abre na mesma transação.
      for (const rule of changed) {
        await setDefaultScoringPoints(rule.event_code, rule.label, pendingScoring[rule.event_code]);
      }
      return closeMonthAndSeason(monthStart(selected.period_start));
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: gameKeys.all });
      await queryClient.invalidateQueries({ queryKey: ['closed_months'] });
      setSelectedSeasonId(null);
      setCloseConfirmOpen(false);
      toast({
        title: 'Temporada encerrada',
        description: `Ranking congelado, mês ${monthLabel(String(result.period).slice(0, 10))} travado e ${num(result.moved_deals)} proposta(s) movida(s) para o mês seguinte.`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Não foi possível encerrar a temporada',
        description: describeError(error, 'Não foi possível encerrar a temporada.'),
        variant: 'destructive',
      });
    },
  });

  const openMutation = useMutation({
    mutationFn: () => openGameSeason(nextSeasonLabel()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: gameKeys.all });
      setSelectedSeasonId(null);
      toast({ title: 'Temporada aberta', description: 'O jogo voltou a pontuar.' });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Não foi possível abrir a temporada',
        description: describeError(error, 'Não foi possível abrir a temporada.'),
        variant: 'destructive',
      });
    },
  });

  const jogoParado = !seasonPending && !currentSeasonId;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Ranking do game"
        eyebrow="Gamificação"
        icon={Trophy}
        description={selected
          ? <>Temporada <strong className="text-foreground">{selected.label}</strong> · {seasonPeriod(selected)}</>
          : 'Nenhuma temporada cadastrada ainda.'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {seasons.length > 0 && (
              <Select value={selected?.id ?? ''} onValueChange={setSelectedSeasonId}>
                <SelectTrigger className="w-[300px]" aria-label="Temporada exibida">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {seasons.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label} · {seasonPeriod(s)}{s.closed_at ? ' (fechada)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isClosed && <StatusBadge tone="neutral" icon={Lock}>Temporada fechada</StatusBadge>}
            {isCurrent && !isClosed && <StatusBadge tone="success">Game ativo</StatusBadge>}
            {isAdmin && isCurrent && !isClosed && (
              <Button
                variant="destructive"
                onClick={() => {
                  setPendingScoring(Object.fromEntries(rules.map((r) => [r.event_code, r.points])));
                  setCloseConfirmOpen(true);
                }}
              >
                <Target className="h-4 w-4" /> Fechar gameficação
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {jogoParado && (
          <SectionCard
            title="Jogo parado — abra uma temporada"
            icon={PauseCircle}
            description="Sem temporada aberta o banco não pontua: award_game_points devolve nulo e nenhuma venda, esteira ou aprovação entra no placar."
            actions={isAdmin
              ? (
                <Button onClick={() => openMutation.mutate()} disabled={openMutation.isPending}>
                  <Play className="h-4 w-4" /> {openMutation.isPending ? 'Abrindo…' : 'Abrir temporada'}
                </Button>
              )
              : <StatusBadge tone="warning">Peça ao administrador</StatusBadge>}
          >
            <p className="text-sm text-muted-foreground">
              Os eventos que acontecerem enquanto o jogo estiver parado não são recuperados depois.
            </p>
          </SectionCard>
        )}

        <SectionCard title="Pontuação por movimento" icon={Star} description="Pesos vigentes em game_scoring_rules.">
          <div className="flex flex-wrap gap-2">
            {rules.map((rule) => (
              <Badge key={rule.event_code} variant="secondary" className="gap-1">
                {EVENT_LABELS[rule.event_code] ?? rule.label}:{' '}
                <span className={rule.points < 0 ? 'font-bold text-destructive' : 'font-bold text-primary'}>
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
        </SectionCard>

        <GamificationBanners />

        {loading ? (
          <LoadingState variant="table" rows={6} label="Carregando o ranking…" />
        ) : loadError ? (
          <EmptyState
            icon={AlertTriangle}
            tone="danger"
            title="Não consegui carregar a gamificação"
            description={describeError(loadError, 'Não foi possível carregar a gamificação.')}
            action={<Button variant="outline" onClick={() => void queryClient.invalidateQueries({ queryKey: gameKeys.all })}>Tentar de novo</Button>}
          />
        ) : (
          <Tabs defaultValue="geral" className="space-y-4">
            <TabsList className={`grid ${isAdmin ? 'grid-cols-4' : 'grid-cols-3'} mx-auto w-full max-w-lg`}>
              <TabsTrigger value="geral">Geral</TabsTrigger>
              <TabsTrigger value="diretoria">Diretorias</TabsTrigger>
              <TabsTrigger value="gerencia">Gerências</TabsTrigger>
              {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
            </TabsList>

            {/* ========== GERAL ========== */}
            <TabsContent value="geral" className="space-y-6">
              {scores.length === 0 ? (
                <EmptyState
                  icon={Trophy}
                  title="Ninguém pontuou nesta temporada"
                  description="Assim que uma esteira, aprovação ou venda for registrada, o placar aparece aqui."
                />
              ) : (
                <>
                  <SectionCard title="Campeões gerais" icon={Trophy} description={selected ? seasonPeriod(selected) : undefined}>
                    <Podium entries={podium} />
                  </SectionCard>

                  <SectionCard title="Ranking completo" icon={TrendingUp} flush>
                    <RankingTable scores={scores} secondColumn="team" />
                  </SectionCard>
                </>
              )}
            </TabsContent>

            {/* ========== DIRETORIAS ========== */}
            <TabsContent value="diretoria" className="space-y-4">
              {directorshipRankings.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Nenhuma diretoria configurada"
                  description="Defina o diretor de cada equipe em Equipes para o placar sair por diretoria."
                />
              ) : (
                directorshipRankings.map((dir) => (
                  <SectionCard key={dir.id} title={`Diretoria ${dir.name}`} icon={Crown} flush>
                    <RankingTable scores={dir.all} secondColumn="manager" />
                  </SectionCard>
                ))
              )}
            </TabsContent>

            {/* ========== GERÊNCIAS ========== */}
            <TabsContent value="gerencia" className="space-y-4">
              {managerRankings.length === 0 ? (
                <EmptyState icon={Users} title="Nenhuma gerência com pontuação nesta temporada" />
              ) : (
                managerRankings.map((mr) => (
                  <SectionCard key={mr.manager} title={mr.manager} icon={Users} flush>
                    <RankingTable scores={mr.scores} secondColumn="team" />
                  </SectionCard>
                ))
              )}
            </TabsContent>

            {isAdmin && (
              <TabsContent value="admin" className="space-y-4">
                <GamificationAdmin />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>

      {/* ── FECHAMENTO: um único ponto, o mesmo do Pipeline ─────────────── */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-destructive" /> Fechar a gameficação
            </AlertDialogTitle>
            <AlertDialogDescription>
              Encerra a temporada <strong className="text-foreground">{selected?.label}</strong>, congela o ranking,
              trava o mês-base <strong className="text-foreground">{selected ? monthLabel(monthStart(selected.period_start)) : '—'}</strong>{' '}
              e move as propostas abertas para o mês seguinte. Uma nova temporada abre na mesma transação.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-eyebrow mb-2">Pontuação da próxima temporada</p>
              <div className="grid grid-cols-2 gap-3">
                {rules.map((rule) => (
                  <div key={rule.event_code} className="space-y-1">
                    <Label className="text-xs" htmlFor={`peso-${rule.event_code}`}>
                      {EVENT_LABELS[rule.event_code] ?? rule.label}
                    </Label>
                    <Input
                      id={`peso-${rule.event_code}`}
                      type="number"
                      value={pendingScoring[rule.event_code] ?? rule.points}
                      onChange={(e) => setPendingScoring((p) => ({ ...p, [rule.event_code]: Number(e.target.value) }))}
                      className="h-9"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Não dá para desfazer. As novas pontuações valem a partir da temporada que abrir agora.
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); closeMutation.mutate(); }}
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending ? 'Encerrando…' : 'Encerrar e travar o mês'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
