# Waiver-Wire

Weekly start/sit and waiver decisions for a Sleeper fantasy football league. Every
recommendation is a distribution with a confidence score, not a point estimate.

## What it does

- Connects to a Sleeper league by username — no account required
- Pulls the week's positional rankings from FantasyPros (expert consensus)
- Scans the waiver wire for upgrades at your weak positions
- Simulates your matchup 10,000 times and scores every start/sit decision
- Recalculates against your actual opponent when you flip the opponent-aware toggle,
  and explains what changed for each player
- Installable as a PWA for the couch on Sunday

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local                  # fill in Supabase + Anthropic keys (contract: packages/shared/src/env.ts)
pnpm --filter @waiver-wire/db db:migrate     # apply the schema to your Postgres
pnpm dev                                     # http://localhost:3000
```

Then open the app, enter a Sleeper username, and pick a league — the data is public,
so it doesn't have to be your own account.

The projection curves ship committed at `packages/projections/data/rank_curves.json`.
To rebuild them from nflverse (a season-boundary task, not part of normal setup):
`pnpm --filter @waiver-wire/scripts rank-curves`.

## Docs

| File | Read it when |
|---|---|
| `CLAUDE.md` | Before writing any code. Conventions, stack, design direction. |
| `docs/ARCHITECTURE.md` | Understanding data flow, or asking why a choice was made. |
| `docs/MVP.md` | Deciding whether something is in scope. It probably isn't. |
| `docs/ORCA.md` | Dispatching agents. Session plan and prompts. |
| `docs/archive/` | Superseded specs, kept for reference. Not current. |

## Layout

```
apps/web              Next.js app — UI and route handlers only
packages/shared       Types and Zod schemas. The contract. Depends on nothing.
packages/sleeper      Sleeper API client + name resolution
packages/sources      Ranking source adapters (FantasyPros first)
packages/projections  Rank→distribution, Monte Carlo, lineup solver
packages/db           Drizzle schema and queries
```

Dependencies point inward toward `shared` and never sideways — see `CLAUDE.md` for
the rule and the reasoning.

## Status

MVP feature-complete: connect flow, start/sit calls, waiver scan, opponent-aware
simulation, LLM explanations, and PWA install. Read-only against Sleeper — this app
never writes to your league.
