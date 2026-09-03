import { z } from "zod";

/**
 * Zod schemas for raw Sleeper payloads. Permissive where Sleeper is loose
 * (most fields are nullable and records passthrough), strict on the handful of
 * fields we actually depend on. Parse, don't assume (CLAUDE.md).
 */

export const SleeperUser = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
  display_name: z.string(),
  avatar: z.string().nullable().optional(),
});
export type SleeperUser = z.infer<typeof SleeperUser>;

export const SleeperLeague = z.object({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  sport: z.string().default("nfl"),
  status: z.string().nullable().optional(),
  total_rosters: z.number().int().nullable().optional(),
  roster_positions: z.array(z.string()).default([]),
  scoring_settings: z.record(z.string(), z.number()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
  previous_league_id: z.string().nullable().optional(),
});
export type SleeperLeague = z.infer<typeof SleeperLeague>;

export const SleeperRosterSettings = z
  .object({
    wins: z.number().optional(),
    losses: z.number().optional(),
    ties: z.number().optional(),
    fpts: z.number().optional(),
    waiver_position: z.number().optional(),
    waiver_budget_used: z.number().optional(),
  })
  .passthrough();

export const SleeperRoster = z.object({
  roster_id: z.number().int(),
  owner_id: z.string().nullable(),
  league_id: z.string().optional(),
  co_owners: z.array(z.string()).nullable().optional(),
  players: z.array(z.string()).nullable().default(null),
  starters: z.array(z.string()).nullable().default(null),
  reserve: z.array(z.string()).nullable().default(null),
  taxi: z.array(z.string()).nullable().default(null),
  settings: SleeperRosterSettings.default({}),
});
export type SleeperRoster = z.infer<typeof SleeperRoster>;

export const SleeperLeagueUser = z.object({
  user_id: z.string(),
  display_name: z.string(),
  avatar: z.string().nullable().optional(),
  is_owner: z.boolean().nullable().optional(),
  metadata: z.object({ team_name: z.string().optional() }).passthrough().nullable().optional(),
});
export type SleeperLeagueUser = z.infer<typeof SleeperLeagueUser>;

export const SleeperMatchup = z.object({
  roster_id: z.number().int(),
  matchup_id: z.number().int().nullable(),
  points: z.number().nullable().default(0),
  starters: z.array(z.string()).default([]),
  players: z.array(z.string()).default([]),
  starters_points: z.array(z.number()).nullable().optional(),
});
export type SleeperMatchup = z.infer<typeof SleeperMatchup>;

export const SleeperState = z.object({
  week: z.number().int(),
  display_week: z.number().int().optional(),
  season: z.string(),
  season_type: z.string(),
  previous_season: z.string().optional(),
  season_start_date: z.string().optional(),
});
export type SleeperState = z.infer<typeof SleeperState>;

export const SleeperPlayer = z
  .object({
    player_id: z.string(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    full_name: z.string().nullable().optional(),
    search_full_name: z.string().nullable().optional(),
    position: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    fantasy_positions: z.array(z.string()).nullable().optional(),
    injury_status: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    number: z.number().nullable().optional(),
    years_exp: z.number().nullable().optional(),
    depth_chart_order: z.number().nullable().optional(),
    news_updated: z.number().nullable().optional(),
  })
  .passthrough();
export type SleeperPlayer = z.infer<typeof SleeperPlayer>;
