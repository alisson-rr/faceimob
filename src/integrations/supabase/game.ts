import { supabase } from "./client";

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
  if (error) throw new Error(error.message);

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
  if (error) throw new Error(error.message);
}

export async function getCurrentSeasonId(): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_game_season");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function listSeasons(): Promise<GameSeason[]> {
  const { data, error } = await supabase
    .from("game_seasons")
    .select("id,label,period_start,period_end,closed_at")
    .order("period_start", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GameSeason[];
}

export async function listRanking(seasonId: string): Promise<RankingRow[]> {
  const { data, error } = await supabase
    .rpc("visible_game_ranking", { p_season_id: seasonId })
    .order("points", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as RankingRow[];
}

/** Resultado congelado de uma temporada fechada. */
export async function listSeasonResults(seasonId: string): Promise<SeasonResultRow[]> {
  const { data, error } = await supabase
    .from("game_season_results")
    .select("season_id,profile_id,rank,points,sales,vgv,breakdown")
    .eq("season_id", seasonId)
    .order("rank");
  if (error) throw new Error(error.message);
  return (data ?? []) as SeasonResultRow[];
}

/**
 * Encerra a temporada aberta: congela o ranking em `game_season_results` e abre
 * a próxima, tudo na mesma transação. Só admin — a própria função recusa os
 * demais com 42501.
 */
export async function closeGameSeason(nextLabel?: string, closeMonth = true): Promise<string> {
  const { data, error } = await supabase.rpc("close_game_season", {
    p_next_label: nextLabel ?? null,
    p_close_month: closeMonth,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
