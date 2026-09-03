# projections/data

## `rank_curves.json`

Positional rank → mean and standard deviation of weekly fantasy points. Built
offline by `scripts/build-rank-curves.ts` from three seasons of nflverse data
(2022–2024), half-PPR offense with standard K and DST scoring. Committed; never
produced at request time. See `docs/ARCHITECTURE.md` — "The projection problem".

```jsonc
{
  "QB": { "1": { "mean": 22.24, "sd": 7.32 }, "2": { ... }, ... },
  "RB": { ... }, "WR": { ... }, "TE": { ... }, "K": { ... }, "DST": { ... },
  "__meta__": {
    "seasons": [2022, 2023, 2024],
    "scoring": "half-ppr offense; standard K and DST",
    "method": "predictive-rank (…)",
    "minObservations": 20,
    "sampleCounts": { "QB": { "1": 45, ... }, ... },
    "generatedAt": "…"
  }
}
```

Ranks run from 1 to a per-position cap (QB 40, RB 72, WR 96, TE 40, K 36, DST 32),
truncated wherever a rank has fewer than `minObservations` weeks of data.

## Method — predictive rank

For each week from 4 onward, rank the players who suit up by their **trailing
average** (mean points over their prior games, needing ≥ 2), then record each
one's **actual points that week**. Rank is re-indexed among players who play,
matching how a weekly ranking source only lists players who'll be active.

So `WR["12"]` answers *"a source ranks this player WR12 — what does his week
actually look like?"* — mean **and** a realistic spread (WR3 sd ≈ 8, K sd ≈ 4,
matching `ARCHITECTURE.md`'s figures). This is the quantity the Monte Carlo needs;
"the range is the product".

Caveats for the projection model:

- **Means are not strictly monotonic** in the middle (e.g. WR1 ≈ WR3). The
  trailing-average proxy is an imperfect stand-in for expert consensus, and with
  ~45 observations per rank there's noise. The model may want to isotonic-smooth
  the means; the sds are the more important output.
- Rookies and mid-season breakouts are under-weighted early (no trailing history
  → unranked until they build one).
- A single half-PPR config; regenerate against the target league's exact scoring
  when that's wired up.

## Regenerating

```
pnpm --filter @waiver-wire/scripts rank-curves
```

Downloads are cached under `scripts/.data-cache/` (gitignored). Delete it to
force a fresh pull.
