import {
  MatchupAnalysis,
  PlayerId,
  type Position,
  type Projection,
  type SimConfig,
  type Slot,
} from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { analyzeMatchup } from "./analyze";
import { type RosterEntry } from "./lineup";

function entry(
  id: string,
  position: Position,
  mean: number,
  sd: number,
  onBye = false,
): RosterEntry {
  const projection: Projection = {
    playerId: PlayerId.parse(id),
    mean,
    sd,
    basis: { source: "fantasypros", positionRank: 1 },
  };
  return { playerId: projection.playerId, position, projection, onBye };
}

const SLOTS: Slot[] = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"];

const roster: RosterEntry[] = [
  entry("qb1", "QB", 21, 7),
  entry("rb1", "RB", 16, 8),
  entry("rb2", "RB", 12, 7),
  entry("rb3", "RB", 3, 4, true), // on bye — must never be recommended
  entry("wr1", "WR", 15, 8),
  entry("wr2", "WR", 13, 7),
  entry("wr3", "WR", 11, 6),
  entry("te1", "TE", 9, 6),
  entry("k1", "K", 8, 4),
  entry("dst1", "DST", 7, 5),
];

const opponent: Projection[] = [21, 15, 13, 14, 12, 8, 10, 8, 7].map((mean, i) => ({
  playerId: PlayerId.parse(`opp${i}`),
  mean,
  sd: 6,
  basis: { source: "fantasypros" as const, positionRank: 1 },
}));

const config: SimConfig = { objective: "win_probability", iterations: 8_000, seed: 42 };

describe("analyzeMatchup", () => {
  const analysis = analyzeMatchup({
    week: 4,
    slots: SLOTS,
    roster,
    currentStarters: [
      PlayerId.parse("qb1"),
      PlayerId.parse("rb1"),
      PlayerId.parse("rb3"), // the bye player is currently slotted — expect a swap
      PlayerId.parse("wr1"),
      PlayerId.parse("wr2"),
      PlayerId.parse("te1"),
      PlayerId.parse("wr3"),
      PlayerId.parse("k1"),
      PlayerId.parse("dst1"),
    ],
    opponent,
    config,
  });

  it("returns a valid MatchupAnalysis", () => {
    expect(() => MatchupAnalysis.parse(analysis)).not.toThrow();
    expect(analysis.calls).toHaveLength(SLOTS.length);
    expect(analysis.winProbability).toBeGreaterThan(0);
    expect(analysis.winProbability).toBeLessThan(1);
  });

  it("never starts the same player in two slots", () => {
    const recommended = analysis.calls.map((c) => c.recommended);
    expect(new Set(recommended).size).toBe(recommended.length);
  });

  it("never recommends the player on bye and calls the swap out", () => {
    expect(analysis.calls.map((c) => c.recommended)).not.toContain("rb3");
    const rbSlot = analysis.calls.filter((c) => c.slot === "RB");
    expect(rbSlot.some((c) => c.current === "rb3" && c.recommended !== "rb3")).toBe(true);
  });

  it("fills confidenceUnderOtherObjective for every call", () => {
    for (const call of analysis.calls) {
      expect(call.confidenceUnderOtherObjective).toBeGreaterThanOrEqual(0);
      expect(call.confidenceUnderOtherObjective).toBeLessThanOrEqual(1);
    }
  });

  it("flags a genuinely weak slot for the waiver scan", () => {
    const thin = analyzeMatchup({
      week: 4,
      slots: ["DST"],
      roster: [entry("dstX", "DST", 2, 3)],
      currentStarters: [PlayerId.parse("dstX")],
      opponent: [opponent[0]!],
      config,
    });
    expect(thin.weakSlots).toEqual(["DST"]);
  });
});
