import { supabase } from "./client";
import { dbError, describeError } from "@/lib/supabaseError";

/**
 * Gamificação — temporadas, regras de pontuação e ranking.
 *
 * A tela calculava tudo no cliente a partir de `deals`, com pesos em `useState`:
 * dois usuários podiam ver rankings diferentes e nada era auditável. A fonte de
 * verdade é `game_events` (alimentada por `award_game_points` e pelos triggers
 * `deals_award_points` / `cca_award_points` / rateio / documentos), somada por
 * `visible_game_ranking`. Desde a 0142 o congelado de `close_game_season` sai
 * dessa MESMA função — vivo e congelado contam as mesmas pessoas (papel
 * `broker`) e os mesmos pontos. A view `game_ranking` não é mais lida por tela
 * nem pelo fechamento.
 *
 * Os códigos de evento são os do banco — `incompleto_com_doc`, `esteira`,
 * `aprovado`, `venda`, `distrato`. O front usava um vocabulário próprio
 * (`approved`, `distrato_penalty`) que não casava com `game_events.event_code`,
 * então nenhuma regra editada na tela poderia valer.
 */

/**
 * Descrição do erro para o toast da Gamificação, sem perder a recusa própria.
 *
 * `describeError` traduz pelo `code` do Postgres e devolve o `fallback` para
 * QUALQUER `Error` sem código — o que inclui as recusas escritas aqui e nas
 * validações da tela ("O banco não alterou nenhuma regra…", "A pontuação de
 * 'Venda' precisa ser um número inteiro"). O operador lia só o fallback
 * genérico e não tinha como saber o que corrigir. Erro que NÃO veio do banco
 * (sem `.db`) fala por si; o que veio continua traduzido, para o `message` cru
 * do Postgres não vazar nome de tabela e constraint na tela.
 *
 * Mora aqui, e não na página, porque é este módulo que cria essas exceções —
 * e é onde há teste sem montar a árvore de React.
 */
export function describeGameError(error: unknown, fallback: string): string {
  const doBanco = Boolean(error && typeof error === "object" && (error as { db?: unknown }).db);
  if (!doBanco && error instanceof Error && error.message.trim()) return error.message;
  return describeError(error, fallback);
}

export type ScoringRule = {
  id: string;
  season_id: string | null;
  event_code: string;
  label: string;
  points: number;
  active: boolean;
};

export type GameSeason = {
  id: string;
  label: string;
  period_start: string;
  period_end: string | null;
  closed_at: string | null;
};

export type RankingRow = {
  season_id: string;
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  active: boolean;
  points: number;
  sales: number;
  vgv: number;
  breakdown: Record<string, number> | null;
  team_id: string | null;
  team_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  director_id: string | null;
  director_name: string | null;
};

export type SeasonResultRow = {
  season_id: string;
  profile_id: string;
  rank: number;
  points: number;
  sales: number;
  vgv: number;
  breakdown: Record<string, number> | null;
};

/**
 * Regras vigentes. `scoring_points()` prefere a regra da temporada sobre a
 * padrão (`season_id is null`); a listagem aplica a mesma precedência para a
 * tela não mostrar um número diferente do que o banco vai usar.
 */
export async function listEffectiveScoringRules(seasonId: string | null): Promise<ScoringRule[]> {
  const { data, error } = await supabase
    .from("game_scoring_rules")
    .select("id,season_id,event_code,label,points,active")
    .eq("active", true);
  if (error) throw dbError("game_scoring_rules", error);

  const rows = (data ?? []) as ScoringRule[];
  const byCode = new Map<string, ScoringRule>();
  for (const r of rows) {
    if (r.season_id !== null && r.season_id !== seasonId) continue;
    const current = byCode.get(r.event_code);
    // Regra da temporada ganha da padrão.
    if (!current || (r.season_id !== null && current.season_id === null)) byCode.set(r.event_code, r);
  }
  return [...byCode.values()].sort((a, b) => a.event_code.localeCompare(b.event_code));
}

/**
 * Todas as regras, inclusive as desativadas e as de temporada.
 *
 * `listEffectiveScoringRules` filtra `active` e resolve a precedência — é o que
 * a tela do jogador precisa. A tela de administração precisa do contrário: ver
 * o que está desligado é a única forma de religar.
 */
export async function listScoringRules(): Promise<ScoringRule[]> {
  const { data, error } = await supabase
    .from("game_scoring_rules")
    .select("id,season_id,event_code,label,points,active")
    .order("event_code");
  if (error) throw dbError("game_scoring_rules", error);
  return (data ?? []) as ScoringRule[];
}

/**
 * Liga e desliga uma regra. `.select("id")` porque um UPDATE que a RLS filtra
 * devolve 204 sem erro: sem conferir a linha, a tela diria "salvo" com a regra
 * intacta no banco.
 */
export async function setScoringRuleActive(id: string, active: boolean): Promise<void> {
  const { data, error } = await supabase
    .from("game_scoring_rules")
    .update({ active })
    .eq("id", id)
    .select("id");
  if (error) throw dbError("salvar regra de pontuação", error);
  if (!data?.length) {
    throw new Error("O banco não alterou nenhuma regra — seu perfil não pode editar a pontuação.");
  }
}

/**
 * Grava o peso como regra padrão (`season_id null`), que é o que vale para as
 * próximas temporadas — mexer na temporada corrente reescreveria o passado.
 *
 * Não é `upsert`: a unicidade de `event_code` vem de um índice PARCIAL
 * (`game_scoring_rules_default_idx ... where season_id is null`), e o
 * `on conflict (event_code)` que o PostgREST monta não acha arbiter nele — o
 * Postgres recusa em tempo de plano (42P10), sempre, mesmo sem linha em
 * conflito. Update filtrado + insert quando não há linha é o mesmo desenho que
 * `Equipes.tsx` usa para `goals`.
 */
export async function setDefaultScoringPoints(eventCode: string, label: string, points: number): Promise<void> {
  return writeScoringRule(eventCode, label, points, null);
}

/**
 * Mesma gravação, mas presa a uma temporada (`season_id` preenchido).
 *
 * `scoring_points()` prefere a regra da temporada sobre a padrão, então é assim
 * que o admin muda um peso SEM mexer no placar em andamento: fixa o valor atual
 * nesta temporada e edita o padrão, que passa a valer da próxima em diante.
 */
export async function setSeasonScoringPoints(
  seasonId: string,
  eventCode: string,
  label: string,
  points: number,
): Promise<void> {
  return writeScoringRule(eventCode, label, points, seasonId);
}

async function writeScoringRule(
  eventCode: string,
  label: string,
  points: number,
  seasonId: string | null,
): Promise<void> {
  // O UPDATE não mexe em `active`: religar a regra é decisão separada, do
  // interruptor da tabela. Com `active: true` aqui, corrigir o peso de uma
  // regra que o admin desligou DE PROPÓSITO a religava em silêncio — o evento
  // voltava a pontuar sem ninguém ter pedido. No INSERT ele fica, porque é o
  // nascimento da regra.
  const filtered = supabase
    .from("game_scoring_rules")
    .update({ label, points })
    .eq("event_code", eventCode);
  const updated = await (seasonId === null
    ? filtered.is("season_id", null)
    : filtered.eq("season_id", seasonId)
  ).select("id");
  if (updated.error) throw dbError("salvar regra de pontuação", updated.error);
  if (updated.data?.length) return;

  const inserted = await supabase
    .from("game_scoring_rules")
    .insert({ season_id: seasonId, event_code: eventCode, label, points, active: true });
  if (inserted.error) throw dbError("salvar regra de pontuação", inserted.error);
}

/**
 * `true` quando o mês já está em `closed_months`. Qualquer autenticado lê
 * (policy `closed_months_select`). A Gamificação consulta antes de fechar: com
 * ciclo livre, a segunda temporada do mesmo mês de calendário encontra o mês
 * já travado, e `close_month_and_season` recusaria com "já está fechado".
 */
export async function isMonthClosed(period: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("closed_months")
    .select("period")
    .eq("period", period)
    .maybeSingle();
  if (error) throw dbError("closed_months", error);
  return data !== null;
}

export async function getCurrentSeasonId(): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_game_season");
  if (error) throw dbError("current_game_season", error);
  return (data as string | null) ?? null;
}

export async function listSeasons(): Promise<GameSeason[]> {
  const { data, error } = await supabase
    .from("game_seasons")
    .select("id,label,period_start,period_end,closed_at")
    .order("period_start", { ascending: false });
  if (error) throw dbError("game_seasons", error);
  return (data ?? []) as GameSeason[];
}

/** Intervalo de dias `AAAA-MM-DD`, inclusivo nas duas pontas. */
export type WeekRange = { from: string; to: string };

/**
 * Ranking da temporada, opcionalmente recortado por um intervalo de dias.
 *
 * Sem `week` a chamada usa a assinatura antiga (um argumento) e devolve a
 * temporada inteira — é o que `EngagementLayer` e `PipelineTopRanking` pedem.
 * Com `week`, é a MESMA pontuação somada só nos dias do intervalo: a semana é
 * leitura, não um ciclo próprio (CONTEXT.md). Quem converte o fuso é o banco.
 */
export async function listRanking(seasonId: string, week?: WeekRange | null): Promise<RankingRow[]> {
  // Variável, e não literal no `.rpc()`: as duas assinaturas da 0107 chegam ao
  // `types.ts` como união, e um literal cairia na checagem de propriedade
  // excedente do TypeScript ao ser comparado com o ramo de um argumento só.
  const args = week
    ? { p_season_id: seasonId, p_from: week.from, p_to: week.to }
    : { p_season_id: seasonId };
  const { data, error } = await supabase
    .rpc("visible_game_ranking", args)
    .order("points", { ascending: false });
  if (error) throw dbError("visible_game_ranking", error);
  return (data ?? []) as RankingRow[];
}

/**
 * Marca d'água da última venda, pelo relógio do SERVIDOR.
 *
 * O `EngagementLayer` a guarda a cada conexão bem-sucedida do canal de realtime
 * para conseguir dizer, na volta de uma queda, quantas vendas fecharam enquanto
 * ele não estava escutando. Comparar com o relógio do NAVEGADOR não serviria:
 * a TV da loja passa dias ligada e o desvio de alguns minutos entre as duas
 * máquinas contaria venda a mais ou a menos.
 *
 * `null` quando ainda não houve venda nenhuma — e aí "desde sempre" é a
 * resposta certa para `countSalesSince`.
 */
export async function lastSaleAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from("game_events")
    .select("occurred_at")
    .eq("event_code", "venda")
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (error) throw dbError("game_events", error);
  return data?.[0]?.occurred_at ?? null;
}

/**
 * Quantos NEGÓCIOS distintos fecharam depois de `since`.
 *
 * Conta `ref_id` distinto, não linhas: o trigger grava uma linha por corretor do
 * rateio, e uma venda a três mãos é uma comemoração perdida, não três. É a mesma
 * regra de `groupSaleEvents`, que agrupa a comemoração ao vivo.
 *
 * A venda é o único código legível por toda a casa (policy `game_events_select`,
 * 0060) — é por isso que esta contagem pode ser feita por qualquer autenticado.
 */
export async function countSalesSince(since: string | null): Promise<number> {
  const query = supabase.from("game_events").select("ref_id").eq("event_code", "venda");
  const { data, error } = await (since ? query.gt("occurred_at", since) : query);
  if (error) throw dbError("game_events", error);
  return new Set((data ?? []).map((row) => row.ref_id ?? "")).size;
}

/** Resultado congelado de uma temporada fechada. */
export async function listSeasonResults(seasonId: string): Promise<SeasonResultRow[]> {
  const { data, error } = await supabase
    .from("game_season_results")
    .select("season_id,profile_id,rank,points,sales,vgv,breakdown")
    .eq("season_id", seasonId)
    .order("rank");
  if (error) throw dbError("game_season_results", error);
  return (data ?? []) as SeasonResultRow[];
}

/**
 * Encerra a temporada aberta: congela o ranking em `game_season_results` e abre
 * a próxima, tudo na mesma transação. Só admin — a própria função recusa os
 * demais com 42501.
 *
 * O parâmetro `p_close_month` some de propósito (achado G01 da auditoria de
 * 21/08): com ele em `true`, a RPC gravava `month_start(current_date)` em
 * `closed_months` SEM migrar as propostas abertas — só `close_month_and_season`
 * faz isso — e o trigger `deals_guard_closed_month` passava a recusar qualquer
 * insert/update de não-admin em negócio daquele mês-base pelo resto do mês.
 * Quem precisa fechar mês usa `closeMonthAndSeason`, o ponto único. Este
 * caminho fica para a temporada cujo mês JÁ está travado (ver `isMonthClosed`).
 */
export async function closeGameSeason(nextLabel?: string): Promise<string> {
  const { data, error } = await supabase.rpc("close_game_season", {
    p_next_label: nextLabel ?? null,
    p_close_month: false,
  });
  if (error) throw dbError("fechar temporada", error);
  return data as string;
}

export type CloseMonthResult = {
  period: string;
  moved_deals: number;
  next_season_id: string | null;
};

/**
 * Ponto único de fechamento (ata 14/07: "fecha o game e fecha o mês" juntos).
 *
 * Numa transação só: migra as propostas abertas para o mês seguinte, grava o
 * mês em `closed_months` e encerra a temporada do jogo. É a mesma RPC que o
 * botão "Fechar Mês" do Pipeline chama. Só admin.
 */
export async function closeMonthAndSeason(period: string): Promise<CloseMonthResult> {
  const { data, error } = await supabase.rpc("close_month_and_season", { p_period: period });
  if (error) throw dbError("fechar mês e temporada", error);
  return data as unknown as CloseMonthResult;
}

/**
 * Abre uma temporada quando não há nenhuma.
 *
 * `close_game_season` abre a próxima ao fechar a atual, então este caminho só
 * existe para o estado "nenhuma temporada aberta": aí `award_game_points`
 * devolve null em silêncio e o jogo simplesmente não pontua (achado G06). Só
 * admin — a policy `game_seasons_write` recusa os demais com 42501.
 */
export async function openGameSeason(label: string): Promise<GameSeason> {
  const today = new Date();
  const periodStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from("game_seasons")
    .insert({ label, period_start: periodStart })
    .select("id,label,period_start,period_end,closed_at")
    .single();
  if (error) throw dbError("abrir temporada", error);
  return data as GameSeason;
}

/** Primeiro dia do mês de uma data `YYYY-MM-DD` — o `month_start()` do banco. */
export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/**
 * `AAAA-MM-DD` deslocada em dias, ancorada em UTC.
 *
 * A âncora `T00:00:00Z` com `get/setUTC*` deixa a conta independente do fuso do
 * NAVEGADOR — sem ela, a TV da loja num notebook em outro fuso mudaria de
 * semana antes ou depois da operação. A data que entra já é o dia de São Paulo
 * (vem de `current_work_date()` ou de `game_seasons.period_start`, ambos `date`
 * no banco) e o que sai é o mesmo tipo de dia: nenhum instante é convertido
 * aqui, a conversão de fuso acontece uma vez só dentro de `visible_game_ranking`.
 */
function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Segunda e domingo da semana de `isoDate`.
 *
 * Segunda a domingo é como a operação fala de "essa semana" — o mesmo recorte
 * de `leadCountWindows` (checkin.ts) e do checkpoint semanal. Domingo pertence
 * à semana que começou na segunda anterior; a virada é na segunda de manhã.
 */
export function weekRange(isoDate: string): WeekRange {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay(); // 0 = domingo
  const from = shiftDays(isoDate, -((weekday + 6) % 7));
  return { from, to: shiftDays(from, 6) };
}

/**
 * As semanas que tocam `[startIso, endIso]`, da mais antiga para a mais nova.
 *
 * A primeira e a última são semanas inteiras mesmo quando a temporada começa
 * numa quarta: o prêmio é por semana, não pró-rata dos dias corridos.
 */
export function weeksInRange(startIso: string, endIso: string): WeekRange[] {
  const first = weekRange(startIso);
  const last = weekRange(endIso);
  const dias = (Date.parse(`${last.from}T00:00:00Z`) - Date.parse(`${first.from}T00:00:00Z`)) / 86_400_000;
  const semanas = Math.round(dias / 7) + 1;
  // Fim antes do começo devolve vazio em vez de laço: `semanas` sai <= 0 (ou
  // NaN, se a data vier quebrada) e a comparação recusa os dois casos.
  if (!(semanas > 0)) return [];
  return Array.from({ length: semanas }, (_, i) => weekRange(shiftDays(first.from, i * 7)));
}

/**
 * Chaves do cache. Todas sob `["game", …]`, para que uma invalidação por
 * prefixo alcance o placar inteiro. O `EngagementLayer` não recarrega tudo a
 * cada INSERT em `game_events`: agrupa a rajada numa janela (`PLACAR_MS`) e
 * refaz só ranking, temporada e lista de temporadas; a chave `["game"]`
 * inteira só é invalidada quando o canal realtime volta de uma queda.
 */
export const gameKeys = {
  all: ["game"] as const,
  season: ["game", "season"] as const,
  seasons: ["game", "seasons"] as const,
  /**
   * Ambos nulos = temporada inteira; com intervalo, as DUAS pontas entram.
   *
   * Só o começo não identifica a leitura: `intervaloDoMes()` (mês corrente) e
   * `weekRange()` (a semana) começam no mesmo dia sempre que o mês vira numa
   * segunda-feira. Chaves iguais para intervalos diferentes colidem no cache do
   * TanStack Query — a faixa do corretor passava a mostrar o VGV da SEMANA
   * dividido pela meta do MÊS, ou o inverso, conforme qual das duas consultas
   * chegasse primeiro.
   */
  ranking: (seasonId: string | null, weekFrom: string | null = null, weekTo: string | null = null) =>
    ["game", "ranking", seasonId, weekFrom, weekTo] as const,
  rules: (seasonId: string | null) => ["game", "rules", seasonId] as const,
  /** Todas as regras, inclusive as desativadas — só a aba Admin usa. */
  rulesAll: ["game", "rules", "all"] as const,
  results: (seasonId: string | null) => ["game", "results", seasonId] as const,
};
