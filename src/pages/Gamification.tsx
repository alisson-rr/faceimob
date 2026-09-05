import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Crown, Lock, Medal, PauseCircle, Play, Plus, Sliders, Star, Target, Trophy, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { GamificationAdmin, GamificationBanners } from '@/components/GamificationAdmin';
import { EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from '@/components/shared';
import { Podium, SoundPreview, buildFrozenScores, buildScores, type BrokerScore, type PodiumEntry } from '@/components/engagement';
import { useCurrentSeasonId, useSeasonRanking } from '@/hooks/useGameRanking';
import { useClosedMonths } from '@/components/pipeline/data';
import { brl, date, num } from '@/lib/format';
import { describeError } from '@/lib/supabaseError';
import {
  closeGameSeason,
  closeMonthAndSeason,
  describeGameError,
  gameKeys,
  isMonthClosed,
  listEffectiveScoringRules,
  listScoringRules,
  listSeasonResults,
  listSeasons,
  monthStart,
  openGameSeason,
  setDefaultScoringPoints,
  setScoringRuleActive,
  setSeasonScoringPoints,
  type GameSeason,
  type ScoringRule,
} from '@/integrations/supabase/game';

/**
 * O rótulo do evento sai da COLUNA `label` da própria regra.
 *
 * Havia um dicionário aqui (`EVENT_LABELS`) que escrevia "Incompleto (c/ doc)"
 * onde o banco diz "Incompleto com documento": duas fontes para o mesmo nome, e
 * o E2E teve que usar a do banco para achar o campo. Regra criada pela tela de
 * administração não teria tradução nenhuma.
 */

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

/**
 * `usarRankGravado` só na tabela geral de temporada FECHADA.
 *
 * O congelado guarda a colocação da casa inteira e o recorte de visibilidade
 * pode tirar linhas do meio: numerar pelo índice do array punha a coroa de 1º
 * em quem o fechamento registrou em 7º. Os agrupamentos por diretoria e
 * gerência continuam com a posição da própria lista — ali a colocação é local,
 * e o rank global deixaria o cartão inteiro sem medalha.
 */
function RankingTable({ scores, secondColumn, usarRankGravado }: {
  scores: BrokerScore[];
  secondColumn: 'team' | 'manager';
  usarRankGravado?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
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
          {scores.map((s, i) => {
            const posicao = (usarRankGravado && s.rank ? s.rank : i + 1) - 1;
            return (
            <TableRow key={s.brokerId} className={posicao < 3 ? 'bg-highlight/5' : undefined}>
              <TableCell><MedalIcon position={posicao} /><span className="sr-only">{posicao + 1}º</span></TableCell>
              <TableCell className={s.unknownPerson ? 'italic text-muted-foreground' : 'font-medium'}>
                {s.brokerName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {secondColumn === 'team' ? s.team : s.managerName || '—'}
              </TableCell>
              <TableCell className="text-center tabular-nums">{num(s.vendas)}</TableCell>
              <TableCell className="text-right tabular-nums">{brl(s.vgv)}</TableCell>
              <TableCell className="text-right font-bold tabular-nums text-primary">{num(s.points)}</TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Administração das regras de pontuação.
 *
 * Antes o ÚNICO caminho para mexer num peso era o diálogo "Fechar gameficação":
 * para corrigir "Venda: 600 → 700" no meio da temporada o admin era obrigado a
 * encerrar o jogo. Aqui ele edita, cria, desativa e — o que a tabela sempre
 * suportou e a tela nunca alcançou — grava a regra presa a UMA temporada.
 *
 * O aviso na tela diz a verdade sobre quando o peso passa a valer: `scoring_points`
 * lê a regra no momento de cada evento, então o peso novo vale do próximo
 * movimento em diante. O que já foi pontuado guarda o peso da hora em que
 * aconteceu e não é reescrito.
 */
function ScoringRulesPanel({ seasonId, seasons }: { seasonId: string | null; seasons: GameSeason[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState({ code: '', label: '', points: '' });

  const rulesQuery = useQuery({ queryKey: gameKeys.rulesAll, queryFn: listScoringRules, staleTime: 30_000 });
  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);

  const seasonLabel = seasons.find((s) => s.id === seasonId)?.label ?? null;
  /**
   * `listScoringRules()` traz TODAS as regras, inclusive as presas a temporadas
   * já encerradas — o selo dizia "Só nesta temporada" para todas elas. O admin
   * lia isso numa regra que não afeta o jogo em andamento e, ao editá-la,
   * gravava na temporada ANTIGA achando que tinha mudado o peso vigente.
   */
  const nomeDaTemporada = (id: string) =>
    seasons.find((s) => s.id === id)?.label ?? 'temporada removida';

  const refresh = () => queryClient.invalidateQueries({ queryKey: gameKeys.all });

  const fail = (error: unknown, title: string) =>
    toast({ title, description: describeGameError(error, title), variant: 'destructive' });

  const saveMutation = useMutation({
    mutationFn: async (input: { rule: ScoringRule; points: number }) =>
      input.rule.season_id
        ? setSeasonScoringPoints(input.rule.season_id, input.rule.event_code, input.rule.label, input.points)
        : setDefaultScoringPoints(input.rule.event_code, input.rule.label, input.points),
    onSuccess: async (_data, input) => {
      await refresh();
      setDrafts((p) => { const next = { ...p }; delete next[input.rule.id]; return next; });
      toast({ title: `${input.rule.label}: ${input.points} pts`, description: 'Vale do próximo movimento em diante.' });
    },
    onError: (error) => fail(error, 'Não foi possível salvar a regra'),
  });

  const activeMutation = useMutation({
    mutationFn: (input: { rule: ScoringRule; active: boolean }) => setScoringRuleActive(input.rule.id, input.active),
    onSuccess: async (_data, input) => {
      await refresh();
      toast({ title: input.active ? `${input.rule.label} ativada` : `${input.rule.label} desativada` });
    },
    onError: (error) => fail(error, 'Não foi possível mudar a regra'),
  });

  const pinMutation = useMutation({
    mutationFn: (rule: ScoringRule) => {
      if (!seasonId) throw new Error('Nenhuma temporada aberta para fixar a regra.');
      return setSeasonScoringPoints(seasonId, rule.event_code, rule.label, rule.points);
    },
    onSuccess: async (_data, rule) => {
      await refresh();
      toast({
        title: `${rule.label} fixada em ${rule.points} pts nesta temporada`,
        description: 'Agora dá para mudar o peso padrão sem mexer no placar em andamento.',
      });
    },
    onError: (error) => fail(error, 'Não foi possível fixar a regra na temporada'),
  });

  /**
   * `setDefaultScoringPoints` faz UPDATE-primeiro filtrando por `event_code`:
   * digitar um código que já existe REESCREVIA a regra existente (label e
   * pontos) e a tela toastava "Regra criada". A tabela já está carregada aqui —
   * a colisão é detectável antes do clique, e o botão sai do ar com o motivo ao
   * lado do campo.
   */
  const codigoNovo = novo.code.trim();
  const codigoJaExiste = codigoNovo !== '' && rules.some((r) => r.season_id === null && r.event_code === codigoNovo);

  const createMutation = useMutation({
    mutationFn: () => {
      const code = novo.code.trim();
      const label = novo.label.trim();
      if (!/^[a-z0-9_]+$/.test(code)) {
        throw new Error('O código do evento aceita só letras minúsculas, números e "_" — é ele que o banco grava em game_events.event_code.');
      }
      if (rules.some((r) => r.season_id === null && r.event_code === code)) {
        throw new Error(`Já existe uma regra padrão para "${code}" — edite a linha dela na tabela acima.`);
      }
      if (!label) throw new Error('Dê um nome à regra: é o que aparece na tela do corretor.');
      // Campo em branco: `Number('')` é 0 e passa por `Number.isInteger`, então
      // "Criar" sem digitar pontuação nascia com regra de 0 ponto.
      if (novo.points.trim() === '') throw new Error('Informe a pontuação da regra.');
      const points = Number(novo.points);
      if (!Number.isInteger(points)) throw new Error('A pontuação precisa ser um número inteiro.');
      return setDefaultScoringPoints(code, label, points);
    },
    onSuccess: async () => {
      await refresh();
      setNovo({ code: '', label: '', points: '' });
      toast({
        title: 'Regra criada',
        description: 'Ela só pontua quando algo no banco emitir esse código de evento.',
      });
    },
    onError: (error) => fail(error, 'Não foi possível criar a regra'),
  });

  const rowValue = (rule: ScoringRule) => drafts[rule.id] ?? String(rule.points);

  return (
    <SectionCard
      title="Regras de pontuação"
      icon={Sliders}
      description="Pesos de game_scoring_rules. O peso novo vale do próximo movimento; o que já pontuou não muda."
    >
      {rulesQuery.isPending ? (
        <LoadingState variant="list" rows={4} label="Carregando as regras…" />
      ) : rulesQuery.error ? (
        <EmptyState
          icon={AlertTriangle}
          tone="danger"
          title="Não consegui carregar as regras"
          description={describeError(rulesQuery.error, 'Não foi possível carregar as regras de pontuação.')}
          action={<Button variant="outline" onClick={() => void refresh()}>Tentar de novo</Button>}
        />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Regra</TableHead>
                  <TableHead>Escopo</TableHead>
                  <TableHead className="w-32">Pontos</TableHead>
                  <TableHead className="w-24 text-center">Ativa</TableHead>
                  <TableHead className="w-40 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => {
                  const changed = rowValue(rule) !== String(rule.points);
                  const parsed = Number(rowValue(rule));
                  // Campo apagado: `Number('')` é 0 e `Number.isInteger(0)` é
                  // true, então "Salvar" gravava 0 pt com toast de sucesso e a
                  // venda parava de pontuar sem ninguém ser avisado. É a mesma
                  // guarda que o diálogo de fechamento já fazia.
                  const invalid = changed && (rowValue(rule).trim() === '' || !Number.isInteger(parsed));
                  return (
                    <TableRow key={rule.id} className={rule.active ? undefined : 'opacity-60'}>
                      <TableCell>
                        <span className="font-medium">{rule.label}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{rule.event_code}</span>
                      </TableCell>
                      <TableCell>
                        {!rule.season_id
                          ? <StatusBadge tone="neutral">Padrão</StatusBadge>
                          : rule.season_id === seasonId
                            ? <StatusBadge tone="warning">Só em {nomeDaTemporada(rule.season_id)}</StatusBadge>
                            : <StatusBadge tone="neutral">De {nomeDaTemporada(rule.season_id)} (encerrada)</StatusBadge>}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step={1}
                          className="h-9 w-28"
                          aria-label={`Pontos de ${rule.label}`}
                          aria-invalid={invalid || undefined}
                          value={rowValue(rule)}
                          onChange={(e) => setDrafts((p) => ({ ...p, [rule.id]: e.target.value }))}
                        />
                        {invalid && (
                          <span className="text-xs text-destructive">Informe um número inteiro.</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={rule.active}
                          aria-label={`${rule.active ? 'Desativar' : 'Ativar'} ${rule.label}`}
                          disabled={activeMutation.isPending}
                          onCheckedChange={(active) => activeMutation.mutate({ rule, active })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {/* Regra DESLIGADA não se fixa: `writeScoringRule`
                              não acha regra da temporada, cai no INSERT e ele
                              grava `active: true` — a regra que o admin
                              desativou de propósito voltaria a pontuar, em
                              silêncio, com o toast dizendo só "fixada em N
                              pts". A guarda contra religar existia no UPDATE,
                              e "Fixar" é o único caminho que só passa pelo
                              INSERT. Para fixar, ligue a regra antes. */}
                          {!rule.season_id && seasonId && rule.active && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={pinMutation.isPending}
                              title={`Congela ${rule.points} pts em ${seasonLabel ?? 'nesta temporada'}`}
                              onClick={() => pinMutation.mutate(rule)}
                            >
                              Fixar na temporada
                            </Button>
                          )}
                          <Button
                            size="sm"
                            disabled={!changed || invalid || saveMutation.isPending}
                            onClick={() => saveMutation.mutate({ rule, points: parsed })}
                          >
                            Salvar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {rules.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma regra cadastrada. Sem regra ativa, <code>award_game_points</code> descarta o evento.
            </p>
          )}

          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <p className="text-eyebrow mb-3">Nova regra</p>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto] sm:items-end">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="nova-regra-codigo">Código do evento</Label>
                <Input
                  id="nova-regra-codigo"
                  className="h-9 font-mono"
                  placeholder="visita_realizada"
                  aria-invalid={codigoJaExiste || undefined}
                  aria-describedby={codigoJaExiste ? 'nova-regra-codigo-erro' : undefined}
                  value={novo.code}
                  onChange={(e) => setNovo((p) => ({ ...p, code: e.target.value }))}
                />
                {codigoJaExiste && (
                  <span id="nova-regra-codigo-erro" className="block text-xs text-destructive">
                    Já existe uma regra padrão com esse código — edite a linha dela na tabela acima.
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="nova-regra-rotulo">Nome na tela</Label>
                <Input
                  id="nova-regra-rotulo"
                  className="h-9"
                  placeholder="Visita realizada"
                  value={novo.label}
                  onChange={(e) => setNovo((p) => ({ ...p, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="nova-regra-pontos">Pontos</Label>
                <Input
                  id="nova-regra-pontos"
                  className="h-9"
                  type="number"
                  step={1}
                  placeholder="50"
                  value={novo.points}
                  onChange={(e) => setNovo((p) => ({ ...p, points: e.target.value }))}
                />
              </div>
              <Button
                className="h-9"
                disabled={createMutation.isPending || codigoJaExiste}
                onClick={() => createMutation.mutate()}
              >
                <Plus className="h-4 w-4" /> Criar
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              A regra por si só não pontua: alguém no banco precisa chamar{' '}
              <code>award_game_points</code> com esse código. Os que já disparam sozinhos são{' '}
              <code>venda</code>, <code>distrato</code>, <code>esteira</code>, <code>aprovado</code> e{' '}
              <code>incompleto_com_doc</code>.
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export default function Gamification() {
  // `isAdmin` do contexto acompanha a pré-visualização de papel; `role` é
  // sempre o papel REAL e deixava a aba Admin e o botão de fechar na prévia.
  const { isAdmin, roles, previewRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingScoring, setPendingScoring] = useState<Record<string, string>>({});

  // O corretor vê o placar da EQUIPE dele (decisão de 10/08, RPC
  // `visible_game_ranking`); admin, diretor e sócio veem a casa. A tela dizia
  // "Campeões gerais" para os dois — quem lê "geral" e vê cinco nomes não tem
  // como saber que o recorte é da equipe.
  const effectiveRoles = previewRole ? [previewRole] : roles;
  const veTudo = isAdmin || effectiveRoles.some((r) => r === 'director' || r === 'partner');

  const { data: currentSeasonId, isPending: seasonPending } = useCurrentSeasonId();

  const seasonsQuery = useQuery({ queryKey: gameKeys.seasons, queryFn: listSeasons, staleTime: 60_000 });
  const seasons = useMemo(() => seasonsQuery.data ?? [], [seasonsQuery.data]);

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

  // Mês-base do ciclo, como o Pipeline escreve ("08/2026"). Com ciclo livre,
  // duas temporadas cabem no mesmo mês: a segunda encontra o mês já travado, e
  // o diálogo precisa dizer isso antes do clique.
  const closedMonths = useClosedMonths();
  const seasonMonth = selected ? monthLabel(monthStart(selected.period_start)) : null;
  const monthAlreadyClosed = Boolean(seasonMonth && (closedMonths.data ?? []).includes(seasonMonth));

  /**
   * Ranking da temporada EXIBIDA, não da corrente.
   *
   * Era `useSeasonRanking(currentSeasonId)`: com o jogo parado a consulta ficava
   * desabilitada, o mapa de identidades nascia vazio e a tela dizia "Ninguém
   * pontuou nesta temporada" para uma temporada fechada com 13 colocados no
   * banco. `visible_game_ranking` aceita qualquer temporada e já devolve todo
   * corretor visível, com ou sem ponto — é a identidade de que o congelado
   * precisa, no mesmo recorte de RLS.
   */
  const rankingQuery = useSeasonRanking(selected?.id ?? null);
  const seasonRanking = useMemo(() => rankingQuery.data ?? [], [rankingQuery.data]);

  const resultsQuery = useQuery({
    queryKey: gameKeys.results(selected?.id ?? null),
    queryFn: () => listSeasonResults(selected?.id as string),
    enabled: Boolean(selected && isClosed),
    staleTime: 60_000,
  });

  const peopleById = useMemo(
    () => new Map(seasonRanking.map((row) => [row.profile_id, row])),
    [seasonRanking],
  );

  /**
   * `keepUnknown` acompanha o `can_read_all()` do banco (admin, diretor,
   * sócio). Para eles o congelado fica inteiro, com a linha anônima de quem
   * saiu da casa; para corretor e gerente a linha que o escopo de hoje não
   * identifica sai — é o mesmo recorte da policy `game_season_results_select`
   * (0060), e enquanto ela não estiver aplicada o SELECT ainda é `using (true)`:
   * sem este filtro, abrir uma temporada fechada no seletor entregaria a um
   * corretor os pontos e o VGV congelados da casa inteira.
   */
  const scores = useMemo(
    () => (isClosed
      ? buildFrozenScores(resultsQuery.data ?? [], peopleById, { keepUnknown: veTudo })
      : buildScores(seasonRanking)),
    [isClosed, resultsQuery.data, peopleById, seasonRanking, veTudo],
  );

  /**
   * Vazio por FILTRO, não por falta de fechamento.
   *
   * `buildFrozenScores(..., { keepUnknown: false })` descarta a linha que o
   * escopo de hoje não identifica: uma temporada com 13 colocados de outras
   * equipes chega vazia à tela do corretor, e o texto "o fechamento não
   * congelou nenhuma linha" seria uma afirmação sobre o banco que esta tela não
   * tem como fazer. O que ela sabe é quantas linhas o SELECT devolveu.
   */
  const congeladoForaDoEscopo = isClosed && scores.length === 0 && (resultsQuery.data ?? []).length > 0;

  const loading = seasonPending || seasonsQuery.isPending
    || (Boolean(selected) && rankingQuery.isPending)
    || (isClosed && resultsQuery.isPending);
  const loadError = seasonsQuery.error ?? rankingQuery.error ?? resultsQuery.error;

  /**
   * O degrau escreve a colocação CONGELADA, não a posição na lista.
   *
   * `scores.slice(0, 3)` é "os três primeiros que eu vejo". Numa temporada
   * fechada, corretor e gerente recebem o congelado filtrado pelo escopo
   * (`keepUnknown: false`), então o primeiro visível pode ser o 5º colocado da
   * casa — e a tabela logo abaixo já mostrava "#5" para a MESMA pessoa que o
   * cartão coroava como 1º. É a mesma correção que entrou na tabela e ficou
   * faltando no pódio.
   */
  const podium: PodiumEntry[] = scores.slice(0, 3).map((s) => ({
    id: s.brokerId,
    name: s.brokerName,
    points: s.points,
    avatarUrl: s.avatarUrl,
    detail: s.team,
    place: isClosed ? s.rank : undefined,
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
   *
   * Exceção: a temporada que nasce dentro de um mês JÁ travado (segundo
   * fechamento no mesmo mês de calendário — ciclo livre, decisão de 21/08).
   * `close_month_and_season` recusa com "já está fechado" e a temporada ficaria
   * aberta para sempre pela tela; aí só a temporada encerra, via
   * `close_game_season`, que congela o ranking e abre a próxima sem tocar em
   * `closed_months` nem mover proposta.
   */
  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Nenhuma temporada aberta.');
      // Campo apagado virava `NaN` e o filtro `Number.isFinite` o descartava em
      // silêncio: o operador saía convencido de ter mudado um peso que ficou
      // como estava. Agora o diálogo recusa antes de fechar nada.
      const changed: { rule: (typeof rules)[number]; points: number }[] = [];
      for (const rule of rules) {
        const raw = pendingScoring[rule.event_code];
        if (raw === undefined || raw === String(rule.points)) continue;
        const points = Number(raw);
        if (raw.trim() === '' || !Number.isInteger(points)) {
          throw new Error(`A pontuação de "${rule.label}" precisa ser um número inteiro.`);
        }
        changed.push({ rule, points });
      }
      // Os pesos novos são gravados ANTES do fechamento para valerem já na
      // temporada que abre na mesma transação. Se o `close` falhar depois, eles
      // ficam gravados — está escrito no aviso do diálogo.
      for (const { rule, points } of changed) {
        await setDefaultScoringPoints(rule.event_code, rule.label, points);
      }
      const period = monthStart(selected.period_start);
      // Leitura fresca, não o cache: o Pipeline pode ter fechado o mês em outra aba.
      if (await isMonthClosed(period)) {
        const nextSeasonId = await closeGameSeason();
        return { period, moved_deals: 0, next_season_id: nextSeasonId, monthWasClosed: true };
      }
      return { ...(await closeMonthAndSeason(period)), monthWasClosed: false };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: gameKeys.all });
      await queryClient.invalidateQueries({ queryKey: ['closed_months'] });
      setSelectedSeasonId(null);
      setCloseConfirmOpen(false);
      const month = monthLabel(String(result.period).slice(0, 10));
      toast({
        title: 'Temporada encerrada',
        description: result.monthWasClosed
          ? `Ranking congelado e nova temporada aberta. O mês ${month} já estava travado.`
          : `Ranking congelado, mês ${month} travado e ${num(result.moved_deals)} proposta(s) movida(s) para o mês seguinte.`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: 'Não foi possível encerrar a temporada',
        description: describeGameError(error, 'Não foi possível encerrar a temporada.'),
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
      // `game_seasons_one_open` é índice único: dois admins abrindo ao mesmo
      // tempo levariam o 23505 cru do Postgres ("duplicate key value violates
      // unique constraint"), que não diz nada a quem clicou.
      const code = (error as { db?: { code?: string } } | null)?.db?.code;
      toast({
        title: 'Não foi possível abrir a temporada',
        description: code === '23505'
          ? 'Alguém acabou de abrir uma temporada. Recarregue a tela para ver o jogo já rodando.'
          : describeGameError(error, 'Não foi possível abrir a temporada.'),
        variant: 'destructive',
      });
      void queryClient.invalidateQueries({ queryKey: gameKeys.all });
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
                <SelectTrigger className="w-full sm:w-[300px]" aria-label="Temporada exibida">
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
                  setPendingScoring(Object.fromEntries(rules.map((r) => [r.event_code, String(r.points)])));
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

        {/* Cartão com estado próprio: ficava ACIMA da guarda de carregamento e
            afirmava "Nenhuma regra de pontuação ativa" enquanto a consulta
            corria — e também quando ela falhava. */}
        <SectionCard title="Pontuação por movimento" icon={Star} description="Pesos vigentes em game_scoring_rules.">
          {rulesQuery.isPending ? (
            <div className="flex flex-wrap gap-2" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6 w-32 rounded-full" />)}
            </div>
          ) : rulesQuery.error ? (
            <p className="text-sm text-destructive">
              {describeError(rulesQuery.error, 'Não foi possível carregar as regras de pontuação.')}
            </p>
          ) : rules.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Nenhuma regra de pontuação ativa em <code>game_scoring_rules</code>.
            </span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {rules.map((rule) => (
                <Badge key={rule.event_code} variant="secondary" className="gap-1">
                  {rule.label}:{' '}
                  <span className={rule.points < 0 ? 'font-bold text-destructive' : 'font-bold text-primary'}>
                    {rule.points} pts
                  </span>
                </Badge>
              ))}
            </div>
          )}
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
                  icon={isClosed ? Lock : Trophy}
                  title={congeladoForaDoEscopo
                    ? 'Ninguém do seu escopo pontuou nesta temporada'
                    : isClosed ? 'Esta temporada fechou sem ninguém no placar' : 'Ninguém pontuou nesta temporada'}
                  description={congeladoForaDoEscopo
                    ? 'O fechamento congelou linhas, mas todas são de corretores que você não enxerga. O ranking da casa inteira é da diretoria.'
                    : isClosed
                      ? 'O fechamento não congelou nenhuma linha: não houve venda, esteira nem aprovação enquanto ela esteve aberta.'
                      : 'Assim que uma esteira, aprovação ou venda for registrada, o placar aparece aqui.'}
                />
              ) : (
                <>
                  <SectionCard
                    title={veTudo ? 'Campeões gerais' : 'Campeões da sua equipe'}
                    icon={Trophy}
                    description={selected ? seasonPeriod(selected) : undefined}
                  >
                    <Podium entries={podium} />
                    {!veTudo && (
                      <p className="mt-4 text-center text-xs text-muted-foreground">
                        Você vê os corretores das suas equipes. O ranking da casa inteira é da diretoria.
                      </p>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Ranking completo"
                    icon={TrendingUp}
                    description={isClosed && !veTudo
                      ? 'Colocação congelada no fechamento. Você vê as linhas dos corretores que enxerga hoje, então a numeração pode pular.'
                      : undefined}
                    flush
                  >
                    <RankingTable scores={scores} secondColumn="team" usarRankGravado={isClosed} />
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
                <ScoringRulesPanel seasonId={currentSeasonId ?? null} seasons={seasons} />
                <SoundPreview />
                <GamificationAdmin />
              </TabsContent>
            )}
          </Tabs>
        )}
      </div>

      {/* ── FECHAMENTO: um único ponto, o mesmo do Pipeline ─────────────── */}
      <AlertDialog open={closeConfirmOpen} onOpenChange={setCloseConfirmOpen}>
        <AlertDialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-destructive" /> Fechar a gameficação
            </AlertDialogTitle>
            <AlertDialogDescription>
              {monthAlreadyClosed ? (
                <>
                  Encerra a temporada <strong className="text-foreground">{selected?.label}</strong>, congela o ranking
                  e abre a próxima. O mês-base <strong className="text-foreground">{seasonMonth}</strong> já está travado
                  por um fechamento anterior: nenhuma proposta é movida.
                </>
              ) : (
                <>
                  Encerra a temporada <strong className="text-foreground">{selected?.label}</strong>, congela o ranking,
                  trava o mês-base <strong className="text-foreground">{seasonMonth ?? '—'}</strong>{' '}
                  e move as propostas abertas para o mês seguinte. Uma nova temporada abre na mesma transação.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-eyebrow mb-2">Pontuação da próxima temporada</p>
              {/* Rola aqui dentro. `AlertDialogContent` é `fixed` e centralizado,
                  sem `max-h` nem `overflow`: com as regras que o painel novo
                  deixa criar, o diálogo passava da viewport e "Cancelar" /
                  "Encerrar e travar o mês" — ação irreversível — saíam da tela
                  sem rolagem possível. Mesmo remédio de Resultados.tsx. */}
              <div className="grid max-h-64 grid-cols-2 gap-3 overflow-y-auto pr-1">
                {rules.map((rule) => (
                  <div key={rule.event_code} className="space-y-1">
                    <Label className="text-xs" htmlFor={`peso-${rule.event_code}`}>{rule.label}</Label>
                    <Input
                      id={`peso-${rule.event_code}`}
                      type="number"
                      step={1}
                      value={pendingScoring[rule.event_code] ?? String(rule.points)}
                      onChange={(e) => setPendingScoring((p) => ({ ...p, [rule.event_code]: e.target.value }))}
                      className="h-9"
                    />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Para ajustar um peso sem encerrar o jogo, use <strong>Regras de pontuação</strong> na aba Admin.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Não dá para desfazer. As pontuações são gravadas antes do fechamento: se o encerramento
                falhar, elas continuam valendo e o jogo segue aberto.
              </p>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); closeMutation.mutate(); }}
              disabled={closeMutation.isPending}
            >
              {closeMutation.isPending
                ? 'Encerrando…'
                : monthAlreadyClosed ? 'Encerrar temporada' : 'Encerrar e travar o mês'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
