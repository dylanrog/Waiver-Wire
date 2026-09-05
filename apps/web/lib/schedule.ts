import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  insertRawFetch,
  nflGames,
  replaceNflGames,
  type NflGameInput,
} from "@waiver-wire/db";

import { db } from "./clients";
import { env } from "./env";

export const SLEEPER_TEAMS = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
  "HOU", "IND", "JAX", "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
]);

/** ESPN abbreviation → Sleeper abbreviation, for the handful that differ. */
const ESPN_OVERRIDES: Record<string, string> = { WSH: "WAS", JAC: "JAX", LA: "LAR", OAK: "LV", SD: "LAC" };

export function normalizeTeam(espnAbbr: string): string {
  const mapped = ESPN_OVERRIDES[espnAbbr] ?? espnAbbr;
  if (!SLEEPER_TEAMS.has(mapped)) {
    throw new Error(`schedule: unmapped NFL team abbreviation "${espnAbbr}"`);
  }
  return mapped;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE = "espn:schedule";

function scoreboardUrl(season: string, week: number): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`;
}

const Competitor = z.object({
  homeAway: z.enum(["home", "away"]),
  team: z.object({ abbreviation: z.string() }),
});
const Event = z.object({
  date: z.string(),
  status: z.object({ type: z.object({ name: z.string() }) }),
  competitions: z
    .array(z.object({ competitors: z.array(Competitor).length(2) }))
    .nonempty(),
});
const Scoreboard = z.object({ season: z.object({ year: z.number() }), events: z.array(Event) });

function toStatus(espnName: string): NflGameInput["status"] {
  if (espnName === "STATUS_FINAL") return "final";
  if (espnName === "STATUS_IN_PROGRESS" || espnName === "STATUS_HALFTIME") return "in_progress";
  return "scheduled";
}

export function parseScoreboard(json: unknown, season: string, _week: number): NflGameInput[] {
  const board = Scoreboard.parse(json);
  if (board.season.year !== Number(season)) {
    throw new Error(
      `schedule: ESPN returned season ${board.season.year}, expected ${season} — check the "dates" query param`,
    );
  }
  return board.events.map((event) => {
    const competitors = event.competitions[0].competitors;
    const home = competitors.find((c) => c.homeAway === "home");
    const away = competitors.find((c) => c.homeAway === "away");
    if (!home || !away) {
      throw new Error("schedule: ESPN event is missing a home or away competitor");
    }
    return {
      kickoff: new Date(event.date),
      homeTeam: normalizeTeam(home.team.abbreviation),
      awayTeam: normalizeTeam(away.team.abbreviation),
      status: toStatus(event.status.type.name),
      raw: event as Record<string, unknown>,
    };
  });
}

export interface TeamGame {
  kickoff: string;
  opponent: string;
  home: boolean;
  status: "scheduled" | "in_progress" | "final";
}

export function gamesByTeam(
  rows: { kickoff: Date; homeTeam: string; awayTeam: string; status: string }[],
): Map<string, TeamGame> {
  const map = new Map<string, TeamGame>();
  for (const row of rows) {
    const status = row.status as TeamGame["status"];
    map.set(row.homeTeam, { kickoff: row.kickoff.toISOString(), opponent: row.awayTeam, home: true, status });
    map.set(row.awayTeam, { kickoff: row.kickoff.toISOString(), opponent: row.homeTeam, home: false, status });
  }
  return map;
}

/** Fetch this week's schedule at most once per 6h; degrade to whatever's cached. */
export async function ensureNflSchedule(season: string, week: number): Promise<void> {
  const [latest] = await db()
    .select()
    .from(nflGames)
    .where(and(eq(nflGames.season, season), eq(nflGames.week, week)))
    .orderBy(desc(nflGames.fetchedAt))
    .limit(1);
  if (latest && Date.now() - latest.fetchedAt.getTime() < CACHE_TTL_MS) return;

  const url = scoreboardUrl(season, week);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": env().FETCH_USER_AGENT, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`ESPN scoreboard ${url} → ${res.status}`);
    const body = await res.text();
    await insertRawFetch(db(), { url, source: SOURCE, week, body, contentType: "application/json" });
    await replaceNflGames(db(), { season, week }, parseScoreboard(JSON.parse(body), season, week));
  } catch (error) {
    console.error(`schedule: ESPN scoreboard refresh failed for week ${week}`, error);
    if (latest) return; // keep the stale copy rather than blanking the view
    throw error;
  }
}

export async function loadGamesByTeam(season: string, week: number): Promise<Map<string, TeamGame>> {
  const rows = await db()
    .select()
    .from(nflGames)
    .where(and(eq(nflGames.season, season), eq(nflGames.week, week)));
  return gamesByTeam(rows);
}
