import { fail, handler, ok } from "@/lib/http";
import { getStructuredRoster } from "@/lib/roster";
import { getSession } from "@/lib/session";

interface Ctx {
  params: Promise<{ leagueId: string }>;
}

/** The connected user's roster in a selected league, split into starters / bench / IR. */
export const GET = handler(async (_request: Request, ctx: Ctx) => {
  const session = await getSession();
  if (!session) return fail("no_session", "connect a Sleeper account first", 401);

  const { leagueId } = await ctx.params;
  const roster = await getStructuredRoster(leagueId);
  if (!roster) return fail("league_not_selected", "select this league first", 409);

  return ok(roster);
});
