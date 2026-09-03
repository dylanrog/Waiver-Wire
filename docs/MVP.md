# MVP scope

In scope. Everything else is not, however tempting.

## 1. Connect a league

Enter a Sleeper username → pick from your leagues → the app remembers it in a cookie.
No account, no password. Fetch and store the roster, the league's scoring settings, and
the full player index.

Endpoints (all public, no auth):
```
GET https://api.sleeper.app/v1/user/{username}
GET https://api.sleeper.app/v1/user/{user_id}/leagues/nfl/{season}
GET https://api.sleeper.app/v1/league/{league_id}
GET https://api.sleeper.app/v1/league/{league_id}/rosters
GET https://api.sleeper.app/v1/league/{league_id}/users
GET https://api.sleeper.app/v1/league/{league_id}/matchups/{week}
GET https://api.sleeper.app/v1/players/nfl        # ~5MB, cache aggressively
GET https://api.sleeper.app/v1/state/nfl          # current week
```

The player index is large and changes rarely. Fetch it once per day at most, store it,
and never fetch it in a request path.

## 2. Weekly rankings from FantasyPros

Fetch the current week's FantasyPros expert-consensus rankings for each position, one
request per position per week. Each rankings page (`/nfl/rankings/{prefix}{pos}.php`)
embeds a `var ecrData = { ... }` JSON blob: per player, its name, NFL team, position,
consensus rank (`rank_ecr`), rank spread (`rank_min` / `rank_max` / `rank_std`),
opponent, and bye week. Parse that blob — no LLM, no headless browser.

Scoring is a URL prefix chosen from the league settings — `rb.php` (standard),
`ppr-rb.php`, `half-point-ppr-rb.php`. QB, K, and DST don't vary by scoring.

Normalize each row to a Sleeper player ID. Name matching is still the annoying part for
offensive players, but every row carries team and position, so the resolver is more
reliable: exact match, then normalized match (strip punctuation, suffixes, casing),
then last name + team + position. DST rows map by team abbreviation (watch `JAC`→`JAX`
and similar). Log every unmatched name — an unmatched name is a silently missing
recommendation, so it should be visible, not swallowed.

The `RankingSource` interface still allows an LLM extraction step for future
article-based or prose sources; FantasyPros needs none. See
`docs/notes/ranking-sources.md`.

## 3. Waiver streaming

User checks which positions to run on: QB, RB, WR, TE, FLEX, K, DST, or all.

For each selected position: take this week's ranked players, subtract everyone rostered
anywhere in the league, return the top 5 remaining with their rank and projected range.
FLEX means RB/WR/TE pooled and re-ranked by projection.

Show, for each: rank, projection range, and how they'd compare to the current starter at
that slot. A pickup suggestion without that comparison isn't actionable.

## 4. Lineup analysis

For every roster slot, compute the optimal starter and a confidence score. Show the
recommended lineup against the current one, with the swaps called out.

The **opponent-aware toggle** switches the objective between expected points and win
probability against this week's actual opponent. When it's on, every player row carries a
short pro/con explaining what the toggle changed for *that player* — typically some
version of "lower ceiling but you only need 12 points" or "you're down 20, his 25th
percentile doesn't matter."

Run the Monte Carlo for both objectives so the toggle is instant, not a refetch.

If the best available lineup at a position still produces a weak distribution, surface a
prompt to run the waiver scan for that position. That's the link between features 3 and 4.

## 5. Dashboard

One page, phone-shaped:

```
┌─────────────────────────────┐
│ Week 4 · vs Mike's Team     │
│ Win probability   61%       │  ← the headline number, with its range
│ ├──────────●────────┤       │
├─────────────────────────────┤
│ [ Opponent-aware  ●—— ]     │  ← toggle, changes everything below
├─────────────────────────────┤
│ QB   Daniels      92%  ───  │
│ RB   Gibbs        88%  ───  │
│ RB   Irving       54%  ⚠    │  ← low confidence, tap for pro/con
│ FLEX Higgins      71%  ↑    │  ← ↑ = swap suggested
│ ...                         │
├─────────────────────────────┤
│ Streaming: DST, K     [Run] │
└─────────────────────────────┘
```

Installable PWA — manifest, icons, service worker for shell caching. Not an app store
build.

## Explicitly out of scope

Auth. Multiple leagues at once. Multiple platforms. Multiple ranking sources. Scheduled
jobs. Push notifications. Write-back. Demo mode. Backtesting. Cost tracking. Trade
analysis. Dynasty and IDP formats. Season-long views.

## Build order

Each numbered item depends on the ones before it.

1. `packages/shared` — types and schemas. **Everything else blocks on this.**
2. `packages/db` — Drizzle schema, `raw_fetches` included
3. `packages/sleeper` and `packages/sources` — parallel, no shared code
4. `rank_curves.json` — the offline nflverse script
5. `packages/projections` — needs 1 and 4, not 2 or 3
6. `apps/web` — needs everything

Steps 3 and 5 can run concurrently with each other once 1 and 4 exist. That's your
widest parallel moment.
