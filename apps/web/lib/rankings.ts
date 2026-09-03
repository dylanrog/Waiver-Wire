import { and, desc, eq } from "drizzle-orm";

import {
  insertRawFetch,
  players as playersTable,
  rawFetches,
  recordUnresolvedNames,
  replaceSourceRankings,
} from "@waiver-wire/db";
import { toResolverPlayers } from "@waiver-wire/sleeper";
import type { SleeperPlayer } from "@waiver-wire/sleeper";
import { createFantasyProsSource, type RawFetchCache, type Scoring } from "@waiver-wire/sources";
import type { Position, SourceRanking } from "@waiver-wire/shared";
import { resolveRankingNames } from "@waiver-wire/sleeper";

import { db } from "./clients";

const POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "DST"];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** PPR from the league's `scoring_settings.rec`. */
export function scoringOf(scoringSettings: Record<string, number> | null | undefined): Scoring {
  const rec = scoringSettings?.rec ?? 0;
  if (rec >= 1) return "PPR";
  if (rec >= 0.5) return "HALF";
  return "STD";
}

function fantasyProsCache(week: number): RawFetchCache {
  return {
    read: async ({ url }) => {
      const [row] = await db()
        .select()
        .from(rawFetches)
        .where(and(eq(rawFetches.url, url), eq(rawFetches.week, week)))
        .orderBy(desc(rawFetches.fetchedAt))
        .limit(1);
      if (row && Date.now() - row.fetchedAt.getTime() < CACHE_TTL_MS) return row.body;
      return null;
    },
    write: async ({ url, source, body, contentType, fetchedAt }) => {
      await insertRawFetch(db(), { url, source, week, body, contentType, fetchedAt });
    },
  };
}

async function playerIndex() {
  const rows = await db().select().from(playersTable);
  return toResolverPlayers(
    rows.map((r): SleeperPlayer => ({
      player_id: r.id,
      full_name: r.fullName,
      first_name: r.firstName,
      last_name: r.lastName,
      position: r.position,
      team: r.team,
      fantasy_positions: r.fantasyPositions,
      injury_status: r.injuryStatus,
    })),
  );
}

export interface WeekRankings {
  rankings: SourceRanking[];
  scoring: Scoring;
}

/**
 * This week's FantasyPros rankings for the league's scoring, resolved to Sleeper
 * ids, cached through `raw_fetches` and persisted to `source_rankings`.
 */
export async function loadWeekRankings(week: number, scoring: Scoring): Promise<WeekRankings> {
  const index = await playerIndex();
  const source = createFantasyProsSource({
    scoring,
    userAgent: "waiver-wire/0.1 (personal fantasy tool)",
    cache: fantasyProsCache(week),
    resolve: (queries, ctx) => resolveRankingNames(index, queries, ctx),
  });

  const { rankings, unresolved } = await source.getRankings(week, POSITIONS);

  // The whole week's snapshot in one replace — dedup by (position, rank), which
  // the source_rankings unique index enforces anyway.
  const seen = new Set<string>();
  await replaceSourceRankings(
    db(),
    { source: "fantasypros", week },
    rankings.flatMap((r) => {
      const key = `${r.position}:${r.rank}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          position: r.position,
          rank: r.rank,
          playerId: r.playerId,
          sourceExcerpt: r.sourceExcerpt,
          fetchedAt: r.fetchedAt,
        },
      ];
    }),
  );

  if (unresolved.length > 0) {
    await recordUnresolvedNames(
      db(),
      unresolved.map((u) => ({
        source: u.source,
        week: u.week,
        rawName: u.rawName,
        position: u.position,
      })),
    );
  }

  return { rankings, scoring };
}
