# Architecture

## Data flow

```
Sleeper API ─────────┐
                     ├──> raw_fetches (cached, timestamped) ──┐
FantasyPros rankings ┘                                        │
                                                          v
                                            packages/sources
                                            parse → SourceRanking[]
                                                          │
                                                          v
                                            packages/projections
                                     rank → (mean, sd) via rank_curves.json
                                                          │
                                     ┌────────────────────┴────────────────────┐
                                     v                                         v
                          Monte Carlo matchup                        waiver candidate scan
                          → win probability                          → top 5 available
                          → per-player confidence                              │
                                     │                                         │
                                     └────────────────┬────────────────────────┘
                                                      v
                                          apps/web dashboard
                                     (LLM writes the pro/con prose here,
                                      from numbers already computed)
```

## The projection problem

Expert-consensus rankings are ordinal. Monte Carlo needs distributions. Bridging them is
the one piece of real modeling in the MVP.

`packages/projections/data/rank_curves.json` maps positional rank to a mean and standard
deviation of weekly fantasy points, per position, in your league's scoring format:

```json
{ "WR": { "12": { "mean": 13.4, "sd": 7.1 }, "13": { "mean": 13.1, "sd": 7.0 } } }
```

Build it once, offline, from three past seasons of nflverse weekly data. For each
position, rank every player by that week's actual finish, then take the mean and sd of
points at each rank slot across all weeks. That gives you what "WR12 this week" has
historically been worth and, more importantly, how much it varies.

Two things fall out of this that the MVP needs:

**Variance is the whole opponent-aware feature.** Kicker sd is ~4; WR3 sd is ~9. When
you're a 20-point underdog, you want the high-sd player even though his mean is lower.
When you're favored, you want the opposite. Without per-player sd there is no toggle.

**Simulation is cheap.** 10,000 draws across 9 lineup slots is a few milliseconds of
JavaScript. There is no case for a separate Python service in the MVP. Python arrives
later, for the backtesting harness, where pandas and nflverse actually earn it.

Treat every player as an independent normal draw for the MVP. It's wrong — a QB and his
WR1 are correlated, and a game script correlates a whole offense — but it's wrong in a
well-understood direction, and modeling correlation is a post-MVP improvement worth
writing up rather than a blocker.

## Confidence score

For each starter, confidence is the fraction of simulations in which starting that player
produced a better team outcome than the best alternative on your bench for that slot.

Note what that is *not*: it isn't "how good is this player," it's "how sure are we about
this decision." A stud you'd never bench scores near 1.0 because the alternative is bad.
Two similar players score near 0.5 — correctly, because the choice barely matters. That
distinction is worth surfacing in the UI: low confidence usually means "it doesn't
matter," not "we don't know."

With the opponent-aware toggle **off**, the objective is expected points. With it **on**,
the objective is win probability against this week's actual opponent. The pro/con text
explains the delta between the two — that's the explanation the toggle owes the user.

## Why these choices

**Next.js over a separate API.** One deploy target, one language, route handlers cover
every endpoint the MVP has. A separate backend buys nothing until scheduled jobs arrive,
and by then the shape of the problem will be clearer.

**No auth in the MVP.** Sleeper's public API needs no credentials — a username resolves
to a user ID, which resolves to leagues. So onboarding is a text field. Auth lands when
write-back does, because that's the feature that actually requires an account. Store the
selected league in a cookie.

**Supabase over local Postgres.** Orca gives every task its own git worktree. A local
database means per-worktree Docker setup and drifting schemas across five checkouts. A
hosted dev database means every worktree points at the same URL and just works. If you
later want isolation, Neon's branching maps onto git branches and is a clean swap.

**Drizzle over Prisma.** The schema is plain TypeScript with no codegen step. Agents
reliably forget to re-run `prisma generate` and then debug type errors that aren't real.

**Source adapters from day one.** `packages/sources` exports a `RankingSource` interface.
FantasyPros is the first implementation — its rankings pages embed a structured
`ecrData` JSON blob, so the parse is deterministic (no LLM, no headless browser) and
`robots.txt` permits `/nfl/rankings/` at a 5s crawl delay, which one fetch per position
per week clears easily. Adding a second source or a consensus average later is a new
file plus a registry entry, not a refactor. This is the single most likely thing to
change — a source's markup will break, or its terms will tighten — so the seam belongs
there from the first commit. Yahoo was the original pick and was dropped when its
weekly article turned out to render the ranking table client-side; see
`docs/notes/ranking-sources.md`.

## Post-MVP, and what each one needs

Ordered by dependency, not priority.

| Feature | Needs first |
|---|---|
| Multi-source consensus | Second `RankingSource` implementation |
| Demo mode | `raw_fetches` history (collect from day one) |
| Backtesting + calibration | `raw_fetches` history, plus Python/pandas harness |
| Cited reasoning | Store the source span each ranking came from |
| Scheduled reports | A cron host — Vercel hobby allows one job/day; GitHub Actions is free and unlimited |
| Push notifications | PWA installed + auth |
| Write-back | A platform with a write API; Sleeper doesn't have one |
| FAAB bid sizing | League transaction history from Sleeper |
| Trade finder | Full league roster scan (Sleeper already returns this) |
| Correlated simulation | Game-script model over nflverse data |

The cheapest high-value additions are trade finder and FAAB sizing — Sleeper already
returns every roster and every transaction, so both are analysis over data you're
already fetching.
