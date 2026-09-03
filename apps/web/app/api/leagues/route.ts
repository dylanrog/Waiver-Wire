import { db, sleeper } from "@/lib/clients";
import { env } from "@/lib/env";
import { fail, handler, ok } from "@/lib/http";
import { getSession } from "@/lib/session";

/** The connected user's NFL leagues for the current season, each flagged if synced. */
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return fail("no_session", "connect a Sleeper account first", 401);

  const leagues = await sleeper().getLeagues(session.sleeperUserId, env().NFL_SEASON);
  const synced = await db().query.leagues.findMany({ columns: { id: true } });
  const syncedIds = new Set(synced.map((l) => l.id));

  return ok({
    leagues: leagues.map((league) => ({
      id: league.league_id,
      name: league.name,
      season: league.season,
      totalRosters: league.total_rosters ?? null,
      selected: syncedIds.has(league.league_id),
    })),
  });
});
