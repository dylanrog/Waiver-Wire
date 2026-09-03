import { fail, handler, ok } from "@/lib/http";
import { getSession, setSession } from "@/lib/session";
import { syncLeague } from "@/lib/sync";

interface Ctx {
  params: Promise<{ leagueId: string }>;
}

/** Select a league: sync its settings + rosters to the DB and remember it in the session. */
export const POST = handler(async (_request: Request, ctx: Ctx) => {
  const session = await getSession();
  if (!session) return fail("no_session", "connect a Sleeper account first", 401);

  const { leagueId } = await ctx.params;
  await syncLeague(leagueId, session.sleeperUserId);
  await setSession({ ...session, leagueId });

  return ok({ leagueId });
});
