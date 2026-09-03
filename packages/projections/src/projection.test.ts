import { PlayerId, type SourceRanking } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { rankCurves } from "./curves";
import { rankToProjection } from "./projection";

function ranking(over: Partial<SourceRanking>): SourceRanking {
  return {
    source: "fantasypros",
    week: 1,
    position: "QB",
    rank: 1,
    playerId: PlayerId.parse("4046"),
    sourceExcerpt: null,
    fetchedAt: new Date("2026-09-02T00:00:00Z"),
    ...over,
  };
}

describe("rankToProjection", () => {
  it("looks up the curve for the ranking's position and rank", () => {
    const p = rankToProjection(ranking({ position: "QB", rank: 1 }), rankCurves);
    expect(p.mean).toBe(rankCurves.QB["1"]?.mean);
    expect(p.sd).toBe(rankCurves.QB["1"]?.sd);
    expect(p.basis).toEqual({ source: "fantasypros", positionRank: 1 });
    expect(p.playerId).toBe("4046");
  });

  it("clamps a rank past the end of the curve to the last entry", () => {
    const lastQb = Math.max(...Object.keys(rankCurves.QB).map(Number));
    const p = rankToProjection(ranking({ position: "QB", rank: 999 }), rankCurves);
    expect(p.mean).toBe(rankCurves.QB[String(lastQb)]?.mean);
    // basis keeps the real rank, not the clamped one
    expect(p.basis.positionRank).toBe(999);
  });

  it("handles every domain position", () => {
    for (const position of ["QB", "RB", "WR", "TE", "K", "DST"] as const) {
      const p = rankToProjection(ranking({ position, rank: 3 }), rankCurves);
      expect(p.sd).toBeGreaterThan(0);
    }
  });
});
