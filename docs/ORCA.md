# Running this project in Orca

## The shape of it

You have five near-independent packages and one app. That's the parallelism. But
`packages/shared` blocks everything, so the run looks like a funnel: one session, then
four, then one.

```
 Wave 0   1 session    shared + repo skeleton        ← everything blocks on this
 Wave 1   4 sessions   db · sleeper · sources · rank_curves
 Wave 2   1 session    projections                   ← needs shared + rank_curves
 Wave 3   2-3 sessions apps/web (fan out the dashboard)
```

Three to four concurrent agents is the working ceiling for a solo dev on this codebase.
Not because Orca can't run more, but because you have to review everything they produce
and review is the actual bottleneck. Five agents finishing at once means four PRs going
stale while you read the first.

## Wave 0 — do this one yourself, or nearly

One session, and read every line of the output. `types.ts` is already written and sits at
the repo root; this session builds the skeleton around it.

> Set up a pnpm workspace monorepo per docs/ARCHITECTURE.md. Create apps/web (Next.js
> App Router, TypeScript strict, Tailwind, shadcn/ui initialized) and empty packages for
> shared, sleeper, sources, projections, db — each with package.json, tsconfig extending
> a shared base, and vitest configured. Move the existing root `types.ts` to
> packages/shared/src/types.ts unchanged — do not modify its contents. Add root scripts:
> dev, build, typecheck, test, lint. Add packages/shared/src/env.ts that validates
> process.env with Zod per .env.example. Verify `pnpm typecheck` and `pnpm test` both
> pass from a clean install, then stop.

Merge this to main before dispatching anything else. Every other worktree branches from
it.

## Wave 1 — four in parallel

These four touch disjoint directories, so they merge cleanly. Dispatch all at once.

**db**
> Implement packages/db: Drizzle schema against Supabase Postgres for leagues, rosters,
> players, source_rankings, raw_fetches, and analysis_runs. Follow the types in
> packages/shared/src/types.ts exactly — the DB is the same shape as the domain. Include
> a migration and a seed script. raw_fetches stores the body as text with url, source,
> week, fetched_at. Add query helpers for "latest raw fetch for (source, week)".

**sleeper**
> Implement packages/sleeper: a typed client for the endpoints listed in docs/MVP.md.
> Every response validated with Zod before returning. Include the name→PlayerId resolver
> described in docs/MVP.md section 2, with the three-tier fallback, returning
> UnresolvedName[] for misses. Unit tests against checked-in fixtures — no network in
> tests. The player index fetch must be separately callable so it can be cached daily.

**sources**
> Implement packages/sources: the RankingSource interface from shared, plus a
> FantasyPros implementation, per docs/MVP.md section 2 and docs/notes/ranking-sources.md.
> For each requested position, fetch the FantasyPros rankings page (scoring prefix from
> the league settings), write the raw body to the cache callback before parsing, then
> extract the embedded `ecrData` JSON and map each player to a Sleeper PlayerId.
> Deterministic — no LLM, no headless browser. Populate sourceExcerpt with each row's
> raw record. Export a registry so a second source can be added without touching
> callers. Tests run against the checked-in fixtures in tests/fixtures/fantasypros/ —
> no network.

**rank_curves** — this one is a script, not a package
> Write scripts/build-rank-curves.ts. Pull three seasons of nflverse weekly player data,
> compute weekly fantasy points under the scoring config in the file's constants, rank
> players within position per week, then emit mean and sd of points at each positional
> rank to packages/projections/data/rank_curves.json. Document the source URLs in a
> comment. This runs offline and is committed — it must not run at request time.

## Wave 2 — projections, alone

Don't parallelize this and don't fan it out. There's one correct answer and the way to
get it is tests, not variants.

> Implement packages/projections against the types in shared: rank→Projection using
> rank_curves.json, a seeded Monte Carlo producing Distribution and win probability, a
> lineup optimizer honoring FLEX eligibility, and StartSitCall confidence as defined in
> docs/ARCHITECTURE.md — including confidenceUnderOtherObjective, which means running the
> sim under both objectives. Pure functions, no I/O, no network. Tests must cover: a
> heavy underdog preferring the higher-variance player, a heavy favorite preferring the
> lower-variance one, identical players producing confidence near 0.5, and a bye-week
> player never being recommended.

That test list is the spec. If the agent's implementation passes those four, the modeling
is right.

## Wave 3 — the app, fanned out

This is where Orca's fan-out is worth using: dispatch the same dashboard prompt to two or
three agents, then compare complete worktrees and keep one whole. UI quality is
subjective and cheap to judge by looking.

> Build the dashboard in apps/web per docs/MVP.md section 5 and the design tokens in
> CLAUDE.md. Server components fetch analysis; the opponent-aware toggle is client state
> and must not refetch — both objectives are computed server-side in one pass. Every
> number renders as a range. Confidence uses the amber→teal ramp. Phone-first layout.
> Include the PWA manifest and a service worker for shell caching only.

Judge the variants on: does the win probability read at arm's length, is the toggle's
effect legible without tapping into a detail view, and does a low-confidence row
communicate "this doesn't matter much" rather than "we're confused."

Onboarding and the waiver scan UI are separate, smaller sessions afterward — no fan-out
needed.

## Practical notes

**The `.env` problem.** Worktrees don't carry gitignored files, so every new one starts
with no environment and the agent fails on the first DB call. `scripts/bootstrap.sh`
copies from your main checkout and installs. Wire it to Orca's setup hook so it runs on
worktree creation, or you'll debug the same missing-key error five times.

**One hosted dev database for all worktrees.** This is why Supabase over local Postgres.
Accept that agents share a dev DB — the alternative is per-worktree Docker, which costs
more than the occasional stepped-on row. If it becomes a real problem, switch to Neon and
branch per worktree.

**Point every session at the docs.** Start each prompt with "Read CLAUDE.md,
docs/ARCHITECTURE.md, and docs/MVP.md first." Agents that skip the conventions file
invent their own conventions, and you find out at merge time.

**Use the iOS simulator on wave 3.** It's the fastest available check that the phone
layout actually works, which is the thing most likely to be quietly wrong.

**Merge order within a wave is arbitrary but not free.** After each merge, rebase the
other in-flight worktrees — four agents branched from the same commit will each add their
package to the root `pnpm-workspace.yaml` and `tsconfig.json` references, and those are
your conflict points. It's the only file overlap in wave 1, which is by design.

**Review the modeling code line by line.** UI you can judge by looking at it. A
simulation that returns confident, plausible, wrong numbers looks exactly like one that
works. `packages/projections` is where you spend your review attention.

## First week, realistically

- Day 1: wave 0, and get a real Sleeper league ID flowing end to end even if it just
  prints JSON
- Day 2: wave 1, four agents, review in the evening
- Day 3: rank curves are usually the one that needs a second pass — nflverse column names
  move between seasons
- Day 4: projections plus its tests
- Day 5–6: dashboard fan-out and pick a winner
- Day 7: onboarding, waiver UI, deploy to Vercel, install it on your phone

Then use it for a week before adding anything. The features you actually want will not be
the ones on the post-MVP list.
