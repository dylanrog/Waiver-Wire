import { z } from "zod";

import rawCurves from "../data/rank_curves.json";

/** One positional rank's historical weekly-points distribution. */
const RankStat = z.object({ mean: z.number(), sd: z.number().nonnegative() });

/** rank (as a string key) → stat. */
const RankCurve = z.record(z.string(), RankStat);

const RankCurvesSchema = z
  .object({
    QB: RankCurve,
    RB: RankCurve,
    WR: RankCurve,
    TE: RankCurve,
    K: RankCurve,
    DST: RankCurve,
  })
  .passthrough();

export type RankCurves = z.infer<typeof RankCurvesSchema>;

/** `data/rank_curves.json`, validated at load — parse, don't assume (CLAUDE.md). */
export const rankCurves: RankCurves = RankCurvesSchema.parse(rawCurves);
