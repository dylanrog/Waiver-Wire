import type { NextRequest } from "next/server";
import { z } from "zod";

import { SleeperNotFound } from "@waiver-wire/sleeper";

import { sleeper } from "@/lib/clients";
import { env } from "@/lib/env";
import { fail, handler, ok } from "@/lib/http";
import { setSession } from "@/lib/session";

const Body = z.object({ username: z.string().trim().min(1) });

/** Connect a Sleeper account by username. Sets the session; no league selected yet. */
export const POST = handler(async (request: NextRequest) => {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail("bad_request", "a Sleeper username is required");

  let user;
  try {
    user = await sleeper().getUser(body.data.username);
  } catch (error) {
    if (error instanceof SleeperNotFound) {
      return fail("user_not_found", `no Sleeper user "${body.data.username}"`, 404);
    }
    throw error;
  }

  const leagues = await sleeper().getLeagues(user.user_id, env().NFL_SEASON);
  await setSession({ sleeperUserId: user.user_id, leagueId: null });

  return ok({
    user: { id: user.user_id, username: user.username ?? null, displayName: user.display_name },
    leagues: leagues.map((league) => ({
      id: league.league_id,
      name: league.name,
      season: league.season,
      totalRosters: league.total_rosters ?? null,
    })),
  });
});
