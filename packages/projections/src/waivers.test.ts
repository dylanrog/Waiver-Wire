import { PlayerId, type Position, type Projection, type SourceRanking } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { rankCurves } from "./curves";
import { rankToProjection } from "./projection";
import { waiverScan } from "./waivers";

let n = 0;
function ranking(position: Position, rank: number, id?: string): SourceRanking {
  n += 1;
  return {
    source: "fantasypros",
    week: 1,
    position,
    rank,
    playerId: PlayerId.parse(id ?? `pl${n}`),
    sourceExcerpt: null,
    fetchedAt: new Date("2026-09-02T00:00:00Z"),
  };
}

function starter(slot: "RB" | "WR" | "TE" | "FLEX", id: string, position: Position, mean: number) {
  const projection: Projection = {
    playerId: PlayerId.parse(id),
    mean,
    sd: 6,
    basis: { source: "fantasypros", positionRank: 1 },
  };
  return { slot, playerId: projection.playerId, position, projection };
}

describe("waiverScan", () => {
  const rankings = [
    ranking("RB", 20, "rb-rostered"),
    ranking("RB", 24, "rb-free-1"),
    ranking("RB", 40, "rb-free-2"),
    ranking("WR", 30, "wr-free"),
    ranking("TE", 10, "te-free"),
  ];

  it("excludes rostered players and returns the top options by projection", () => {
    const [scan] = waiverScan({
      week: 1,
      rankings,
      rosteredPlayerIds: new Set(["rb-rostered"]),
      myStarters: [starter("RB", "my-rb", "RB", 14)],
      slots: ["RB"],
      limit: 5,
    });
    expect(scan?.candidates.map((c) => c.playerId)).toEqual(["rb-free-1", "rb-free-2"]);
    const [best] = scan!.candidates;
    expect(best?.projection.mean).toBe(rankToProjection(rankings[1]!, rankCurves).mean);
  });

  it("scores upgradeOverCurrent against the slot's current starter (can be negative)", () => {
    const currentMean = rankToProjection(ranking("RB", 24), rankCurves).mean + 20;
    const [scan] = waiverScan({
      week: 1,
      rankings,
      rosteredPlayerIds: new Set(),
      myStarters: [starter("RB", "stud", "RB", currentMean)],
      slots: ["RB"],
    });
    for (const candidate of scan!.candidates) {
      expect(candidate.upgradeOverCurrent).toBeLessThan(0);
      expect(candidate.currentStarter).toBe("stud");
    }
  });

  it("pools RB / WR / TE for a FLEX scan, re-ranked by projection", () => {
    const [scan] = waiverScan({
      week: 1,
      rankings,
      rosteredPlayerIds: new Set(["rb-rostered"]),
      myStarters: [starter("FLEX", "my-flex", "WR", 10)],
      slots: ["FLEX"],
    });
    const positions = new Set(scan?.candidates.map((c) => c.position));
    expect(positions.size).toBeGreaterThan(1);
    const means = scan!.candidates.map((c) => c.projection.mean);
    expect(means).toEqual([...means].sort((a, b) => b - a));
  });

  it("caps each slot at the limit", () => {
    const many = Array.from({ length: 12 }, (_, i) => ranking("WR", i + 1));
    const [scan] = waiverScan({
      week: 1,
      rankings: many,
      rosteredPlayerIds: new Set(),
      myStarters: [],
      slots: ["WR"],
      limit: 5,
    });
    expect(scan?.candidates).toHaveLength(5);
  });
});
