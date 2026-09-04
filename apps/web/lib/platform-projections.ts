import { and, desc, eq } from "drizzle-orm";

import { insertRawFetch, platformProjections, replacePlatformProjections } from "@waiver-wire/db";
import type { Scoring } from "@waiver-wire/sources";

import { db, sleeper } from "./clients";

export const PROJECTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE = "sleeper:projections";

const FIELD: Record<Scoring, "pts_ppr" | "pts_half_ppr" | "pts_std"> = {
  PPR: "pts_ppr",
  HALF: "pts_half_ppr",
  STD: "pts_std",
};

export function pickPoints(
  stats: { pts_ppr?: number | null; pts_half_ppr?: number | null; pts_std?: number | null },
  scoring: Scoring,
): number | null {
  return stats[FIELD[scoring]] ?? null;
}

/** Fetch this week's Sleeper projections at most once per 6h; degrade to cache. */
export async function ensurePlatformProjections(
  season: string,
  week: number,
  scoring: Scoring,
): Promise<void> {
  const [latest] = await db()
    .select()
    .from(platformProjections)
    .where(
      and(
        eq(platformProjections.season, season),
        eq(platformProjections.week, week),
        eq(platformProjections.scoring, scoring),
      ),
    )
    .orderBy(desc(platformProjections.fetchedAt))
    .limit(1);
  if (latest && Date.now() - latest.fetchedAt.getTime() < CACHE_TTL_MS) return;

  const url = `https://api.sleeper.app/projections/nfl/${season}/${week}?season_type=regular&${PROJECTION_POSITIONS.map(
    (p) => `position[]=${p}`,
  ).join("&")}`;

  try {
    const rows = await sleeper().getProjections(season, week, PROJECTION_POSITIONS);
    await insertRawFetch(db(), {
      url,
      source: SOURCE,
      week,
      body: JSON.stringify({ count: rows.length }),
      contentType: "application/json",
    });
    await replacePlatformProjections(
      db(),
      { season, week, scoring },
      rows.map((r) => ({ playerId: r.player_id, points: pickPoints(r.stats, scoring), raw: r.stats })),
    );
  } catch (error) {
    if (latest) return;
    throw error;
  }
}

export async function loadPlatformPoints(
  season: string,
  week: number,
  scoring: Scoring,
): Promise<Map<string, number>> {
  const rows = await db()
    .select()
    .from(platformProjections)
    .where(
      and(
        eq(platformProjections.season, season),
        eq(platformProjections.week, week),
        eq(platformProjections.scoring, scoring),
      ),
    );
  const map = new Map<string, number>();
  for (const row of rows) if (row.points !== null) map.set(row.playerId, row.points);
  return map;
}
