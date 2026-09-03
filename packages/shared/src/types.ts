import { z } from "zod";

/**
 * The contract between packages. Agents working in separate worktrees code against
 * this file and nothing else from each other.
 *
 * Changing a type here breaks other people's work in flight. If you need a change,
 * say so in your summary instead of editing it unilaterally.
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

export const Position = z.enum(["QB", "RB", "WR", "TE", "K", "DST"]);
export type Position = z.infer<typeof Position>;

/** Roster slots, which include FLEX. Distinct from Position on purpose. */
export const Slot = z.enum(["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BENCH"]);
export type Slot = z.infer<typeof Slot>;

export const FLEX_ELIGIBLE: Position[] = ["RB", "WR", "TE"];

/** Sleeper's player ID. Canonical everywhere — never key on player name. */
export const PlayerId = z.string().min(1).brand<"PlayerId">();
export type PlayerId = z.infer<typeof PlayerId>;

export const Week = z.number().int().min(1).max(18);
export type Week = z.infer<typeof Week>;

export const Player = z.object({
  id: PlayerId,
  fullName: z.string(),
  position: Position,
  team: z.string().nullable(), // null for free agents
  byeWeek: Week.nullable(),
  injuryStatus: z.enum(["OUT", "DOUBTFUL", "QUESTIONABLE", "IR", "ACTIVE"]).nullable(),
});
export type Player = z.infer<typeof Player>;

// ─── Rankings (packages/sources) ─────────────────────────────────────────────

export const SourceId = z.enum(["fantasypros"]); // first source; extend, don't replace
export type SourceId = z.infer<typeof SourceId>;

export const SourceRanking = z.object({
  source: SourceId,
  week: Week,
  position: Position,
  /** 1-based within position. */
  rank: z.number().int().positive(),
  playerId: PlayerId,
  /**
   * Verbatim span or raw record this ranking came from (article text for prose
   * sources; the source's own player object for structured ones). Powers cited
   * reasoning later — capture it now.
   */
  sourceExcerpt: z.string().nullable(),
  fetchedAt: z.coerce.date(),
});
export type SourceRanking = z.infer<typeof SourceRanking>;

/**
 * Every ranking provider implements this. FantasyPros is the first; a second
 * provider and a consensus averager come later without touching callers.
 *
 * Implementations must read through the raw_fetches cache and must not hit the
 * network more than once per (source, week).
 */
export interface RankingSource {
  readonly id: SourceId;
  readonly displayName: string;
  getRankings(week: Week, positions: Position[]): Promise<SourceRanking[]>;
}

/** A name from a source that didn't resolve to a Sleeper player. Surface these. */
export const UnresolvedName = z.object({
  source: SourceId,
  week: Week,
  rawName: z.string(),
  position: Position,
});
export type UnresolvedName = z.infer<typeof UnresolvedName>;

// ─── Projections (packages/projections) ──────────────────────────────────────

/**
 * A player's weekly outcome as a distribution. `sd` is the point of this whole
 * project — do not drop it to simplify a signature.
 */
export const Projection = z.object({
  playerId: PlayerId,
  mean: z.number(),
  sd: z.number().nonnegative(),
  /** Where the mean came from, for the explanation layer. */
  basis: z.object({
    source: SourceId,
    positionRank: z.number().int().positive(),
  }),
});
export type Projection = z.infer<typeof Projection>;

/** Summary of a simulated distribution. Show ranges, never bare medians. */
export const Distribution = z.object({
  mean: z.number(),
  p10: z.number(),
  p50: z.number(),
  p90: z.number(),
});
export type Distribution = z.infer<typeof Distribution>;

export const Objective = z.enum([
  /** Maximize expected points. Toggle off. */
  "expected_points",
  /** Maximize win probability vs this week's actual opponent. Toggle on. */
  "win_probability",
]);
export type Objective = z.infer<typeof Objective>;

export const SimConfig = z.object({
  objective: Objective,
  iterations: z.number().int().positive().default(10_000),
  /** Fixed seed so a given week always renders identically. */
  seed: z.number().int().default(42),
});
export type SimConfig = z.infer<typeof SimConfig>;

export const LineupSlot = z.object({
  slot: Slot,
  playerId: PlayerId.nullable(),
});
export type LineupSlot = z.infer<typeof LineupSlot>;

export const StartSitCall = z.object({
  slot: Slot,
  recommended: PlayerId,
  /** Currently in the slot on Sleeper. Differs from `recommended` → suggest a swap. */
  current: PlayerId.nullable(),
  /**
   * Share of simulations where `recommended` beat the best bench alternative.
   * 0.5 means the choice barely matters — say that, don't say "uncertain."
   */
  confidence: z.number().min(0).max(1),
  /** Best alternative considered, so the UI can name it. */
  alternative: PlayerId.nullable(),
  /**
   * Confidence under the *other* objective. The delta is what the toggle
   * explanation is about.
   */
  confidenceUnderOtherObjective: z.number().min(0).max(1),
  projection: Projection,
});
export type StartSitCall = z.infer<typeof StartSitCall>;

export const MatchupAnalysis = z.object({
  week: Week,
  objective: Objective,
  myScore: Distribution,
  opponentScore: Distribution,
  winProbability: z.number().min(0).max(1),
  calls: z.array(StartSitCall),
  /** Slots whose best available option is still weak → offer a waiver scan. */
  weakSlots: z.array(Slot),
});
export type MatchupAnalysis = z.infer<typeof MatchupAnalysis>;

// ─── Waivers ─────────────────────────────────────────────────────────────────

export const WaiverCandidate = z.object({
  playerId: PlayerId,
  position: Position,
  rank: z.number().int().positive(),
  source: SourceId,
  projection: Projection,
  /** Projected gain over the current starter at this slot. Can be negative. */
  upgradeOverCurrent: z.number(),
  currentStarter: PlayerId.nullable(),
});
export type WaiverCandidate = z.infer<typeof WaiverCandidate>;

export const WaiverScan = z.object({
  week: Week,
  slot: Slot,
  candidates: z.array(WaiverCandidate).max(5),
});
export type WaiverScan = z.infer<typeof WaiverScan>;

// ─── Explanations (the only LLM output surface) ──────────────────────────────

/**
 * Generated from numbers that are already computed. The model receives the
 * StartSitCall and writes prose. It never decides anything.
 */
export const CallExplanation = z.object({
  playerId: PlayerId,
  pros: z.array(z.string()).min(1).max(3),
  cons: z.array(z.string()).min(1).max(3),
  /** One line on what flipping the toggle does to this player specifically. */
  toggleEffect: z.string(),
});
export type CallExplanation = z.infer<typeof CallExplanation>;

// ─── Caching ─────────────────────────────────────────────────────────────────

/** Written before parsing, always. Backfill is impossible — see ARCHITECTURE.md. */
export const RawFetch = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  source: z.string(),
  week: Week.nullable(),
  fetchedAt: z.coerce.date(),
  body: z.string(),
  contentType: z.string(),
});
export type RawFetch = z.infer<typeof RawFetch>;
