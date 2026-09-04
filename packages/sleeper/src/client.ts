import { z } from "zod";

import { SleeperNotFound } from "./errors";
import { getJson, resolveOptions, type SleeperClientOptions } from "./http";
import {
  SleeperLeague,
  SleeperLeagueUser,
  SleeperMatchup,
  SleeperPlayer,
  SleeperProjection,
  SleeperRoster,
  SleeperState,
  SleeperUser,
} from "./schemas";

export interface SleeperClient {
  getUser(username: string): Promise<SleeperUser>;
  getLeagues(userId: string, season: string): Promise<SleeperLeague[]>;
  getLeague(leagueId: string): Promise<SleeperLeague>;
  getRosters(leagueId: string): Promise<SleeperRoster[]>;
  getLeagueUsers(leagueId: string): Promise<SleeperLeagueUser[]>;
  getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]>;
  getState(): Promise<SleeperState>;
  /**
   * The full ~5MB player index. Call at most once per day and cache — never in a
   * request path. Records that fail validation are skipped, not fatal.
   */
  getAllPlayers(): Promise<SleeperPlayer[]>;
  getProjections(season: string, week: number, positions: string[]): Promise<SleeperProjection[]>;
}

export function createSleeperClient(options: SleeperClientOptions = {}): SleeperClient {
  const opts = resolveOptions(options);

  return {
    async getUser(username) {
      const user = await getJson(
        `/user/${encodeURIComponent(username)}`,
        SleeperUser.nullable(),
        opts,
      );
      if (user === null) throw new SleeperNotFound(`user ${username}`);
      return user;
    },

    getLeagues: (userId, season) =>
      getJson(
        `/user/${encodeURIComponent(userId)}/leagues/nfl/${encodeURIComponent(season)}`,
        z.array(SleeperLeague),
        opts,
      ),

    getLeague: (leagueId) => getJson(`/league/${leagueId}`, SleeperLeague, opts),

    getRosters: (leagueId) => getJson(`/league/${leagueId}/rosters`, z.array(SleeperRoster), opts),

    getLeagueUsers: (leagueId) =>
      getJson(`/league/${leagueId}/users`, z.array(SleeperLeagueUser), opts),

    getMatchups: (leagueId, week) =>
      getJson(`/league/${leagueId}/matchups/${week}`, z.array(SleeperMatchup), opts),

    getState: () => getJson(`/state/nfl`, SleeperState, opts),

    async getAllPlayers() {
      const raw = await getJson(`/players/nfl`, z.record(z.string(), z.unknown()), opts);
      const players: SleeperPlayer[] = [];
      for (const record of Object.values(raw)) {
        const parsed = SleeperPlayer.safeParse(record);
        if (parsed.success) players.push(parsed.data);
      }
      return players;
    },

    getProjections: (season, week, positions) => {
      const query = positions.map((p) => `position[]=${p}`).join("&");
      return getJson(
        `https://api.sleeper.app/projections/nfl/${encodeURIComponent(season)}/${week}?season_type=regular&${query}`,
        z.array(SleeperProjection),
        opts,
      );
    },
  };
}
