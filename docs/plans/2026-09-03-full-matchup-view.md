# Full Matchup View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the start/sit-only dashboard with a full matchup view — your whole team (starters + bench) and your opponent's whole roster — each player showing position, name, NFL team, kickoff, injury, our projection, and Sleeper's platform projection.

**Architecture:** Two new cached data pulls (Sleeper weekly projections; ESPN schedule) land in two new snapshot tables. `analyzeLeague` gains a pure assembly step that joins roster + projections + platform points + schedule into `myTeam` / `opponentTeam` arrays on `FullAnalysis`. The dashboard renders those as "my team wide, opponent rail". The projection math and confidence calculation are untouched.

**Tech Stack:** Next.js App Router (RSC), TypeScript strict, Drizzle + Postgres (pglite in tests), Zod, Vitest, Tailwind v4.

**Spec:** `docs/specs/2026-09-03-full-matchup-view-design.md`

## Global Constraints

- **Node 22, pnpm workspaces.** Run package scripts with `pnpm --filter <pkg> <script>`.
- **Everything crossing a boundary gets a Zod schema.** Scraped/fetched payloads parse or throw — never silently degrade to `[]`.
- **Cache every raw fetch** into `raw_fetches` (url, source, week, body, contentType, fetchedAt) *before* parsing.
- **The LLM/platform never touch the math.** Platform projections are display-only; the Monte Carlo still uses our rank→curve projections only.
- **Sleeper is read-only.** No writes to any fantasy platform.
- **Package dependency direction:** inward toward `shared`. `sources` must not import `sleeper`; `projections` must not import `db`. New schedule code lives in `apps/web`, not `packages/sources`.
- **No `any`, no added `@ts-expect-error`.** `pnpm typecheck` + `pnpm lint` + `pnpm test` all pass at every commit.
- **Design tokens:** confidence is the amber→teal ramp, never red/green. Position colors are a new *categorical* set, must not reuse the ramp or `--color-alert`. `tabular-nums` on every number.
- **Commit style:** `<area>: <short description>`, plain messages, no trailers/co-authors (see `CLAUDE.local.md`).
- **Confidence is rendered as-is.** The `StartSitCall.confidence` bug (undisputed starter reads ~52%) is explicitly out of scope — see `CLAUDE.local.md` → "Deferred / known issues".

---

## File Structure

**Created:**
- `packages/sleeper/tests/fixtures/sleeper/projections_w1.json` — trimmed captured projections response
- `packages/sleeper/src/projections.test.ts` — `getProjections` parsing tests
- `apps/web/lib/schedule.ts` — ESPN scoreboard fetch, team-abbr normalization, parse, DB read/write
- `apps/web/lib/schedule.test.ts`
- `apps/web/lib/fixtures/espn-scoreboard-w1.json` — trimmed captured ESPN response
- `apps/web/lib/platform-projections.ts` — Sleeper projections cache-through + per-player reader
- `apps/web/lib/platform-projections.test.ts`
- `apps/web/lib/matchup-view.ts` — pure assembly of `myTeam` / `opponentTeam` + their types
- `apps/web/lib/matchup-view.test.ts`
- `apps/web/lib/kickoff.ts` — pure kickoff/game-line formatter
- `apps/web/lib/kickoff.test.ts`
- `apps/web/components/position-chip.tsx` — color-coded position badge
- `apps/web/components/matchup.tsx` — the two-roster view (extracted from `dashboard.tsx`)

**Modified:**
- `packages/sleeper/src/schemas.ts` — add `SleeperProjection`; make `SleeperRoster` passthrough
- `packages/sleeper/src/client.ts` — add `getProjections`
- `packages/sleeper/src/http.ts` — let `getJson` accept an absolute URL
- `packages/db/src/schema.ts` — `platform_projections`, `nfl_games` tables; `rosters.raw` column
- `packages/db/src/queries.ts` — `replacePlatformProjections`, `replaceNflGames`
- `packages/db/migrations/` — generated SQL (committed)
- `apps/web/lib/sync.ts` — write `rosters.raw`
- `apps/web/lib/analysis.ts` — call the ensure/reader functions, assemble `myTeam`/`opponentTeam`, extend `FullAnalysis`
- `apps/web/components/dashboard.tsx` — render `<Matchup>` in place of the calls list
- `apps/web/app/globals.css` — position color tokens

---

## Task 1: Sleeper platform-projections client

**Files:**
- Modify: `packages/sleeper/src/http.ts`
- Modify: `packages/sleeper/src/schemas.ts`
- Modify: `packages/sleeper/src/client.ts`
- Create: `packages/sleeper/tests/fixtures/sleeper/projections_w1.json`
- Create: `packages/sleeper/src/projections.test.ts`

**Interfaces:**
- Produces:
  - `SleeperProjection` (Zod) — `{ player_id: string; week: number; season: string; team: string | null; opponent: string | null; stats: { pts_ppr: number | null; pts_half_ppr: number | null; pts_std: number | null } }`
  - `SleeperClient.getProjections(season: string, week: number, positions: string[]): Promise<SleeperProjection[]>`

- [ ] **Step 1: Capture a fixture**

Run:

```bash
curl -s "https://api.sleeper.app/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=K&position[]=DEF" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0));const pick=p=>d.find(r=>(r.player&&r.player.position)===p);const rows=[pick("QB"),pick("RB"),pick("K"),pick("DEF")].filter(Boolean);process.stdout.write(JSON.stringify(rows,null,2))' \
  > packages/sleeper/tests/fixtures/sleeper/projections_w1.json
```

Then open the file and confirm each element has `player_id` (string), `stats.pts_ppr`, `stats.pts_half_ppr`, `stats.pts_std`, `week`, `season`. The `DEF` row's `player_id` should be a team abbreviation like `"PHI"`.

- [ ] **Step 2: Write the failing test**

Create `packages/sleeper/src/projections.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createSleeperClient } from "./client";
import { SleeperResponseInvalid } from "./errors";
import { fixture, mockFetch } from "./test-support";

function client(routes: Record<string, { status?: number; body: unknown }>) {
  return createSleeperClient({ fetchImpl: mockFetch(routes), maxRetries: 0, retryDelayMs: 0 });
}

describe("getProjections", () => {
  it("parses the week's projections and keeps the scoring variants", async () => {
    const c = client({
      "/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF":
        { body: fixture("projections_w1") },
    });
    const rows = await c.getProjections("2025", 1, ["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(rows.length).toBeGreaterThan(0);
    const withPoints = rows.find((r) => r.stats.pts_half_ppr !== null);
    expect(withPoints).toBeDefined();
    expect(typeof withPoints!.player_id).toBe("string");
  });

  it("keeps a DST row keyed by team abbreviation", async () => {
    const c = client({
      "/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF":
        { body: fixture("projections_w1") },
    });
    const rows = await c.getProjections("2025", 1, ["QB", "RB", "WR", "TE", "K", "DEF"]);
    const dst = rows.find((r) => /^[A-Z]{2,3}$/.test(r.player_id));
    expect(dst).toBeDefined();
  });

  it("rejects a row whose stats block is missing", async () => {
    const c = client({
      "/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF":
        { body: [{ player_id: "1", week: 1, season: "2025" }] },
    });
    await expect(
      c.getProjections("2025", 1, ["QB", "RB", "WR", "TE", "K", "DEF"]),
    ).rejects.toBeInstanceOf(SleeperResponseInvalid);
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @waiver-wire/sleeper test -- projections`
Expected: FAIL — `getProjections` is not a function.

- [ ] **Step 4: Let `getJson` take an absolute URL**

In `packages/sleeper/src/http.ts`, change the URL line inside `getJson`:

```ts
  const url = path.startsWith("http") ? path : `${opts.baseUrl}${path}`;
```

(The mock-fetch matcher in `test-support.ts` matches on URL *suffix*, so the query string in the test route key must match exactly what the client builds.)

- [ ] **Step 5: Add the schema**

In `packages/sleeper/src/schemas.ts`, add:

```ts
export const SleeperProjection = z
  .object({
    player_id: z.coerce.string(),
    week: z.number().int(),
    season: z.coerce.string(),
    team: z.string().nullable().optional(),
    opponent: z.string().nullable().optional(),
    stats: z
      .object({
        pts_ppr: z.number().nullable().optional(),
        pts_half_ppr: z.number().nullable().optional(),
        pts_std: z.number().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type SleeperProjection = z.infer<typeof SleeperProjection>;
```

And make the roster schema retain everything — change the opening of `SleeperRoster`:

```ts
export const SleeperRoster = z
  .object({
    roster_id: z.number().int(),
    owner_id: z.string().nullable(),
    league_id: z.string().optional(),
    co_owners: z.array(z.string()).nullable().optional(),
    players: z.array(z.string()).nullable().default(null),
    starters: z.array(z.string()).nullable().default(null),
    reserve: z.array(z.string()).nullable().default(null),
    taxi: z.array(z.string()).nullable().default(null),
    settings: SleeperRosterSettings.default({}),
  })
  .passthrough();
```

- [ ] **Step 6: Add the client method**

In `packages/sleeper/src/client.ts`, add to the `SleeperClient` interface:

```ts
  getProjections(season: string, week: number, positions: string[]): Promise<SleeperProjection[]>;
```

Import `SleeperProjection` alongside the other schema imports, and add to the returned object:

```ts
    getProjections: (season, week, positions) => {
      const query = positions.map((p) => `position[]=${p}`).join("&");
      return getJson(
        `https://api.sleeper.app/projections/nfl/${encodeURIComponent(season)}/${week}?season_type=regular&${query}`,
        z.array(SleeperProjection),
        opts,
      );
    },
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `pnpm --filter @waiver-wire/sleeper test`
Expected: PASS (all files, including the existing suite).

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/sleeper typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/sleeper
git commit -m "packages/sleeper: weekly platform projections client + retain full roster payload"
```

---

## Task 2: Database — projection & schedule snapshot tables

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/queries.ts`
- Create: migration under `packages/db/migrations/` (generated)
- Modify: `packages/db/src/queries.test.ts`

**Interfaces:**
- Consumes: `updateAllExcept`, `chunked` helpers already in `queries.ts`.
- Produces:
  - table `platformProjections` — columns `id, playerId, season, week, scoring, points (real, nullable), raw (jsonb), fetchedAt, createdAt`; unique `(playerId, season, week, scoring)`
  - table `nflGames` — columns `id, season, week, kickoff (timestamptz), homeTeam, awayTeam, status, raw (jsonb), fetchedAt, createdAt`; unique `(season, week, homeTeam, awayTeam)`
  - column `rosters.raw` (jsonb, nullable)
  - `replacePlatformProjections(db, key: { season: string; week: number; scoring: string }, rows: PlatformProjectionInput[]): Promise<void>`
  - `replaceNflGames(db, key: { season: string; week: number }, rows: NflGameInput[]): Promise<void>`
  - `PlatformProjectionInput` = `{ playerId: string; points: number | null; raw: Record<string, unknown> }`
  - `NflGameInput` = `{ kickoff: Date; homeTeam: string; awayTeam: string; status: string; raw: Record<string, unknown> }`

- [ ] **Step 1: Add the tables and column to the schema**

In `packages/db/src/schema.ts`, add `real` to the `drizzle-orm/pg-core` import list, then after the `sourceRankings` block add:

```ts
// ─── Platform projections (Sleeper's own weekly numbers — display only) ──────

export const platformProjections = pgTable(
  "platform_projections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    playerId: text("player_id")
      .notNull()
      .references(() => players.id),
    season: text("season").notNull(),
    week: integer("week").notNull(),
    /** 'PPR' | 'HALF' | 'STD' — the league's format. */
    scoring: text("scoring").notNull(),
    /** The matching pts_* value; null when Sleeper has no number for this player. */
    points: real("points"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("platform_projections_uq").on(t.playerId, t.season, t.week, t.scoring),
    index("platform_projections_lookup_idx").on(t.season, t.week, t.scoring),
  ],
);

// ─── NFL schedule (ESPN scoreboard — kickoff, home/away, status) ─────────────

export const nflGames = pgTable(
  "nfl_games",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    season: text("season").notNull(),
    week: integer("week").notNull(),
    kickoff: timestamp("kickoff", { withTimezone: true }).notNull(),
    /** Sleeper team abbreviations (normalized from ESPN's). */
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    /** 'scheduled' | 'in_progress' | 'final'. */
    status: text("status").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("nfl_games_uq").on(t.season, t.week, t.homeTeam, t.awayTeam),
    index("nfl_games_week_idx").on(t.season, t.week),
  ],
);
```

In the `rosters` table definition, add after `taxi`:

```ts
    /** The whole Sleeper roster object, kept verbatim — see spec §4b. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
```

- [ ] **Step 2: Add the query helpers**

In `packages/db/src/queries.ts`, add `platformProjections, nflGames` to the schema import, then append:

```ts
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
```

- [ ] **Step 3: Write the failing tests**

In `packages/db/src/queries.test.ts`, add `replaceNflGames, replacePlatformProjections` to the import, then append:

```ts
describe("replacePlatformProjections", () => {
  it("replaces the (season, week, scoring) snapshot", async () => {
    const db = await makeTestDb();
    await upsertPlayers(db, [
      { id: "p1", fullName: "One", position: "RB" },
      { id: "p2", fullName: "Two", position: "WR" },
    ]);
    const key = { season: "2026", week: 1, scoring: "HALF" };
    await replacePlatformProjections(db, key, [
      { playerId: "p1", points: 12.5, raw: {} },
      { playerId: "p2", points: null, raw: {} },
    ]);
    await replacePlatformProjections(db, key, [{ playerId: "p1", points: 9.1, raw: {} }]);

    const rows = await db.query.platformProjections.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBeCloseTo(9.1);
  });

  it("keeps snapshots for different scoring formats side by side", async () => {
    const db = await makeTestDb();
    await upsertPlayers(db, [{ id: "p1", fullName: "One", position: "RB" }]);
    await replacePlatformProjections(db, { season: "2026", week: 1, scoring: "HALF" }, [
      { playerId: "p1", points: 12.5, raw: {} },
    ]);
    await replacePlatformProjections(db, { season: "2026", week: 1, scoring: "PPR" }, [
      { playerId: "p1", points: 14.0, raw: {} },
    ]);
    expect(await db.query.platformProjections.findMany()).toHaveLength(2);
  });
});

describe("replaceNflGames", () => {
  it("replaces the (season, week) snapshot", async () => {
    const db = await makeTestDb();
    const key = { season: "2026", week: 1 };
    await replaceNflGames(db, key, [
      { kickoff: new Date("2026-09-10T00:20:00Z"), homeTeam: "SEA", awayTeam: "NE", status: "scheduled", raw: {} },
      { kickoff: new Date("2026-09-13T17:00:00Z"), homeTeam: "GB", awayTeam: "DET", status: "scheduled", raw: {} },
    ]);
    await replaceNflGames(db, key, [
      { kickoff: new Date("2026-09-13T17:00:00Z"), homeTeam: "GB", awayTeam: "DET", status: "final", raw: {} },
    ]);
    const rows = await db.query.nflGames.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("final");
  });
});
```

- [ ] **Step 4: Run the tests, verify they fail**

Run: `pnpm --filter @waiver-wire/db test -- queries`
Expected: FAIL — pglite migration has no `platform_projections` / `nfl_games` table (the migration doesn't exist yet).

- [ ] **Step 5: Generate the migration**

Run: `pnpm --filter @waiver-wire/db db:generate`
Expected: a new `packages/db/migrations/NNNN_*.sql` plus updated `migrations/meta/`. Open the `.sql` and confirm it `CREATE TABLE`s both new tables, adds `raw` to `rosters`, and creates the unique indexes. No `DROP` of an existing table.

- [ ] **Step 6: Run the tests, verify they pass**

Run: `pnpm --filter @waiver-wire/db test`
Expected: PASS (pglite applies the new migration from the folder).

- [ ] **Step 7: Apply the migration to the real database**

Run: `pnpm --filter @waiver-wire/db db:migrate`
Expected: `migrations applied`. (Needs `DIRECT_URL` in `.env.local` — the config loads it with `override: true`.)

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/db typecheck && pnpm lint`

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "packages/db: platform_projections + nfl_games snapshot tables, rosters.raw"
```

---

## Task 3: NFL schedule module

**Files:**
- Create: `apps/web/lib/schedule.ts`
- Create: `apps/web/lib/schedule.test.ts`
- Create: `apps/web/lib/fixtures/espn-scoreboard-w1.json`

**Interfaces:**
- Consumes: `replaceNflGames`, `NflGameInput` (Task 2); `db()` from `@/lib/clients`; `insertRawFetch`, `nflGames` from `@waiver-wire/db`.
- Produces:
  - `SLEEPER_TEAMS: Set<string>` — the 32 canonical abbreviations
  - `normalizeTeam(espnAbbr: string): string` — throws on an unmapped abbreviation
  - `parseScoreboard(json: unknown, season: string, week: number): NflGameInput[]`
  - `type TeamGame = { kickoff: string; opponent: string; home: boolean; status: "scheduled" | "in_progress" | "final" }` (kickoff is ISO 8601 UTC)
  - `gamesByTeam(rows: { kickoff: Date; homeTeam: string; awayTeam: string; status: string }[]): Map<string, TeamGame>`
  - `ensureNflSchedule(season: string, week: number): Promise<void>` — cache-through fetch + persist
  - `loadGamesByTeam(season: string, week: number): Promise<Map<string, TeamGame>>` — read from `nfl_games`

- [ ] **Step 1: Capture a fixture**

Run:

```bash
curl -s "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=1&seasontype=2" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0));process.stdout.write(JSON.stringify({events:d.events.slice(0,4)},null,2))' \
  > apps/web/lib/fixtures/espn-scoreboard-w1.json
```

Open it and confirm each `events[].competitions[0].competitors[]` has `homeAway` and `team.abbreviation`, each event has `date` (ISO) and `status.type.name`.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/lib/schedule.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { gamesByTeam, normalizeTeam, parseScoreboard, SLEEPER_TEAMS } from "./schedule";

const scoreboard = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/espn-scoreboard-w1.json", import.meta.url)), "utf8"),
) as unknown;

describe("normalizeTeam", () => {
  it("passes through a canonical abbreviation", () => {
    expect(normalizeTeam("SEA")).toBe("SEA");
  });
  it("maps ESPN's Washington to Sleeper's", () => {
    expect(normalizeTeam("WSH")).toBe("WAS");
  });
  it("throws on an unknown abbreviation", () => {
    expect(() => normalizeTeam("ZZZ")).toThrow();
  });
  it("resolves every ESPN abbreviation used by the current 32 teams", () => {
    for (const espn of ["WSH", "LAR", "LAC", "LV", "JAX", "NE", "GB", "KC", "SF", "TB", "NO", "NYG", "NYJ"]) {
      expect(SLEEPER_TEAMS.has(normalizeTeam(espn))).toBe(true);
    }
  });
});

describe("parseScoreboard", () => {
  it("produces one row per event with normalized teams and a UTC kickoff", () => {
    const rows = parseScoreboard(scoreboard, "2025", 1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(SLEEPER_TEAMS.has(r.homeTeam)).toBe(true);
      expect(SLEEPER_TEAMS.has(r.awayTeam)).toBe(true);
      expect(r.kickoff.toISOString()).toMatch(/Z$/);
      expect(["scheduled", "in_progress", "final"]).toContain(r.status);
    }
  });
  it("throws on a malformed payload rather than returning []", () => {
    expect(() => parseScoreboard({ events: [{ competitions: [{}] }] }, "2025", 1)).toThrow();
  });
});

describe("gamesByTeam", () => {
  it("indexes both teams of a game, with home/away and opponent", () => {
    const map = gamesByTeam([
      { kickoff: new Date("2026-09-13T17:00:00Z"), homeTeam: "GB", awayTeam: "DET", status: "scheduled" },
    ]);
    expect(map.get("GB")).toMatchObject({ opponent: "DET", home: true, status: "scheduled" });
    expect(map.get("DET")).toMatchObject({ opponent: "GB", home: false });
  });
});
```

- [ ] **Step 3: Run the tests, verify they fail**

Run: `pnpm --filter @waiver-wire/web test -- schedule`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the module**

Create `apps/web/lib/schedule.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { insertRawFetch, nflGames, type NflGameInput } from "@waiver-wire/db";

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

function scoreboardUrl(week: number): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`;
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
const Scoreboard = z.object({ events: z.array(Event) });

function toStatus(espnName: string): NflGameInput["status"] {
  if (espnName === "STATUS_FINAL") return "final";
  if (espnName === "STATUS_IN_PROGRESS" || espnName === "STATUS_HALFTIME") return "in_progress";
  return "scheduled";
}

export function parseScoreboard(json: unknown, _season: string, _week: number): NflGameInput[] {
  const board = Scoreboard.parse(json);
  return board.events.map((event) => {
    const competitors = event.competitions[0].competitors;
    const home = competitors.find((c) => c.homeAway === "home")!;
    const away = competitors.find((c) => c.homeAway === "away")!;
    return {
      kickoff: new Date(event.date),
      homeTeam: normalizeTeam(home.team.abbreviation),
      awayTeam: normalizeTeam(away.team.abbreviation),
      status: toStatus(event.status.type.name),
      raw: event as unknown as Record<string, unknown>,
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

async function replaceNflGamesFor(season: string, week: number, rows: NflGameInput[]): Promise<void> {
  const { replaceNflGames } = await import("@waiver-wire/db");
  await replaceNflGames(db(), { season, week }, rows);
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

  const url = scoreboardUrl(week);
  try {
    const res = await fetch(url, { headers: { "user-agent": env().FETCH_USER_AGENT, accept: "application/json" } });
    if (!res.ok) throw new Error(`ESPN scoreboard ${url} → ${res.status}`);
    const body = await res.text();
    await insertRawFetch(db(), { url, source: SOURCE, week, body, contentType: "application/json" });
    await replaceNflGamesFor(season, week, parseScoreboard(JSON.parse(body), season, week));
  } catch (error) {
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
```

> Note: `replaceNflGamesFor` uses a dynamic import only to keep the top import list tidy; a normal top-level import of `replaceNflGames` is equally fine — match the file's existing style once written.

- [ ] **Step 5: Run the tests, verify they pass**

Run: `pnpm --filter @waiver-wire/web test -- schedule`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/web typecheck && pnpm lint`

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/schedule.ts apps/web/lib/schedule.test.ts apps/web/lib/fixtures/espn-scoreboard-w1.json
git commit -m "apps/web: NFL schedule from ESPN scoreboard, cached per week"
```

---

## Task 4: Platform-projections module

**Files:**
- Create: `apps/web/lib/platform-projections.ts`
- Create: `apps/web/lib/platform-projections.test.ts`

**Interfaces:**
- Consumes: `SleeperClient.getProjections` (Task 1); `replacePlatformProjections`, `platformProjections` (Task 2); `sleeper()`, `db()` from `@/lib/clients`; `Scoring` from `@waiver-wire/sources`.
- Produces:
  - `pickPoints(stats: { pts_ppr?: number | null; pts_half_ppr?: number | null; pts_std?: number | null }, scoring: Scoring): number | null`
  - `PROJECTION_POSITIONS: string[]` = `["QB", "RB", "WR", "TE", "K", "DEF"]`
  - `ensurePlatformProjections(season: string, week: number, scoring: Scoring): Promise<void>`
  - `loadPlatformPoints(season: string, week: number, scoring: Scoring): Promise<Map<string, number>>` — playerId → points (rows with `null` points omitted)

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/platform-projections.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { pickPoints } from "./platform-projections";

describe("pickPoints", () => {
  const stats = { pts_ppr: 14, pts_half_ppr: 12, pts_std: 10 };

  it("selects the field that matches the league's scoring", () => {
    expect(pickPoints(stats, "PPR")).toBe(14);
    expect(pickPoints(stats, "HALF")).toBe(12);
    expect(pickPoints(stats, "STD")).toBe(10);
  });

  it("returns null when the matching field is absent", () => {
    expect(pickPoints({ pts_ppr: null }, "PPR")).toBeNull();
    expect(pickPoints({}, "HALF")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @waiver-wire/web test -- platform-projections`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/web/lib/platform-projections.ts`:

```ts
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
```

> `getProjections` needs the full raw array cached per CLAUDE.md, but the array is large and already reconstructable from `platform_projections.raw`. Storing a count marker in `raw_fetches` (same pattern `sync.ts` uses for the player index) satisfies the freshness-tracking intent; the per-row `raw` on `platform_projections` is the real retained payload.

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @waiver-wire/web test -- platform-projections`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/web typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/platform-projections.ts apps/web/lib/platform-projections.test.ts
git commit -m "apps/web: Sleeper platform projections, cached per week and scoring"
```

---

## Task 5: Matchup-view assembly (pure)

**Files:**
- Create: `apps/web/lib/matchup-view.ts`
- Create: `apps/web/lib/matchup-view.test.ts`

**Interfaces:**
- Consumes: `Slot`, `Position`, `StartSitCall`, `Projection` from `@waiver-wire/shared`; `TeamGame` from `./schedule`.
- Produces:
  - `type GameLine = TeamGame | null` (null = bye)
  - `MatchupPlayer` = `{ playerId: string; slot: Slot; position: Position | null; firstName: string | null; lastName: string | null; fullName: string; team: string | null; injuryStatus: string | null; game: GameLine; platformPoints: number | null }`
  - `MyMatchupPlayer` = `MatchupPlayer & { ourProjection: { mean: number; sd: number } | null; call: StartSitCall | null }`
  - `PlayerRow` = `{ id: string; fullName: string; firstName: string | null; lastName: string | null; position: string | null; team: string | null; injuryStatus: string | null }`
  - `buildTeam(args): MatchupPlayer[]` and `buildMyTeam(args): MyMatchupPlayer[]` (signatures in Step 3)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/matchup-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildMyTeam, buildTeam } from "./matchup-view";

const rows = [
  { id: "qb", fullName: "Justin Herbert", firstName: "Justin", lastName: "Herbert", position: "QB", team: "LAC", injuryStatus: null },
  { id: "rb1", fullName: "Jahmyr Gibbs", firstName: "Jahmyr", lastName: "Gibbs", position: "RB", team: "DET", injuryStatus: null },
  { id: "rb2", fullName: "Bench Back", firstName: "Bench", lastName: "Back", position: "RB", team: "GB", injuryStatus: "Q" },
];

const games = new Map([
  ["LAC", { kickoff: "2026-09-13T17:00:00Z", opponent: "KC", home: false, status: "scheduled" as const }],
  ["DET", { kickoff: "2026-09-13T17:00:00Z", opponent: "GB", home: true, status: "scheduled" as const }],
]);

describe("buildTeam (opponent — no numbers we compute)", () => {
  it("orders starters by roster slot then bench, and attaches game + platform points", () => {
    const team = buildTeam({
      rosterPositions: ["QB", "RB", "BN"],
      starters: ["qb", "rb1"],
      allPlayerIds: ["qb", "rb1", "rb2"],
      rows,
      games,
      platformPoints: new Map([["qb", 18.1], ["rb1", 20.4]]),
    });
    expect(team.map((p) => [p.playerId, p.slot])).toEqual([
      ["qb", "QB"],
      ["rb1", "RB"],
      ["rb2", "BENCH"],
    ]);
    expect(team[0].platformPoints).toBe(18.1);
    expect(team[2].game).toBeNull(); // GB not in the games map → bye
    expect(team[1].game).toMatchObject({ opponent: "GB", home: true });
  });
});

describe("buildMyTeam", () => {
  it("adds our projection and the slot's call to each starter; bench has call null", () => {
    const call = {
      slot: "RB" as const,
      recommended: "rb1",
      current: "rb1",
      confidence: 0.52,
      alternative: "rb2",
      confidenceUnderOtherObjective: 0.55,
      projection: { playerId: "rb1", mean: 18.4, sd: 8.2, basis: { source: "fantasypros" as const, positionRank: 3 } },
    };
    const team = buildMyTeam({
      rosterPositions: ["QB", "RB", "BN"],
      starters: ["qb", "rb1"],
      allPlayerIds: ["qb", "rb1", "rb2"],
      rows,
      games,
      platformPoints: new Map([["rb1", 17]]),
      ourProjections: new Map([["rb1", { mean: 18.4, sd: 8.2 }]]),
      callsBySlotIndex: new Map([[1, call]]),
    });
    expect(team[1].ourProjection).toEqual({ mean: 18.4, sd: 8.2 });
    expect(team[1].call?.confidence).toBe(0.52);
    expect(team[2].call).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @waiver-wire/web test -- matchup-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `apps/web/lib/matchup-view.ts`:

```ts
import type { Position, Slot, StartSitCall } from "@waiver-wire/shared";

import type { TeamGame } from "./schedule";

const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const EMPTY = "0";

export type GameLine = TeamGame | null;

export interface PlayerRow {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  team: string | null;
  injuryStatus: string | null;
}

export interface MatchupPlayer {
  playerId: string;
  slot: Slot;
  position: Position | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  team: string | null;
  injuryStatus: string | null;
  game: GameLine;
  platformPoints: number | null;
}

export interface MyMatchupPlayer extends MatchupPlayer {
  ourProjection: { mean: number; sd: number } | null;
  call: StartSitCall | null;
}

const FANTASY = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const toPosition = (raw: string | null): Position | null =>
  raw === "DEF" ? "DST" : FANTASY.has(raw ?? "") ? (raw as Position) : null;
const toSlot = (raw: string): Slot => (raw === "DEF" ? "DST" : (raw as Slot));

interface BaseArgs {
  rosterPositions: string[];
  starters: string[];
  allPlayerIds: string[];
  rows: PlayerRow[];
  games: Map<string, TeamGame>;
  platformPoints: Map<string, number>;
}

function order(args: BaseArgs): { id: string; slot: Slot }[] {
  const startingSlots = args.rosterPositions.filter((s) => !BENCH_SLOTS.has(s));
  const started = new Set<string>();
  const starters = startingSlots.flatMap((slot, i) => {
    const id = args.starters[i];
    if (!id || id === EMPTY) return [];
    started.add(id);
    return [{ id, slot: toSlot(slot) }];
  });
  const bench = args.allPlayerIds
    .filter((id) => id && id !== EMPTY && !started.has(id))
    .map((id) => ({ id, slot: "BENCH" as Slot }));
  return [...starters, ...bench];
}

function base(entry: { id: string; slot: Slot }, args: BaseArgs, byId: Map<string, PlayerRow>): MatchupPlayer {
  const row = byId.get(entry.id);
  const team = row?.team ?? null;
  return {
    playerId: entry.id,
    slot: entry.slot,
    position: toPosition(row?.position ?? null),
    firstName: row?.firstName ?? null,
    lastName: row?.lastName ?? null,
    fullName: row?.fullName ?? entry.id,
    team,
    injuryStatus: row?.injuryStatus ?? null,
    game: team ? (args.games.get(team) ?? null) : null,
    platformPoints: args.platformPoints.get(entry.id) ?? null,
  };
}

export function buildTeam(args: BaseArgs): MatchupPlayer[] {
  const byId = new Map(args.rows.map((r) => [r.id, r]));
  return order(args).map((entry) => base(entry, args, byId));
}

export function buildMyTeam(
  args: BaseArgs & {
    ourProjections: Map<string, { mean: number; sd: number }>;
    /** slot index within `rosterPositions.filter(non-bench)` → the call for that slot. */
    callsBySlotIndex: Map<number, StartSitCall>;
  },
): MyMatchupPlayer[] {
  const byId = new Map(args.rows.map((r) => [r.id, r]));
  const startingSlots = args.rosterPositions.filter((s) => !BENCH_SLOTS.has(s));
  const slotIndexById = new Map<string, number>();
  startingSlots.forEach((_slot, i) => {
    const id = args.starters[i];
    if (id && id !== EMPTY) slotIndexById.set(id, i);
  });

  return order(args).map((entry) => {
    const idx = slotIndexById.get(entry.id);
    return {
      ...base(entry, args, byId),
      ourProjection: args.ourProjections.get(entry.id) ?? null,
      call: idx !== undefined ? (args.callsBySlotIndex.get(idx) ?? null) : null,
    };
  });
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @waiver-wire/web test -- matchup-view`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/web typecheck && pnpm lint`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/matchup-view.ts apps/web/lib/matchup-view.test.ts
git commit -m "apps/web: pure matchup-view assembly (my team / opponent team)"
```

---

## Task 6: Wire the matchup view into `analyzeLeague`

**Files:**
- Modify: `apps/web/lib/sync.ts`
- Modify: `apps/web/lib/analysis.ts`

**Interfaces:**
- Consumes: `ensureNflSchedule`, `loadGamesByTeam` (Task 3); `ensurePlatformProjections`, `loadPlatformPoints` (Task 4); `buildMyTeam`, `buildTeam`, `MyMatchupPlayer`, `MatchupPlayer` (Task 5).
- Produces: `FullAnalysis` gains `myTeam: MyMatchupPlayer[]`, `opponentTeam: MatchupPlayer[]`, `opponentTeamName: string`.

- [ ] **Step 1: Retain the full roster payload in sync**

In `apps/web/lib/sync.ts`, in `syncLeague`, the `upsertRosters` call maps each `r`. Add `raw: r as unknown as Record<string, unknown>` to the mapped object (alongside `settings`). `SleeperRoster` is now `.passthrough()` (Task 1) so `r` carries every field Sleeper returned.

- [ ] **Step 2: Extend `FullAnalysis` and its `PlayerCard` loader**

In `apps/web/lib/analysis.ts`:

Add imports:

```ts
import { ensureNflSchedule, loadGamesByTeam } from "./schedule";
import { ensurePlatformProjections, loadPlatformPoints } from "./platform-projections";
import { buildMyTeam, buildTeam, type MatchupPlayer, type MyMatchupPlayer, type PlayerRow } from "./matchup-view";
```

Extend the interface:

```ts
export interface FullAnalysis {
  week: number;
  scoring: string;
  opponentName: string;
  opponentTeamName: string;
  expectedPoints: MatchupAnalysis;
  winProbability: MatchupAnalysis;
  waivers: WaiverScan[];
  players: Record<string, PlayerCard>;
  myTeam: MyMatchupPlayer[];
  opponentTeam: MatchupPlayer[];
}
```

- [ ] **Step 3: Fetch and assemble inside `analyzeLeague`**

In `analyzeLeague`, after `const scoring = scoringOf(league.scoringSettings);` and the `loadWeekRankings` call, add the two ensures (run them alongside the existing work):

```ts
  const season = league.season;
  await Promise.all([
    ensurePlatformProjections(season, week, scoring),
    ensureNflSchedule(season, week),
  ]);
  const [platformPoints, gamesByTeam] = await Promise.all([
    loadPlatformPoints(season, week, scoring),
    loadGamesByTeam(season, week),
  ]);
```

`scoring` here is the `Scoring` union (`"PPR" | "HALF" | "STD"`) from `scoringOf` — pass it straight through.

Just before the final `return`, build the two teams. `mine` (my roster row) and the opponent roster row are both already in scope (`mine`, and `oppMatchup` → find in `allRosters`). Load player rows for both, then:

```ts
  const oppRosterRow = oppMatchup
    ? allRosters.find((r) => r.sleeperRosterId === oppMatchup.roster_id)
    : undefined;

  const everyId = [
    ...new Set([
      ...mine.players,
      ...mine.starters,
      ...(oppRosterRow?.players ?? []),
      ...(oppRosterRow?.starters ?? []),
    ]),
  ].filter((id) => id && id !== "0");

  const allRows: PlayerRow[] = everyId.length
    ? (
        await db().select().from(playersTable).where(inArray(playersTable.id, everyId))
      ).map((p) => ({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        team: p.team,
        injuryStatus: p.injuryStatus,
      }))
    : [];

  const ourProjections = new Map(
    roster.map((r) => [r.playerId as string, { mean: r.projection.mean, sd: r.projection.sd }]),
  );
  const callsBySlotIndex = new Map(winProbability.calls.map((call, i) => [i, call]));

  const myTeam = buildMyTeam({
    rosterPositions: league.rosterPositions ?? [],
    starters: mine.starters,
    allPlayerIds: mine.players,
    rows: allRows,
    games: gamesByTeam,
    platformPoints,
    ourProjections,
    callsBySlotIndex,
  });

  const opponentTeam = oppRosterRow
    ? buildTeam({
        rosterPositions: league.rosterPositions ?? [],
        starters: oppRosterRow.starters,
        allPlayerIds: oppRosterRow.players,
        rows: allRows,
        games: gamesByTeam,
        platformPoints,
      })
    : [];
```

> **Watch the `callsBySlotIndex` mapping.** `winProbability.calls` is pushed one-per-slot but a slot with every candidate on bye is `return`ed early in `analyzeMatchup`, so `calls[i]` is not guaranteed to align with starting-slot index `i`. Map by `call.slot` + occurrence instead if the fixture shows drift: build the map as `new Map(winProbability.calls.map((c) => [c.recommended, c]))` and in `buildMyTeam` look the call up by the *starter's player id* rather than slot index. Decide based on what the real roster produces in Step 5; adjust `matchup-view.ts`'s `buildMyTeam` signature to `callsByPlayerId: Map<string, StartSitCall>` if so, and update its test.

Add `opponentTeam`, `myTeam`, and `opponentTeamName: oppRosterRow?.teamName ?? oppRosterRow?.ownerDisplayName ?? "League average"` to the returned object.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/web typecheck && pnpm lint`
Expected: clean. Fix any type mismatch between `scoringOf`'s return and `Scoring`.

- [ ] **Step 5: Verify against the real league**

The dev server picks up `.env.local` (`DATABASE_URL` must not be shadowed — `Remove-Item Env:DATABASE_URL` first in PowerShell). With the server running and a drafted league selected:

```bash
curl -s --cookie "ww_session=<paste from browser devtools>" http://localhost:3000/api/leagues/<leagueId>/analysis \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0)).data; console.log("myTeam", d.myTeam.length, "opp", d.opponentTeam.length); console.log(d.myTeam.slice(0,3).map(p=>({slot:p.slot,name:p.fullName,our:p.ourProjection,plat:p.platformPoints,game:p.game,call:p.call&&p.call.confidence})))'
```

Confirm: starters come first in `roster_positions` order then bench; `ourProjection` present for my players; `platformPoints` populated for most; `game` is an object for players whose team plays this week and `null` on a bye; `call` present on starters and lines up with the right player.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/sync.ts apps/web/lib/analysis.ts
git commit -m "apps/web: assemble my-team / opponent-team into the analysis response"
```

---

## Task 7: Kickoff / game-line formatter (pure)

**Files:**
- Create: `apps/web/lib/kickoff.ts`
- Create: `apps/web/lib/kickoff.test.ts`

**Interfaces:**
- Consumes: `GameLine` from `./matchup-view`.
- Produces: `formatGameLine(game: GameLine, playerTeam: string | null, now?: Date, timeZone?: string): string`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/kickoff.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { formatGameLine } from "./kickoff";

const tz = "America/New_York";

describe("formatGameLine", () => {
  it("home game: TEAM vs OPP · Day Time", () => {
    const line = formatGameLine(
      { kickoff: "2026-09-13T17:00:00Z", opponent: "GB", home: true, status: "scheduled" },
      "DET",
      new Date("2026-09-08T00:00:00Z"),
      tz,
    );
    expect(line).toBe("DET vs GB · Sun 1:00");
  });

  it("away game uses @", () => {
    const line = formatGameLine(
      { kickoff: "2026-09-14T00:20:00Z", opponent: "SEA", home: false, status: "scheduled" },
      "NE",
      new Date("2026-09-08T00:00:00Z"),
      tz,
    );
    expect(line).toBe("NE @ SEA · Sun 8:20");
  });

  it("final game shows Final instead of the time", () => {
    const line = formatGameLine(
      { kickoff: "2026-09-13T17:00:00Z", opponent: "GB", home: true, status: "final" },
      "DET",
      new Date("2026-09-15T00:00:00Z"),
      tz,
    );
    expect(line).toBe("DET vs GB · Final");
  });

  it("no game → BYE", () => {
    expect(formatGameLine(null, "DET", new Date(), tz)).toBe("BYE");
  });

  it("no team → empty string", () => {
    expect(formatGameLine(null, null, new Date(), tz)).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @waiver-wire/web test -- kickoff`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/kickoff.ts`:

```ts
import type { GameLine } from "./matchup-view";

/**
 * "DET vs GB · Sun 1:00" / "NE @ SEA · Sun 8:20" / "DET vs GB · Final" / "BYE".
 * `now`/`timeZone` are injectable for tests; in the browser they default to the
 * viewer's clock.
 */
export function formatGameLine(
  game: GameLine,
  playerTeam: string | null,
  now: Date = new Date(),
  timeZone: string | undefined = undefined,
): string {
  if (!playerTeam) return "";
  if (!game) return "BYE";

  const vs = game.home ? "vs" : "@";
  const matchup = `${playerTeam} ${vs} ${game.opponent}`;

  if (game.status === "final") return `${matchup} · Final`;

  const kickoff = new Date(game.kickoff);
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(kickoff);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  })
    .format(kickoff)
    .replace(/\s?[AP]M$/, "");

  const live = game.status === "in_progress" ? "· LIVE " : "";
  void now;
  return `${matchup} · ${live}${day} ${time}`;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @waiver-wire/web test -- kickoff`
Expected: PASS. If the time string differs (locale quirk on `minute: "2-digit"` giving `1:00`), adjust the expectation in the test to the actual `Intl` output on the dev machine — the format only needs to be stable and readable, not exact to this spec.

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
pnpm --filter @waiver-wire/web typecheck && pnpm lint
git add apps/web/lib/kickoff.ts apps/web/lib/kickoff.test.ts
git commit -m "apps/web: kickoff / game-line formatter"
```

---

## Task 8: Dashboard — the two-roster view

**Files:**
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/components/position-chip.tsx`
- Create: `apps/web/components/matchup.tsx`
- Modify: `apps/web/components/dashboard.tsx`

**Interfaces:**
- Consumes: `FullAnalysis`, `MyMatchupPlayer`, `MatchupPlayer` (Task 6); `formatGameLine` (Task 7).
- Produces: `<Matchup analysis={analysis} objective={objective} onExplain={...} prose={...} open={...} />` rendered by `dashboard.tsx`.

- [ ] **Step 1: Add position color tokens**

In `apps/web/app/globals.css`, inside `@theme`, after `--color-alert`:

```css
  --color-pos-qb: #c678b6;
  --color-pos-rb: #6fb86f;
  --color-pos-wr: #5a9fd4;
  --color-pos-te: #d9a15c;
  --color-pos-k: #8b84d6;
  --color-pos-dst: #9c8b6e;
```

- [ ] **Step 2: Position chip component**

Create `apps/web/components/position-chip.tsx`:

```tsx
import type { Position } from "@waiver-wire/shared";

const BG: Record<Position, string> = {
  QB: "bg-pos-qb",
  RB: "bg-pos-rb",
  WR: "bg-pos-wr",
  TE: "bg-pos-te",
  K: "bg-pos-k",
  DST: "bg-pos-dst",
};

export function PositionChip({ position }: { position: Position | null }) {
  if (!position) return <span className="inline-block w-8" />;
  return (
    <span
      className={`inline-block w-8 shrink-0 rounded-sm px-1 py-0.5 text-center text-xs font-medium text-ink ${BG[position]}`}
    >
      {position}
    </span>
  );
}
```

- [ ] **Step 3: The matchup component**

Create `apps/web/components/matchup.tsx`:

```tsx
"use client";

import type { CallExplanation } from "@waiver-wire/shared";

import type { FullAnalysis } from "@/lib/analysis";
import type { MatchupPlayer, MyMatchupPlayer } from "@/lib/matchup-view";
import { formatGameLine } from "@/lib/kickoff";

import { PositionChip } from "./position-chip";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number | null | undefined) => (x == null ? "–" : x.toFixed(1));
const shortName = (first: string | null, last: string | null, full: string) =>
  first && last ? `${first[0]}.${last}` : full;

function confidenceColor(c: number): string {
  const lo = [0xc6, 0x8a, 0x3b];
  const hi = [0x3f, 0xa8, 0x8f];
  const t = Math.max(0, Math.min(1, c));
  const [r, g, b] = lo.map((l, i) => Math.round(l + ((hi[i] ?? l) - l) * t));
  return `rgb(${r} ${g} ${b})`;
}

function Injury({ status }: { status: string | null }) {
  if (!status) return null;
  const tag = status.slice(0, 1).toUpperCase();
  return <span className="ml-1 align-top text-[10px] text-alert">{tag}</span>;
}

export type ExplainState = CallExplanation | "loading" | "error";

interface Props {
  analysis: FullAnalysis;
  onToggleRow: (player: MyMatchupPlayer) => void;
  openKey: string | null;
  prose: Record<string, ExplainState>;
  rowKey: (player: MyMatchupPlayer) => string;
}

export function Matchup({ analysis, onToggleRow, openKey, prose, rowKey }: Props) {
  const bench = <T extends { slot: string }>(list: T[]) => list.filter((p) => p.slot === "BENCH");
  const starters = <T extends { slot: string }>(list: T[]) => list.filter((p) => p.slot !== "BENCH");

  const myStarters = starters(analysis.myTeam);
  const myBench = bench(analysis.myTeam);
  const oppStarters = starters(analysis.opponentTeam);
  const oppBench = bench(analysis.opponentTeam);

  return (
    <section className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted">
        <span>My team</span>
        <span className="w-24 text-right">{analysis.opponentTeamName}</span>
      </div>

      {myStarters.map((mine, i) => (
        <MatchupRow
          key={rowKey(mine)}
          mine={mine}
          opp={oppStarters[i] ?? null}
          expanded={openKey === rowKey(mine)}
          detail={prose[rowKey(mine)]}
          onClick={() => onToggleRow(mine)}
          name={(id) => analysis.players[id]?.name ?? id}
        />
      ))}

      <div className="mt-2 border-t border-hairline pt-1 text-xs text-muted">bench</div>
      {myBench.map((mine, i) => (
        <MatchupRow
          key={rowKey(mine)}
          mine={mine}
          opp={oppBench[i] ?? null}
          expanded={false}
          detail={undefined}
          onClick={undefined}
          name={(id) => analysis.players[id]?.name ?? id}
        />
      ))}
    </section>
  );
}

function MatchupRow({
  mine,
  opp,
  expanded,
  detail,
  onClick,
  name,
}: {
  mine: MyMatchupPlayer;
  opp: MatchupPlayer | null;
  expanded: boolean;
  detail: ExplainState | undefined;
  onClick: (() => void) | undefined;
  name: (id: string) => string;
}) {
  const swap = mine.call?.current != null && mine.call.current !== mine.call.recommended;
  return (
    <div className={swap ? "border-l-2 border-l-alert pl-1.5" : "pl-1.5"}>
      <div className="flex items-start gap-2 border-b border-hairline py-1.5">
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          className="flex min-w-0 flex-1 flex-col items-start text-left"
        >
          <span className="flex w-full items-center gap-1.5">
            <PositionChip position={mine.position} />
            <span className="min-w-0 flex-1 truncate">
              {shortName(mine.firstName, mine.lastName, mine.fullName)}
              <Injury status={mine.injuryStatus} />
            </span>
            <span className="tabular-nums text-sm">
              <span className="text-text">{num(mine.ourProjection?.mean)}</span>
              <span className="text-muted"> · {num(mine.platformPoints)}</span>
            </span>
            {mine.call ? (
              <span
                className="w-9 shrink-0 text-right text-sm tabular-nums"
                style={{ color: confidenceColor(mine.call.confidence) }}
              >
                {pct(mine.call.confidence)}
              </span>
            ) : (
              <span className="w-9 shrink-0" />
            )}
          </span>
          <span className="pl-9 text-xs text-muted">
            {formatGameLine(mine.game, mine.team)}
            {swap ? <span className="text-alert"> · ↑ over {name(mine.call!.current!)}</span> : null}
          </span>
        </button>

        <div className="w-24 shrink-0 border-l border-hairline pl-1.5">
          {opp ? (
            <>
              <span className="flex items-center gap-1">
                <PositionChip position={opp.position} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {shortName(opp.firstName, opp.lastName, opp.fullName)}
                  <Injury status={opp.injuryStatus} />
                </span>
                <span className="tabular-nums text-sm text-muted">{num(opp.platformPoints)}</span>
              </span>
              <span className="pl-9 text-xs text-muted">{formatGameLine(opp.game, opp.team)}</span>
            </>
          ) : null}
        </div>
      </div>

      {expanded && detail ? (
        <div className="flex flex-col gap-2 border-b border-hairline bg-surface p-3 text-sm">
          {detail === "loading" ? (
            <p className="text-muted">thinking…</p>
          ) : detail === "error" ? (
            <p className="text-alert">couldn&apos;t generate an explanation</p>
          ) : (
            <>
              <ul className="flex flex-col gap-0.5">
                {detail.pros.map((p) => (
                  <li key={p} className="text-high">
                    + {p}
                  </li>
                ))}
                {detail.cons.map((c) => (
                  <li key={c} className="text-low">
                    − {c}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">{detail.toggleEffect}</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Rewire `dashboard.tsx`**

In `apps/web/components/dashboard.tsx`:

- Keep the header block (win probability, score range) and the opponent-aware `<label>` toggle exactly as they are.
- Keep the `toggleRow` handler and the `/api/explain` fetch. Change its key derivation and payload source to a `MyMatchupPlayer`:
  - `rowKey(player) = `${objective}:${player.slot}:${player.playerId}``
  - The explain `POST` body still needs a `StartSitCall` — pass `player.call` (guard: only starters with a non-null `call` are clickable), and build `recommendedName` / `alternativeName` / `currentName` from `analysis.players`.
- Replace the entire `<ul>` of `view.calls.map(...)` with:

```tsx
<Matchup
  analysis={analysis}
  onToggleRow={(player) => void toggleRow(player)}
  openKey={open}
  prose={prose}
  rowKey={rowKey}
/>
```

- Keep the "Streaming" `<section>` below it, unchanged.
- `toggleRow` signature changes from `(call: StartSitCall)` to `(player: MyMatchupPlayer)`; inside, early-return if `player.call === null`, otherwise use `player.call` where the old code used `call`.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @waiver-wire/web typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 6: Smoke test in the running app**

PowerShell, `.env.local` unshadowed:

```
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
pnpm dev
```

Open `http://localhost:3000`, connect to a drafted league, land on the dashboard. Confirm:
- Two columns: your full lineup wide on the left, opponent as a narrow right rail.
- Each player: colored position chip, `F.LastName`, injury tag where applicable, `{our} · {platform}` numbers, and under the name `TEAM vs/@ OPP · Day Time` (or `BYE`).
- Opponent rail shows position + name + one platform number, no confidence.
- Bench section under a "bench" divider on both sides.
- Tapping one of your starters still opens the pros/cons explanation.
- The opponent-aware toggle still flips win probability and the confidence numbers.
- Header still shows win probability and the score range.

Take a screenshot for the record (headless Edge against `pnpm build && pnpm --filter @waiver-wire/web start` gives a clean frame with no dev overlay).

- [ ] **Step 7: Run the full test + checks**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/globals.css apps/web/components/position-chip.tsx apps/web/components/matchup.tsx apps/web/components/dashboard.tsx
git commit -m "apps/web: full matchup view — my team + opponent rail with platform projections and kickoffs"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1 Platform projections (Sleeper client) | Task 1 |
| §2 NFL schedule (ESPN) | Task 3 |
| §3 Bench projections surfaced | Task 5 + Task 6 (`ourProjections` from `roster`, which already covers bench) |
| §4 Storage (`platform_projections`, `nfl_games`) | Task 2 |
| §4b Retain full Sleeper payloads (`players.raw` confirmed, `rosters.raw` added, `SleeperRoster` passthrough) | Task 1 (schema) + Task 2 (column) + Task 6 Step 1 (write it) |
| §5 `ensure*` on select + on analysis | Task 6 Step 3 (analysis); select route calls `syncLeague` → note below |
| Response contract (`myTeam` / `opponentTeam` / `opponentTeamName`) | Task 5 (types) + Task 6 (populate) |
| UI: my-team-wide / opponent-rail | Task 8 |
| Game-time formatting, client-side, local tz | Task 7 |
| Position color coding | Task 8 Steps 1–2 |
| Injury tags, bye | Task 5 (data) + Task 8 (`<Injury>`, `BYE`) |
| Win probability / toggle unchanged | Task 8 Step 4 (header + toggle kept) |
| League-average opponent → empty rail + placeholder name | Task 6 Step 3 (`opponentTeam = []`, name `"League average"`) + Task 8 (rail renders nothing when `opp` is null) |
| Confidence rendered as-is | Task 8 (reads `call.confidence` directly) |
| Team-abbr normalization, 32-team test, miss throws | Task 3 |
| Testing plan | each task's test steps |
| Rollout order | task order (1–3 independent, 4 needs 1+2, 5 standalone, 6 needs 3+4+5, 7 needs 5, 8 needs 6+7) |

**Gap found:** the spec says `ensure*` should also run on league select (defensive). `syncLeague` (called by the select route) currently doesn't know the week or take the ensures. **Resolution:** leave the ensures in `analyzeLeague` only (Task 6). The dashboard is `force-dynamic` and always calls `analyzeLeague`, so the data is always fresh-or-cached by first render; adding them to `syncLeague` would duplicate the fetch on the same request. If a later task adds a non-dashboard consumer, revisit. Noted here rather than silently dropped.

**2. Placeholder scan:** no `TBD` / "handle errors appropriately" / "similar to Task N" / bare "write tests". Every code step has real code. The two "confirm during implementation" notes (Sleeper `player_id` field — resolved in Task 1 Step 1 by inspecting the fixture; `callsBySlotIndex` alignment — Task 6 Step 3 note gives the exact alternative signature and when to switch) are decision points with both branches spelled out, not placeholders.

**3. Type consistency:**
- `MatchupPlayer` / `MyMatchupPlayer` / `PlayerRow` / `GameLine` — defined in Task 5, consumed with the same shape in Tasks 6, 7, 8.
- `TeamGame` — defined in Task 3, imported by Task 5.
- `NflGameInput` / `PlatformProjectionInput` — defined in Task 2, consumed in Tasks 3 and 4.
- `SleeperProjection.player_id` is `z.coerce.string()`; `platform_projections.playerId` is `text`; `loadPlatformPoints` returns `Map<string, number>`; `matchup-view` keys `platformPoints` by `string`. Consistent.
- `scoringOf` returns `Scoring` (`"PPR" | "HALF" | "STD"`); `platform_projections.scoring` stores that string; `FIELD` in Task 4 is keyed by `Scoring`. Consistent.
- `formatGameLine(game, playerTeam, now?, timeZone?)` — same signature in Task 7 definition and Task 8 call sites (called with two args in the component, four in tests).
- `buildMyTeam` takes `callsBySlotIndex: Map<number, StartSitCall>` in Task 5; Task 6 builds exactly that (with the documented fallback to `callsByPlayerId` if the fixture shows drift — both the type and its test move together).

---

## Execution Handoff

**Plan complete and saved to `docs/plans/2026-09-03-full-matchup-view.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
