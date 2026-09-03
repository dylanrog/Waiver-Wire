# Ranking sources

Why the MVP's first `RankingSource` is FantasyPros, and what Wave 1 needs to know.

## Decision

**FantasyPros expert-consensus rankings**, parsed from the embedded `ecrData` JSON on
each `/nfl/rankings/*.php` page. Deterministic — no LLM, no headless browser.

Recorded 2026-09-02. Supersedes the original Yahoo pick in earlier drafts of
`docs/MVP.md` and `docs/ARCHITECTURE.md`.

## Why not Yahoo

The plan was to LLM-extract player/rank pairs from Yahoo's weekly rankings article
(e.g. `sports.yahoo.com/fantasy/article/week-1-fantasy-football-defense-rankings-…`).
On inspection, **the article does not contain the ranking list**. The body is a few
prose paragraphs plus:

> "Below you can find the rest of our D/ST rankings for Week 1 of the season:"
> `<section class="consent"><div class="card-loader" data-testid="loader">`

— a skeleton. The 1–32 table renders client-side into that node. Of all 32 NFL teams,
only the ~4 named in the intro prose appear anywhere in the 710 KB of HTML (or in the
React flight data). Getting the list would need a headless browser plus handling the
`consent` (GDPR) embed wrapper — fragile, and Yahoo's terms are scraping-hostile.

Yahoo stays a *possible* future adapter (their official Fantasy API, OAuth, has
rankings), but it is not the first source.

## FantasyPros specifics

### URLs

`https://www.fantasypros.com/nfl/rankings/{scoring-prefix}{pos}.php`

| | value |
|---|---|
| `pos` | `qb` `rb` `wr` `te` `k` `dst` `flex` (also `op` for superflex) |
| scoring prefix | *(none)* = standard · `ppr-` · `half-point-ppr-` |
| week | defaults to current; `?week=N` for a specific week |

QB, K, and DST rankings do not vary by scoring — always use the bare page.

### `ecrData` payload

Embedded as `var ecrData = { ... };` inside a `<script>`. Top level: `year`, `week`,
`position_id`, `scoring` (`STD` / `HALF` / `PPR`), `count`, `total_experts`,
`last_updated`, `players[]`.

Per player (fields the MVP uses in **bold**):

- **`player_name`** — full name, or full team name for DST ("Jacksonville Jaguars")
- **`player_team_id`** — NFL abbreviation. FantasyPros uses `JAC` (Sleeper: `JAX`); also
  reconcile `WAS`/`WSH` and `LAR`/`LA` against Sleeper. Keep a small abbreviation map.
- **`player_position_id`** — `QB` `RB` `WR` `TE` `K` `DST`
- **`rank_ecr`** — expert consensus rank, 1-based within position → `SourceRanking.rank`
- `rank_min` / `rank_max` / `rank_ave` / `rank_std` — consensus spread (strings). Not
  consumed by the MVP projection model (that uses `rank_curves.json`), but cheap to keep.
- `pos_rank` — e.g. `"RB7"` · `player_opponent` — e.g. `"vs. CLE"` · `player_bye_week`

### robots.txt

`Disallow: /api/ /ajax/ /json/ /xml/ /nfl/ranker/` — the JSON endpoints the page's own
JS calls are off-limits, so parse the `ecrData` embedded in the **allowed**
`/nfl/rankings/` HTML page instead. `Crawl-delay: 5`; the MVP fetches one page per
position per week, well within that.

### Name resolution

Every row carries team + position, so the `docs/MVP.md` §2 three-tier resolver
(exact → normalized → last-name + team + position) is more reliable than it would have
been against prose. DST rows resolve by team abbreviation. Log every miss.

### Fixtures

`packages/sources/tests/fixtures/fantasypros/` — real captured pages for DST, QB, RB
(2026 W1). See that folder's README.

## If FantasyPros breaks

The `RankingSource` seam exists for this. Options, roughly in order of preference:
FantasyPros official API (free tier, API key) · a second scraped source for consensus ·
Yahoo official Fantasy API (OAuth).
