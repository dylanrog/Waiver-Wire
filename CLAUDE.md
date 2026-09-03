# Waiver-Wire — agent conventions

Read this before writing any code. If something here conflicts with your instinct, this file wins.
If this file is wrong, say so in your summary rather than silently working around it.

## What this is

A fantasy football decision tool for a single Sleeper league. It answers two questions
every week:

1. **Should I start this player?** — with a confidence score and a plain-language reason.
2. **Who should I pick up?** — top available players at a position, ranked against an
   external source.

The product's real subject is **uncertainty**. Every number it shows is a distribution,
not a fact. Design and copy should reflect that.

## Stack — do not substitute

| Layer | Choice |
|---|---|
| Framework | Next.js (App Router), TypeScript strict |
| Runtime | Node 22 |
| Package manager | pnpm workspaces |
| Styling | Tailwind + shadcn/ui |
| Charts | Recharts |
| DB | Supabase Postgres via Drizzle ORM |
| Validation | Zod |
| LLM | Vercel AI SDK (`ai` package) targeting Claude |
| HTML parsing | cheerio (add Playwright only if a page proves JS-rendered) |
| Tests | Vitest |
| Deploy | Vercel |

Do not add a dependency that duplicates something above. Do not add a state management
library — server components plus URL state cover the MVP. Do not add an HTTP client;
`fetch` is fine.

## Package boundaries

```
apps/web              Next.js app. UI + route handlers only.
packages/shared       Types and Zod schemas. Depends on nothing.
packages/sleeper      Sleeper API client. Depends on shared.
packages/sources      Ranking source adapters. Depends on shared.
packages/projections  Rank→distribution, Monte Carlo, lineup solver. Depends on shared.
packages/db           Drizzle schema + queries. Depends on shared.
```

Dependencies point **inward toward `shared`** and never sideways. `sources` must not
import from `sleeper`. `projections` must not import from `db`. If you need something
from a sibling package, the calling code in `apps/web` wires them together.

This matters more than usual here: packages are worked on by separate agents in separate
worktrees, and a sideways import is a merge conflict waiting to happen.

## Hard rules

**Everything crossing a boundary gets a Zod schema.** Scraped HTML, Sleeper responses,
LLM output, route handler input. Parse, don't assume. A source that changes its markup
should fail loudly at the parse step, not produce silent garbage three layers down.

**The LLM never touches the math.** In the MVP it has exactly one job: turning an
already-computed recommendation into prose. (The `RankingSource` interface also allows
an LLM extraction step for article-based sources; FantasyPros, the first source, needs
none — it ships structured JSON.) Projections, simulations, confidence scores, and
lineup optimization are deterministic functions with unit tests. If you find yourself
asking a model to compare two numbers, stop.

**Cache every raw fetch.** Before parsing anything, write the raw payload to
`raw_fetches` with its URL, timestamp, and week. This is not optional and not a
later optimization — demo mode and backtesting are both impossible without the history,
and you cannot retroactively collect it.

**No secrets in code.** Read from `process.env`, validated once at startup through the
schema in `packages/shared/src/env.ts`.

**Sleeper is read-only in the MVP.** Never write to a fantasy platform. There is no
endpoint for it and no code path should imply otherwise.

**Be polite to sources.** One request per source per week, served from cache thereafter.
Set a real User-Agent. If a fetch fails, degrade to the cached copy and surface its age
in the UI rather than showing nothing.

## Definition of done

A task is not complete until all of these hold:

- `pnpm typecheck` passes with no `any` and no `@ts-expect-error` you added
- `pnpm test` passes; new logic in `projections` has tests covering the edge cases
- `pnpm lint` passes
- The feature works against a real Sleeper league ID, not a fixture only
- You wrote a two-sentence summary of what changed and what you were unsure about

Pure functions in `packages/projections` must have tests. UI does not need tests beyond
one smoke path. Do not write tests that only assert a mock was called.

## Design direction

The default output for a dashboard is a grid of identical rounded cards with a soft grey
shadow and a red-to-green confidence bar. Don't build that.

**Tokens**

```
--ink        #10151F   page
--surface    #1A212E   panels
--hairline   #2C3442   1px separators, used instead of shadows
--text       #E8ECF2
--muted      #8D98AB
--low        #C68A3B   low confidence  ┐ sequential ramp, interpolated
--high       #3FA88F   high confidence ┘ never red/green
--alert      #E86F51   only for "this needs a decision from you"
```

Confidence is on one continuous amber→teal ramp, not a two-color good/bad split. It is
sequential data and red/green fails for colorblind users and reads as a verdict when it
should read as a measurement.

**Type.** Archivo for headings and numbers, system sans for body. One weight jump, not
three. `font-variant-numeric: tabular-nums` on every number in the app — columns of
figures that shift width when they update look broken.

**Principles**

- A point estimate is a lie. Where you'd show `14.2`, show `9–19` with 14 marked. The
  range *is* the product.
- Structure encodes meaning. Separators are hairlines, not shadows. A player row gets a
  border only when it needs the user's attention.
- Phone first. This gets read on a couch at 12:55pm on a Sunday, one-handed, in daylight.
  Thumb-reachable controls, high contrast, no hover-dependent information.
- Motion only on state change — a lineup swap, a recomputed simulation. No scroll
  reveals, no entrance animations.

**Copy.** Say what happened and what to do. "Kept Higgins over Pittman — 68% to score
more" beats "Recommendation generated." Empty states say what to do next. Errors say
what broke and what still works.

## Anti-patterns

- Reaching for an LLM where a sort would do
- Point estimates presented without their range
- Swallowing a parse failure and returning `[]`
- Fetching a live URL in a unit test
- Adding a table to the DB schema without adding it to `packages/db/src/schema.ts`
- "Improving" a package you weren't asked to touch — it belongs to another agent right now
