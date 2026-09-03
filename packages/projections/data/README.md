# projections/data

## `rank_curves.json`

Positional rank → mean and standard deviation of weekly fantasy points. Built
offline by `scripts/build-rank-curves.ts` from three seasons of nflverse data
(2022–2024), half-PPR offense with standard K and DST scoring. Committed; never
produced at request time. See `docs/ARCHITECTURE.md` — "The projection problem".

```jsonc
{
  "QB": { "1": { "mean": 34.1, "sd": 5.0 }, "2": { ... }, ... },
  "RB": { ... }, "WR": { ... }, "TE": { ... }, "K": { ... }, "DST": { ... },
  "__meta__": {
    "seasons": [2022, 2023, 2024],
    "scoring": "half-ppr offense; standard K and DST",
    "minObservations": 20,
    "generatedAt": "…",
    "sampleCounts": { "QB": { "1": 54, ... }, ... }
  }
}
```

Ranks run from 1 to a per-position cap (QB 40, RB 72, WR 96, TE 40, K 36, DST 32),
truncated wherever a rank has fewer than `minObservations` weeks of data.

## Method note (read before Wave 2)

These are **order statistics**: for each week we rank every player by that week's
actual finish, then average points at each rank slot across weeks. The **means**
track the familiar positional value curves closely. The **standard deviations are
narrower** than `docs/ARCHITECTURE.md`'s example figures ("WR3 sd ~9; Kicker
sd ~4") — conditioning on within-week rank compresses spread. This measures "what
the Nth-best score looks like", not "how a player *projected* Nth actually
varies". If the Monte Carlo needs the latter (wider) spread, the build should
move to a predictive-rank basis (rank by trailing performance, record the
following week's outcome). Flagged for the projections implementation.

## Regenerating

```
pnpm --filter @waiver-wire/scripts rank-curves
```

Downloads are cached under `scripts/.data-cache/` (gitignored). Delete it to
force a fresh pull.
