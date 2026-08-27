import { supabase } from "./client";
import { dbError } from "@/lib/supabaseError";

/**
 * Gamificação — temporadas, regras de pontuação e ranking.
 *
 * A tela calculava tudo no cliente a partir de `deals`, com pesos em `useState`:
 * dois usuários podiam ver rankings diferentes e nada era auditável. A fonte de
 * verdade é `game_events` (alimentada por `award_game_points` e pelos triggers
 * `deals_award_points` / `cca_award_points`), agregada pela view `game_ranking`.
 *
 * Os códigos de evento são os do banco — `incompleto_com_doc`, `esteira`,
 * `aprovado`, `venda`, `distrato`. O front usava um vocabulário próprio
 * (`approved`, `distrato_penalty`) que não casava com `game_events.event_code`,
 * então nenhuma regra editada na tela poderia valer.
 */

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

/** Grava o peso como regra padrão (`season_id null`), que é o que vale para as
 *  próximas temporadas — mexer na temporada corrente reescreveria o passado. */
export async function setDefaultScoringPoints(eventCode: string, label: string, points: number): Promise<void> {
  const { error } = await supabase
    .from("game_scoring_rules")
    .upsert({ season_id: null, event_code: eventCode, label, points, active: true }, { onConflict: "event_code" });
  if (error) throw dbError("salvar regra de pontuação", error);
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

export async function listRanking(seasonId: string): Promise<RankingRow[]> {
  const { data, error } = await supabase
    .rpc("visible_game_ranking", { p_season_id: seasonId })
    .order("points", { ascending: false });
  if (error) throw dbError("visible_game_ranking", error);
  return (data ?? []) as RankingRow[];
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
 * Quem precisa fechar mês usa `closeMonthAndSeason`, o ponto único.
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
 * Chaves do cache. Todas sob `["game", …]` para que uma invalidação só —
 * a que o `EngagementLayer` dispara a cada INSERT em `game_events` — atualize
 * placar, temporada e regras de uma vez.
 */
export const gameKeys = {
  all: ["game"] as const,
  season: ["game", "season"] as const,
  seasons: ["game", "seasons"] as const,
  ranking: (seasonId: string | null) => ["game", "ranking", seasonId] as const,
  rules: (seasonId: string | null) => ["game", "rules", seasonId] as const,
  results: (seasonId: string | null) => ["game", "results", seasonId] as const,
};
