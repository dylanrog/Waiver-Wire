import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The single place tables are declared (CLAUDE.md — never add one elsewhere).
 * Shapes follow packages/shared/src/types.ts; anything Sleeper-specific beyond
 * the domain type is kept as a `raw` jsonb blob so a payload change never loses
 * data before we've decided we need it.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

// ─── Sleeper league + rosters ────────────────────────────────────────────────

export const leagues = pgTable("leagues", {
  /** Sleeper league_id — canonical, and what the session cookie holds. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  season: text("season").notNull(),
  sport: text("sport").notNull().default("nfl"),
  totalRosters: integer("total_rosters"),
  status: text("status"),
  /** Raw Sleeper blobs — scoring_type / superflex / waiver settings are derived, not stored. */
  scoringSettings: jsonb("scoring_settings").$type<Record<string, number>>(),
  rosterPositions: jsonb("roster_positions").$type<string[]>(),
  settings: jsonb("settings").$type<Record<string, unknown>>(),
  previousLeagueId: text("previous_league_id"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  ...timestamps,
});

export const rosters = pgTable(
  "rosters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: text("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    sleeperRosterId: integer("sleeper_roster_id").notNull(),
    sleeperOwnerId: text("sleeper_owner_id"),
    ownerDisplayName: text("owner_display_name"),
    teamName: text("team_name"),
    isCurrentUser: boolean("is_current_user").notNull().default(false),
    /** Arrays of Sleeper player ids. Bench is derived: players − starters − reserve − taxi. */
    players: jsonb("players").$type<string[]>().notNull().default([]),
    starters: jsonb("starters").$type<string[]>().notNull().default([]),
    reserve: jsonb("reserve").$type<string[]>().notNull().default([]),
    taxi: jsonb("taxi").$type<string[]>().notNull().default([]),
    settings: jsonb("settings").$type<Record<string, unknown>>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("rosters_league_roster_uq").on(t.leagueId, t.sleeperRosterId)],
);

// ─── Player metadata cache (the ~5MB Sleeper index) ──────────────────────────

export const players = pgTable(
  "players",
  {
    /** Sleeper player_id — numeric string for players, team abbr for DST. */
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    /** Sleeper's raw position string; may be outside the domain Position enum (OL, LB, …). */
    position: text("position"),
    team: text("team"),
    byeWeek: integer("bye_week"),
    injuryStatus: text("injury_status"),
    fantasyPositions: jsonb("fantasy_positions").$type<string[]>(),
    status: text("status"),
    depthChartOrder: integer("depth_chart_order"),
    /** Epoch ms from Sleeper. */
    newsUpdated: bigint("news_updated", { mode: "number" }),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("players_position_idx").on(t.position), index("players_team_idx").on(t.team)],
);

// ─── Rankings (packages/sources) ─────────────────────────────────────────────

export const sourceRankings = pgTable(
  "source_rankings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A SourceId — 'fantasypros' today. */
    source: text("source").notNull(),
    week: integer("week").notNull(),
    /** A domain Position. */
    position: text("position").notNull(),
    /** 1-based within position. */
    rank: integer("rank").notNull(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
    /** Verbatim span / raw record this ranking came from. */
    sourceExcerpt: text("source_excerpt"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("source_rankings_snapshot_uq").on(t.source, t.week, t.position, t.rank),
    index("source_rankings_lookup_idx").on(t.source, t.week, t.position),
  ],
);

/** Source names that didn't resolve to a Sleeper player. Surfaced, never swallowed. */
export const unresolvedNames = pgTable(
  "unresolved_names",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    week: integer("week").notNull(),
    rawName: text("raw_name").notNull(),
    position: text("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("unresolved_names_uq").on(t.source, t.week, t.rawName, t.position)],
);

// ─── Fetch cache (CLAUDE.md — write the raw payload before parsing, always) ───

export const rawFetches = pgTable(
  "raw_fetches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    /** Free-form: 'fantasypros', 'sleeper:players', 'sleeper:league', … */
    source: text("source").notNull(),
    /** Null for week-independent fetches like the player index. */
    week: integer("week"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    body: text("body").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("raw_fetches_source_week_idx").on(t.source, t.week, t.fetchedAt)],
);

// ─── Analysis output (packages/projections → apps/web) ───────────────────────

export const analysisRuns = pgTable("analysis_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueId: text("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" }),
  rosterId: uuid("roster_id").references(() => rosters.id, { onDelete: "set null" }),
  week: integer("week").notNull(),
  /** A MatchupAnalysis bundle. Shape firms up in Wave 2/3; jsonb until then. */
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Relations ──────────────────────────────────────────────────────────────

export const leaguesRelations = relations(leagues, ({ many }) => ({
  rosters: many(rosters),
  analysisRuns: many(analysisRuns),
}));

export const rostersRelations = relations(rosters, ({ one }) => ({
  league: one(leagues, { fields: [rosters.leagueId], references: [leagues.id] }),
}));

export const sourceRankingsRelations = relations(sourceRankings, ({ one }) => ({
  player: one(players, { fields: [sourceRankings.playerId], references: [players.id] }),
}));
