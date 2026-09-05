import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { Db } from "./client";
import {
  leagues,
  nflGames,
  platformProjections,
  players,
  rawFetches,
  rosters,
  sourceRankings,
  unresolvedNames,
} from "./schema";

// ─── helpers ────────────────────────────────────────────────────────────────

function requireRow<T>(rows: readonly T[], op: string): T {
  const row = rows[0];
  if (row === undefined) throw new Error(`${op}: expected a returned row`);
  return row;
}

function* chunked<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/** `set` clause that copies every column from the attempted insert except `keep`. */
function updateAllExcept<T extends PgTable>(table: T, keep: string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([name]) => !keep.includes(name))
      .map(([name, column]) => [name, sql`excluded.${sql.identifier(column.name)}`]),
  );
}

// ─── raw_fetches ────────────────────────────────────────────────────────────

export interface RawFetchInput {
  url: string;
  source: string;
  week: number | null;
  body: string;
  contentType: string;
  fetchedAt?: Date;
}

export async function insertRawFetch(db: Db, input: RawFetchInput) {
  const rows = await db
    .insert(rawFetches)
    .values({ ...input, fetchedAt: input.fetchedAt ?? new Date() })
    .returning();
  return requireRow(rows, "insertRawFetch");
}

/** Most recent cached fetch for a source and week. `null` week = week-independent (player index). */
export async function latestRawFetch(db: Db, source: string, week: number | null) {
  const rows = await db
    .select()
    .from(rawFetches)
    .where(
      and(
        eq(rawFetches.source, source),
        week === null ? isNull(rawFetches.week) : eq(rawFetches.week, week),
      ),
    )
    .orderBy(sql`${rawFetches.fetchedAt} desc`)
    .limit(1);
  return rows[0];
}

// ─── leagues ────────────────────────────────────────────────────────────────

export interface LeagueInput {
  id: string;
  name: string;
  season: string;
  sport?: string;
  totalRosters?: number | null;
  status?: string | null;
  scoringSettings?: Record<string, number> | null;
  rosterPositions?: string[] | null;
  settings?: Record<string, unknown> | null;
  previousLeagueId?: string | null;
  syncedAt?: Date | null;
}

export async function upsertLeague(db: Db, input: LeagueInput) {
  const rows = await db
    .insert(leagues)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: leagues.id,
      set: updateAllExcept(leagues, ["id", "createdAt"]),
    })
    .returning();
  return requireRow(rows, "upsertLeague");
}

// ─── rosters ────────────────────────────────────────────────────────────────

export interface RosterInput {
  sleeperRosterId: number;
  sleeperOwnerId?: string | null;
  ownerDisplayName?: string | null;
  teamName?: string | null;
  isCurrentUser?: boolean;
  players?: string[];
  starters?: string[];
  reserve?: string[];
  taxi?: string[];
  raw?: Record<string, unknown> | null;
  settings?: Record<string, unknown> | null;
  syncedAt?: Date | null;
}

export async function upsertRosters(db: Db, leagueId: string, input: RosterInput[]) {
  if (input.length === 0) return [];
  const now = new Date();
  return db
    .insert(rosters)
    .values(input.map((r) => ({ ...r, leagueId, updatedAt: now })))
    .onConflictDoUpdate({
      target: [rosters.leagueId, rosters.sleeperRosterId],
      set: updateAllExcept(rosters, ["id", "leagueId", "sleeperRosterId", "createdAt"]),
    })
    .returning();
}

// ─── players (metadata cache) ───────────────────────────────────────────────

export interface PlayerInput {
  id: string;
  fullName: string;
  firstName?: string | null;
  lastName?: string | null;
  position?: string | null;
  team?: string | null;
  byeWeek?: number | null;
  injuryStatus?: string | null;
  fantasyPositions?: string[] | null;
  status?: string | null;
  depthChartOrder?: number | null;
  newsUpdated?: number | null;
  raw?: Record<string, unknown> | null;
}

export async function upsertPlayers(db: Db, input: PlayerInput[]): Promise<void> {
  const now = new Date();
  for (const chunk of chunked(input, 1000)) {
    await db
      .insert(players)
      .values(chunk.map((p) => ({ ...p, updatedAt: now })))
      .onConflictDoUpdate({
        target: players.id,
        set: updateAllExcept(players, ["id", "createdAt"]),
      });
  }
}

// ─── source_rankings ────────────────────────────────────────────────────────

export interface SourceRankingInput {
  position: string;
  rank: number;
  playerId: string;
  sourceExcerpt?: string | null;
  fetchedAt: Date;
}

/** A week's rankings are a full snapshot — replace, don't merge, so stale ranks never linger. */
export async function replaceSourceRankings(
  db: Db,
  key: { source: string; week: number },
  rows: SourceRankingInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(sourceRankings)
      .where(and(eq(sourceRankings.source, key.source), eq(sourceRankings.week, key.week)));
    if (rows.length > 0) {
      await tx
        .insert(sourceRankings)
        .values(rows.map((r) => ({ ...r, source: key.source, week: key.week })));
    }
  });
}

// ─── unresolved_names ───────────────────────────────────────────────────────

export interface UnresolvedNameInput {
  source: string;
  week: number;
  rawName: string;
  position: string;
}

export async function recordUnresolvedNames(db: Db, names: UnresolvedNameInput[]): Promise<void> {
  if (names.length === 0) return;
  await db.insert(unresolvedNames).values(names).onConflictDoNothing();
}

// ─── platform_projections ───────────────────────────────────────────────────

export interface PlatformProjectionInput {
  playerId: string;
  points: number | null;
  raw: Record<string, unknown>;
}

/** A week's platform projections are a full snapshot — replace, don't merge. */
export async function replacePlatformProjections(
  db: Db,
  key: { season: string; week: number; scoring: string },
  rows: PlatformProjectionInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(platformProjections)
      .where(
        and(
          eq(platformProjections.season, key.season),
          eq(platformProjections.week, key.week),
          eq(platformProjections.scoring, key.scoring),
        ),
      );
    if (rows.length > 0) {
      const fetchedAt = new Date();
      for (const chunk of chunked(rows, 1000)) {
        await tx
          .insert(platformProjections)
          .values(chunk.map((r) => ({ ...r, ...key, fetchedAt })));
      }
    }
  });
}

// ─── nfl_games ──────────────────────────────────────────────────────────────

export interface NflGameInput {
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  status: string;
  raw: Record<string, unknown>;
}

/** A week's schedule is a full snapshot — replace, don't merge. */
export async function replaceNflGames(
  db: Db,
  key: { season: string; week: number },
  rows: NflGameInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(nflGames)
      .where(and(eq(nflGames.season, key.season), eq(nflGames.week, key.week)));
    if (rows.length > 0) {
      const fetchedAt = new Date();
      await tx.insert(nflGames).values(rows.map((r) => ({ ...r, ...key, fetchedAt })));
    }
  });
}
