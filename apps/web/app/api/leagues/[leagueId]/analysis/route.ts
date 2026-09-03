import { analyzeLeague } from "@/lib/analysis";
import { fail, handler, ok } from "@/lib/http";
import { getSession } from "@/lib/session";

interface Ctx {
  params: Promise<{ leagueId: string }>;
}

/**
 * The full matchup picture: `analyzeMatchup` under both toggle states plus a
 * waiver scan of the weak slots. Both objectives are returned so the dashboard
 * toggle is instant, not a refetch.
 */
export const GET = handler(async (_request: Request, ctx: Ctx) => {
  const session = await getSession();
  if (!session) return fail("no_session", "connect a Sleeper account first", 401);

  const { leagueId } = await ctx.params;
  const analysis = await analyzeLeague(leagueId);
  if (!analysis) return fail("league_not_selected", "select this league first", 409);

  return ok(analysis);
});
