import {
  insertRawFetch,
  latestRawFetch,
  upsertLeague,
  upsertPlayers,
  upsertRosters,
} from "@waiver-wire/db";

import { db, sleeper } from "./clients";

const PLAYER_INDEX_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh the Sleeper player index at most once a day (its stated limit). The
 * ~5MB body isn't stored — a small marker row in `raw_fetches` tracks freshness.
 */
export async function ensurePlayerIndex(): Promise<void> {
  const last = await latestRawFetch(db(), "sleeper:players", null);
  if (last && Date.now() - last.fetchedAt.getTime() < PLAYER_INDEX_TTL_MS) return;

  const players = await sleeper().getAllPlayers();
  await upsertPlayers(
    db(),
    players.map((p) => ({
      id: p.player_id,
      fullName:
        p.full_name ?? ([p.first_name, p.last_name].filter(Boolean).join(" ") || p.player_id),
      firstName: p.first_name ?? null,
      lastName: p.last_name ?? null,
      position: p.position ?? null,
      team: p.team ?? null,
      injuryStatus: p.injury_status ?? null,
      fantasyPositions: p.fantasy_positions ?? null,
      status: p.status ?? null,
      newsUpdated: p.news_updated ?? null,
      raw: p as Record<string, unknown>,
    })),
  );
  await insertRawFetch(db(), {
    url: "https://api.sleeper.app/v1/players/nfl",
    source: "sleeper:players",
    week: null,
    body: JSON.stringify({ count: players.length }),
    contentType: "application/json",
  });
}

/** Pull a league's settings, rosters, and members from Sleeper into the DB. */
export async function syncLeague(leagueId: string, sleeperUserId: string): Promise<void> {
  await ensurePlayerIndex();

  const [league, rosters, users] = await Promise.all([
    sleeper().getLeague(leagueId),
    sleeper().getRosters(leagueId),
    sleeper().getLeagueUsers(leagueId),
  ]);

  const teamName = new Map(
    users.map((u) => [u.user_id, u.metadata?.team_name ?? u.display_name] as const),
  );

  await upsertLeague(db(), {
    id: league.league_id,
    name: league.name,
    season: league.season,
    sport: league.sport,
    totalRosters: league.total_rosters ?? null,
    status: league.status ?? null,
    scoringSettings: league.scoring_settings,
    rosterPositions: league.roster_positions,
    settings: league.settings,
    previousLeagueId: league.previous_league_id ?? null,
    syncedAt: new Date(),
  });

  await upsertRosters(
    db(),
    league.league_id,
    rosters.map((r) => ({
      sleeperRosterId: r.roster_id,
      sleeperOwnerId: r.owner_id,
      ownerDisplayName: r.owner_id ? (teamName.get(r.owner_id) ?? null) : null,
      teamName: r.owner_id ? (teamName.get(r.owner_id) ?? null) : null,
      isCurrentUser: r.owner_id === sleeperUserId,
      players: r.players ?? [],
      starters: r.starters ?? [],
      reserve: r.reserve ?? [],
      taxi: r.taxi ?? [],
      settings: r.settings as Record<string, unknown>,
    })),
  );
}
