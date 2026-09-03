import { PlayerId, type Position, type Projection, type Slot } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { optimalLineup, type RosterEntry } from "./lineup";

function entry(id: string, position: Position, mean: number, onBye = false): RosterEntry {
  const projection: Projection = {
    playerId: PlayerId.parse(id),
    mean,
    sd: 5,
    basis: { source: "fantasypros", positionRank: 1 },
  };
  return { playerId: projection.playerId, position, projection, onBye };
}

const SLOTS: Slot[] = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DST"];

describe("optimalLineup", () => {
  it("fills each slot with the best eligible player and FLEX with the best leftover", () => {
    const roster = [
      entry("qb1", "QB", 22),
      entry("rb1", "RB", 18),
      entry("rb2", "RB", 12),
      entry("rb3", "RB", 6),
      entry("wr1", "WR", 16),
      entry("wr2", "WR", 14),
      entry("wr3", "WR", 13), // beats rb3 for the FLEX
      entry("te1", "TE", 9),
      entry("k1", "K", 8),
      entry("dst1", "DST", 7),
    ];
    const lineup = optimalLineup(SLOTS, roster);
    const byId = (slot: Slot) => lineup.filter((l) => l.slot === slot).map((l) => l.playerId);

    expect(byId("RB")).toEqual(["rb1", "rb2"]);
    expect(byId("WR")).toEqual(["wr1", "wr2"]);
    expect(byId("FLEX")).toEqual(["wr3"]);
  });

  it("never puts a player in a slot their position can't fill", () => {
    const roster = [entry("wr1", "WR", 20), entry("rb1", "RB", 5)];
    const lineup = optimalLineup(["RB"], roster);
    expect(lineup).toEqual([{ slot: "RB", playerId: "rb1" }]);
  });

  it("leaves a slot empty when nobody is eligible", () => {
    const lineup = optimalLineup(["QB"], [entry("rb1", "RB", 10)]);
    expect(lineup).toEqual([{ slot: "QB", playerId: null }]);
  });

  it("skips players on bye", () => {
    const roster = [entry("rb1", "RB", 20, true), entry("rb2", "RB", 8)];
    const lineup = optimalLineup(["RB"], roster);
    expect(lineup[0]?.playerId).toBe("rb2");
  });
});
