# FantasyPros fixtures

Raw HTML of FantasyPros expert-consensus ranking pages, captured for the parser's
unit tests. **No network in tests** (`CLAUDE.md`) — the FantasyPros adapter is fed
these bytes.

| File | Page | Captured |
|---|---|---|
| `rankings-dst-2026-wk1.html` | `/nfl/rankings/dst.php` | 2026-09-02, Week 1 (32 teams, 14 experts) |
| `rankings-qb-2026-wk1.html` | `/nfl/rankings/qb.php` | 2026-09-02, Week 1 (97 players, 25 experts) |
| `rankings-rb-2026-wk1.html` | `/nfl/rankings/rb.php` | 2026-09-02, Week 1 (166 players, 24 experts) |

DST covers team-abbreviation mapping; QB/RB cover individual-player name resolution;
RB is a position whose scoring varies (`rb.php` / `ppr-rb.php` / `half-point-ppr-rb.php`).

## What the parser reads

Each page embeds `var ecrData = { ... };` in a `<script>`. Shape:

```jsonc
{
  "year": "2026", "week": "1", "position_id": "DST", "scoring": "STD",
  "count": 32, "total_experts": 14, "last_updated": "9/02",
  "players": [
    {
      "player_name": "Jacksonville Jaguars", "player_team_id": "JAC",
      "player_position_id": "DST", "player_short_name": "JAC DST",
      "rank_ecr": 1, "rank_min": "1", "rank_max": "2", "rank_ave": "1.33",
      "rank_std": "0.47", "pos_rank": "DST1",
      "player_opponent": "vs. CLE", "player_bye_week": "7"
    }
  ]
}
```

## Re-capturing

```bash
curl -sL -A "<real UA>" https://www.fantasypros.com/nfl/rankings/dst.php -o rankings-dst-<season>-wk<n>.html
```

`robots.txt` allows `/nfl/rankings/` (disallows only `/api/`, `/ajax/`, `/json/`) with
`Crawl-delay: 5`. Pages default to the current week; add `?week=N` for a specific one.
See `docs/notes/ranking-sources.md`.
