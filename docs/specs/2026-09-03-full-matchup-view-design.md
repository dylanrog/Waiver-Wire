# Full matchup view — design

**Status:** draft, awaiting review
**Date:** 2026-09-03
**Touches:** `packages/sleeper`, `packages/db`, `packages/shared`, `apps/web`

## Goal

Replace the current start/sit-only dashboard with a full matchup view: your
whole team (starters + bench) and your opponent's whole roster (starters +
bench), each player carrying the data you'd see on Sleeper — position, name,
NFL team, kickoff, injury tag — plus two projected-points numbers: ours (the
rank→curve mean) and the platform's (Sleeper's weekly projection).

## What this is not

- **Not a confidence rework.** The `StartSitCall.confidence` calculation is
  known-broken (an undisputed starter like Gibbs reads 52% because his
  "alternative" is another starter, not a bench player — see
  `CLAUDE.local.md` → "Deferred / known issues"). This spec renders confidence
  exactly as it is today. The fix is a separate task.
- **No simulation of the opponent's individual players for display.** Win
  probability and the opponent-aware toggle stay; the sim still projects the
  opponent's *starters* internally (rank→curve, unchanged). We just never show
  a per-player number we computed for their side.
- **No projection-model change.** Sleeper's platform projection sits *alongside*
  ours for the reader to compare. It never feeds the math. (CLAUDE.md — the LLM
  and now the platform never touch the math.)
- **No correlation modeling, no new ranking source.** Out of scope.

## Locked decisions

| Question | Decision |
|---|---|
| Platform projected points | Fetch from Sleeper. Display-only, beside our number, on **both** rosters. |
| Bench players (my team) | Projected identically to starters (rank→curve → mean/sd). |
| Opponent roster | Show current starters + bench. No numbers we compute. Platform projection shown. |
| Game time source | ESPN public scoreboard JSON. My call. |
| Layout | "My team wide, opponent rail" — your roster full-width with detail; opponent a narrow right column (position + F.Last + platform pts + injury). |
| Confidence | Rendered as-is. Rework deferred. |

## Architecture

### 1. Platform projections — `packages/sleeper`

New client method:

```ts
getProjections(season: string, week: number, positions: Position[]): Promise<SleeperProjection[]>
```

- Endpoint: `https://api.sleeper.app/projections/nfl/{season}/{week}?season_type=regular&position[]=QB&position[]=RB&…`
  Returns an array; each element has `stats.pts_ppr`, `stats.pts_half_ppr`,
  `stats.pts_std`, `category: "proj"`, and a player identifier.
  **Confirm during implementation:** the exact player-id field (top-level
  `player_id` vs. a nested `player` object) — the response was truncated in the
  spike. Schema must fail loudly if it's absent.
- `SleeperProjection` Zod schema in `packages/sleeper/src/schemas.ts`. Strict on
  `player_id` and the three `pts_*` fields; `.passthrough()` the rest.
- Read-through the `raw_fetches` cache, one network call per (season, week),
  same politeness contract as the FantasyPros source.

### 2. NFL schedule — `apps/web/lib/schedule.ts`

Not a ranking source, so it does not belong in `packages/sources`. It's the
same shape of work as `lib/rankings.ts` (fetch → parse → cache → persist), so it
lives in the app until a second consumer justifies a package.

- Endpoint: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={n}&seasontype=2`
  (resolve the exact season-year param during implementation — a bare `week`
  returned the right season in the spike). Public, no auth, JSON.
- Per `events[]`: `date` (ISO 8601, UTC), `competitions[0].competitors[]` with
  `homeAway` and `team.abbreviation`, `status.type.name`
  (`STATUS_SCHEDULED` / `STATUS_IN_PROGRESS` / `STATUS_FINAL`).
- ESPN Zod schema local to `schedule.ts`. Parse, don't assume.
- Cache raw payload in `raw_fetches` (`source: "espn:schedule"`, `week`).
- **Team abbreviation normalization.** ESPN and Sleeper disagree on a handful
  (`WSH`↔`WAS`, `LAR`/`LAC`, `JAX`, etc.). One `ESPN_TO_SLEEPER_TEAM` map,
  unit-tested against the full 32-team list. A miss must throw, not silently
  drop a game.

### 3. Bench projections — `apps/web/lib/analysis.ts`

`analyzeLeague` already builds a `RosterEntry` (with a projection) for every
`mine.players` id, starters and bench alike. Bench projections exist; they're
just not in the response. No new computation — only surfacing.

### 4. Storage — `packages/db/src/schema.ts`

Two new tables. Both are week-scoped snapshots fed from cached raw fetches;
both follow the existing `updateAllExcept` upsert helper pattern in `queries.ts`.

```
platform_projections
  id            uuid pk
  player_id     text  → players.id
  season        text
  week          integer
  scoring       text        -- 'PPR' | 'HALF' | 'STD' (the league's format)
  points        real        -- the matching pts_* value
  raw           jsonb       -- the whole stats object
  fetched_at    timestamptz
  created_at    timestamptz
  unique (player_id, season, week, scoring)

nfl_games
  id            uuid pk
  season        text
  week          integer
  kickoff       timestamptz     -- from ESPN `date`, stored UTC
  home_team     text            -- normalized to Sleeper abbreviations
  away_team     text
  status        text            -- 'scheduled' | 'in_progress' | 'final'
  raw           jsonb
  fetched_at    timestamptz
  created_at    timestamptz
  unique (season, week, home_team, away_team)
```

Query helpers in `queries.ts`: `replacePlatformProjections(db, key, rows)` and
`replaceNflGames(db, key, rows)` — full-snapshot replace per (season, week),
mirroring `replaceSourceRankings`.

Migration: `pnpm --filter @waiver-wire/db db:generate` then commit the SQL.

### 4b. Retain the complete Sleeper payloads

Decision: pull and keep everything Sleeper returns for rostered players and
rosters, even fields nothing reads yet — dead columns get cleaned up later, but
un-collected history can't be backfilled (CLAUDE.md).

- **Players** — `players.raw` already stores the entire Sleeper player object
  (`ensurePlayerIndex` sets `raw: p`). `SleeperPlayer` is already
  `.passthrough()`. No change needed beyond confirming `raw` is written on every
  sync; the analysis layer reads whatever extra fields it needs (e.g.
  `depth_chart_order`, `years_exp`, `number`, `search_rank`) straight from `raw`.
- **Rosters** — add `rosters.raw jsonb` and make `SleeperRoster`
  `.passthrough()`, so `metadata`, `keepers`, `player_map`, `co_owners`, and any
  future roster fields are retained. `syncLeague` writes the whole roster object
  into `raw`.
- Nothing new is surfaced in the UI from this — it's a persistence-only change.
  `RosterPlayerView` still carries just the typed fields the view uses.

### 5. When the data is fetched

`syncLeague` (`apps/web/lib/sync.ts`) already runs on league select. Add:

- `ensurePlatformProjections(season, week, scoring)` — TTL-cached like the
  player index, refreshed when the cache entry is older than ~6h.
- `ensureNflSchedule(season, week)` — same.

Both also run inside `analyzeLeague` (defensive — the dashboard is
`force-dynamic` and a user can land on it after the Sunday slate has moved).
Degrade to the cached copy on fetch failure; surface staleness, don't blank the
row (CLAUDE.md — "degrade to the cached copy and surface its age").

## The response contract — `packages/shared/src/types.ts`

`FullAnalysis` (in `apps/web/lib/analysis.ts`, not the shared contract file —
it's app-internal) grows two fields. New shared types:

```ts
export const GameInfo = z.object({
  kickoff: z.string(),                 // ISO 8601 UTC; formatted client-side
  opponent: z.string(),                // Sleeper abbr
  home: z.boolean(),
  status: z.enum(["scheduled", "in_progress", "final"]),
});

export const RosterPlayerView = z.object({
  playerId: PlayerId,
  slot: Slot,                          // "BENCH" for bench
  position: Position,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  fullName: z.string(),
  team: z.string().nullable(),
  injuryStatus: z.string().nullable(), // "Q" | "O" | "D" | "IR" | "SUS" | null
  game: GameInfo.nullable(),           // null → team on bye this week
  platformPoints: z.number().nullable(),
});

export const MyRosterPlayerView = RosterPlayerView.extend({
  ourProjection: Projection,           // mean + sd
  call: StartSitCall.nullable(),       // present for starting slots, null for bench
});
```

`FullAnalysis` adds:

```ts
myTeam: MyRosterPlayerView[]           // starters in roster_positions order, then bench
opponentTeam: RosterPlayerView[]       // their starters in slot order, then bench
opponentTeamName: string               // already have opponentName
```

**Roster composition.** Both `myTeam` and `opponentTeam` = starters (in
`roster_positions` order) followed by bench, where bench = `players − starters −
reserve − taxi` (the derivation the schema already documents). IR (`reserve`)
and taxi-squad players are out of scope for v1 — note it in the summary if that
turns out to matter for a real roster.

`myTeam[].call` is the existing `StartSitCall` for that slot — the swap badge,
confidence %, and tap-to-explain all read from it, unchanged. When the opponent
is the synthetic "league average" (no real matchup), `opponentTeam` is `[]` and
the rail renders a "League average — no opponent scheduled" placeholder.

The existing `expectedPoints` / `winProbability` `MatchupAnalysis` bundles and
`waivers` stay exactly as they are.

## UI — `apps/web/components/dashboard.tsx`

The `calls.map(...)` list is replaced by the two-roster view. Header (win
probability, score range), the opponent-aware toggle, the streaming section,
and tap-to-expand-explanation are unchanged.

### Layout

```
Wk 1 · vs Twisted Tim · 0.5 PPR                    68%
you 95–120  ·  them 108
[● Opponent-aware]

 MY TEAM                                        OPP
 ┌──────────────────────────────────────┬───────────┐
 QB  J.Herbert            22.1 · 21    97%   QB  Hurts        24
     LAC @ KC · Sun 1:00                          PHI          —
 RB  J.Gibbs              18.4 · 17    52% ↑     RB  Barkley      19
     DET vs GB · Sun 1:00                        PHI          —
 …
 ─ bench ───────────────────────────────      ─ bench ────────
 RB  T.Bigsby              8.1 · 6              WR  Legette       8
     JAX vs CAR · Sun 1:00                      CAR          —
```

- **Left column (my team), full width minus the rail.** Row line 1:
  `[POS chip]  F.LastName  [injury tag]  ·  {ourMean} · {platformPts}  ·  {confidence%}  [↑ swap]`.
  Row line 2 (muted, smaller): `{TEAM} {vs|@} {OPP} · {Day} {LocalTime}` or `BYE`.
  Tapping a starting row opens the existing pros/cons explanation panel inline.
- **Right rail (opponent), ~92px.** `[POS chip]  L.Last` / muted `{TEAM}` /
  right-aligned `{platformPts}`. Injury tag if any. No tap target.
- **Bench** in both columns under a hairline labeled "bench", same row style,
  no confidence / swap on the left (that's the deferred confidence work).
- Alignment: rows are keyed by slot for the starters so the two columns read
  across; bench lists are independent (different lengths).
- The number pair renders as `{our}` in `--text` and `{platform}` in `--muted`
  with a thin middle dot — our number is the app's opinion, the platform's is
  the reference.

### Game-time formatting

Server sends `kickoff` as ISO UTC. The client formats with
`Intl.DateTimeFormat` in the viewer's timezone: `Sun 1:00`, `Mon 8:15`,
`Thu 8:20`. `final` games render the line in `--muted` with a "Final" replacing
the time; `in_progress` shows a small dot. Team on bye → `BYE` in place of the
whole line.

### Position color coding

New categorical tokens — **not** on the confidence ramp, and clear of `--alert`.
Accepted as provisional (revisit with a colorblind pass; must never read as a
confidence verdict):

```
--pos-qb  #C678B6   magenta
--pos-rb  #6FB86F   green
--pos-wr  #5A9FD4   blue
--pos-te  #D9A15C   sand
--pos-k   #8B84D6   violet
--pos-dst #9C8B6E   taupe
```

Rendered as a small filled chip with the position abbreviation in `--ink`.
`FLEX` uses the chip of the player's actual position.

## Testing

- `packages/sleeper` — `getProjections` schema parse against a captured fixture;
  a malformed `stats` object must throw.
- `apps/web/lib/schedule.ts` — ESPN payload parse against a fixture; the
  team-abbreviation map covers all 32; a missing mapping throws; bye detection
  (a team absent from `events` that week) yields `game: null`.
- `packages/db` — the two new `replace*` helpers (pglite), snapshot-replace
  semantics.
- `apps/web/lib/analysis.ts` — `myTeam` ordering (starters in `roster_positions`
  order then bench), `opponentTeam` built from the synced opponent roster,
  `opponentTeam === []` for the league-average case, `platformPoints: null` when
  Sleeper has no projection for a player.
- No projection-math tests change — the math is untouched.
- Dashboard: one smoke render with a fixture `FullAnalysis`.

## Rollout

1. `packages/sleeper` — `getProjections` + `SleeperProjection` schema; make
   `SleeperRoster` `.passthrough()`; fixture tests.
2. `packages/db` — `platform_projections` + `nfl_games` tables, `rosters.raw`
   column, migration, `replace*` helpers.
3. `apps/web/lib/schedule.ts` — ESPN fetch + team map + cache + `replaceNflGames`.
4. `apps/web/lib/sync.ts` — write `rosters.raw`; add `ensurePlatformProjections`
   / `ensureNflSchedule`.
5. `apps/web/lib/analysis.ts` — assemble `myTeam` / `opponentTeam`; wire the
   `ensure*` calls.
6. `packages/shared` — the new view types. (Coordinated change — call it out in
   the summary per the file's own instruction.)
7. `apps/web/components/dashboard.tsx` — the two-roster layout + position tokens.

Steps 1–3 are independent and can land in any order. 4–5 depend on 1–3, 7 on 6.

## Risks / open questions

- **Sleeper projections endpoint is unofficial.** No stability guarantee. The
  strict schema means a shape change fails at parse (loud), and the row degrades
  to `platformPoints: null` rather than breaking the page.
- **ESPN scoreboard params.** The season-year selector needs nailing down so an
  early-week fetch doesn't return the prior postseason.
- **Position palette** — proposed above, not validated. Worth a quick look
  before it ships.
- **Rail width at 360px.** `L.Last` + a 2-digit number is ~92px; below that the
  name truncates to initials. Acceptable, but confirm on a real device.
- **"All the data on Sleeper"** — the *view* ships position, name, team,
  kickoff, injury, bye. The *store* keeps the full Sleeper player and roster
  objects (§4b), so anything else (depth chart, experience, news timestamp) is a
  read away without a re-sync.
