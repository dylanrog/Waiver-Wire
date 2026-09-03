import type { Projection, SourceRanking } from "@waiver-wire/shared";

import type { RankCurves } from "./curves";

/**
 * A source's ordinal ranking → a points distribution, via `rank_curves.json`.
 * Ranks past the end of a position's curve clamp to its last entry; `basis`
 * keeps the real rank for the explanation layer.
 */
export function rankToProjection(ranking: SourceRanking, curves: RankCurves): Projection {
  const curve = curves[ranking.position];
  const ranks = Object.keys(curve)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);

  const maxRank = ranks.at(-1);
  if (maxRank === undefined) {
    throw new Error(`rank_curves.json has no entries for ${ranking.position}`);
  }

  const key = String(Math.min(Math.max(1, ranking.rank), maxRank));
  const stat = curve[key];
  if (stat === undefined) {
    throw new Error(`rank_curves.json[${ranking.position}] has no entry at rank ${key}`);
  }

  return {
    playerId: ranking.playerId,
    mean: stat.mean,
    sd: stat.sd,
    basis: { source: ranking.source, positionRank: ranking.rank },
  };
}
