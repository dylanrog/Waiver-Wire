import { describe, expect, it } from "vitest";

import { dstPoints, HALF_PPR, kickerPoints, offensePoints, pointsAllowedScore } from "./scoring";

describe("offensePoints (half PPR)", () => {
  it("scores a passing line", () => {
    // 300 * 0.04 + 2 * 4 + 1 * -1
    expect(
      offensePoints(
        { passing_yards: "300", passing_tds: "2", passing_interceptions: "1" },
        HALF_PPR,
      ),
    ).toBeCloseTo(19);
  });

  it("scores a rushing + receiving line with half-point receptions", () => {
    // 80 * 0.1 + 1 * 6 + 40 * 0.1 + 5 * 0.5
    expect(
      offensePoints(
        { rushing_yards: "80", rushing_tds: "1", receiving_yards: "40", receptions: "5" },
        HALF_PPR,
      ),
    ).toBeCloseTo(20.5);
  });

  it("subtracts lost fumbles", () => {
    expect(offensePoints({ rushing_yards: "50", rushing_fumbles_lost: "1" }, HALF_PPR)).toBeCloseTo(
      3,
    );
  });

  it("treats missing / non-numeric fields as zero", () => {
    expect(offensePoints({ receiving_yards: "NA", receptions: "" }, HALF_PPR)).toBe(0);
  });
});

describe("kickerPoints", () => {
  it("scores field goals by distance bucket plus PATs", () => {
    // 2 * 3 (20-29) + 1 * 4 (40-49) + 3 * 1 (PAT)
    expect(
      kickerPoints({ fg_made_20_29: "2", fg_made_40_49: "1", pat_made: "3" }, HALF_PPR),
    ).toBeCloseTo(13);
  });

  it("scores a 50+ field goal at 5 and ignores misses at 0", () => {
    expect(kickerPoints({ fg_made_50_59: "1", fg_missed: "2" }, HALF_PPR)).toBeCloseTo(5);
  });
});

describe("pointsAllowedScore", () => {
  it("applies the standard tiers", () => {
    expect(pointsAllowedScore(0, HALF_PPR)).toBe(10);
    expect(pointsAllowedScore(6, HALF_PPR)).toBe(7);
    expect(pointsAllowedScore(7, HALF_PPR)).toBe(4);
    expect(pointsAllowedScore(20, HALF_PPR)).toBe(1);
    expect(pointsAllowedScore(34, HALF_PPR)).toBe(-1);
    expect(pointsAllowedScore(35, HALF_PPR)).toBe(-4);
  });
});

describe("dstPoints", () => {
  it("adds turnovers, sacks, and the points-allowed tier", () => {
    // 3 sacks + 1 INT * 2 + 1 fumble rec * 2 + PA 10 -> tier 7-13 = 4
    expect(
      dstPoints({ def_sacks: "3", def_interceptions: "1", fumble_recovery_opp: "1" }, 10, HALF_PPR),
    ).toBeCloseTo(3 + 2 + 2 + 4);
  });

  it("rewards a shutout with a defensive touchdown", () => {
    expect(dstPoints({ def_tds: "1" }, 0, HALF_PPR)).toBeCloseTo(6 + 10);
  });
});
