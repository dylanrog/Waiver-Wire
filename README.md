# Waiver-Wire

Weekly start/sit and waiver decisions for a Sleeper fantasy football league. Every
recommendation is a distribution with a confidence score, not a point estimate.

## What it does

- Connects to a Sleeper league by username — no account required
- Pulls the week's positional rankings from FantasyPros (expert consensus)
- Finds the best available waiver adds at the positions you choose
- Simulates your matchup 10,000 times and scores every start/sit decision
- Recalculates against your actual opponent when you flip the opponent-aware toggle,
  and explains what changed for each player

## Setup

> **Not scaffolded yet.** The repo currently holds the design docs and the
> `types.ts` contract only. The commands below are the target; the monorepo
> skeleton lands in the first build PR (see `docs/ORCA.md`, Wave 0).

```bash
corepack enable
pnpm install
cp .env.example .env.local   # fill in Supabase + Anthropic keys
pnpm db:push
pnpm rank-curves             # one-time, builds the projection curves from nflverse
pnpm dev
```

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

Dependencies point inward toward `shared` and never sideways. `types.ts` sits at the
repo root for now and moves to `packages/shared/src/types.ts` unchanged in Wave 0.

## Status

MVP in progress, pre-scaffold. Read-only against Sleeper — this app never writes to
your league.
