import { cookies } from "next/headers";
import { z } from "zod";

/**
 * The whole session: which Sleeper user connected, and which of their leagues is
 * selected. No account, no password (MVP.md). The data is all public, so the
 * cookie is base64 rather than signed.
 */
export const Session = z.object({
  sleeperUserId: z.string().min(1),
  leagueId: z.string().min(1).nullable(),
});
export type Session = z.infer<typeof Session>;

const COOKIE = "ww_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export function encodeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session)).toString("base64url");
}

export function decodeSession(raw: string | undefined): Session | null {
  if (!raw) return null;
  try {
    const parsed = Session.safeParse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

export async function setSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}
