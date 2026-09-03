import type { NextRequest } from "next/server";
import { z } from "zod";

import { Objective, StartSitCall } from "@waiver-wire/shared";

import { explainCall } from "@/lib/explain";
import { fail, handler, ok } from "@/lib/http";
import { getSession } from "@/lib/session";

const Body = z.object({
  call: StartSitCall,
  objective: Objective,
  recommendedName: z.string(),
  alternativeName: z.string().nullable(),
  currentName: z.string().nullable(),
  opponentName: z.string(),
  winProbability: z.number(),
});

/** Prose for one start/sit call — generated on demand when a row is tapped. */
export const POST = handler(async (request: NextRequest) => {
  const session = await getSession();
  if (!session) return fail("no_session", "connect a Sleeper account first", 401);

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail("bad_request", "invalid call payload");

  return ok(await explainCall(body.data));
});
