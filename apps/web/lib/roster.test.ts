import { describe, expect, it } from "vitest";

import { structureRoster } from "./roster";

const positions = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "IR"];

const playerRows = [
  { id: "1", fullName: "Quarterback One", position: "QB", team: "KC", injuryStatus: null },
  { id: "2", fullName: "Runner Two", position: "RB", team: "DET", injuryStatus: "Questionable" },
  { id: "3", fullName: "Benchwarmer", position: "WR", team: "SEA", injuryStatus: null },
  { id: "4", fullName: "Hurt Guy", position: "RB", team: "NYG", injuryStatus: "IR" },
];

describe("structureRoster", () => {
  const roster = {
    sleeperRosterId: 1,
    teamName: "TetaTots",
    players: ["1", "2", "3", "4"],
    starters: ["1", "2", "0", "0", "0", "0", "0", "0", "0"],
    reserve: ["4"],
    settings: { wins: 2, losses: 1, ties: 0, fpts: 210.5 },
  };
  const result = structureRoster(roster, positions, playerRows);

  it("aligns starters to the starting slots, leaving empty ones null", () => {
    expect(result.starters).toHaveLength(9); // BN / IR excluded
    expect(result.starters[0]).toEqual({
      slot: "QB",
      player: {
        playerId: "1",
        name: "Quarterback One",
        position: "QB",
        team: "KC",
        injuryStatus: null,
      },
    });
    expect(result.starters[2]).toEqual({ slot: "RB", player: null });
  });

  it("derives the bench as players minus starters minus reserve", () => {
    expect(result.bench.map((p) => p.playerId)).toEqual(["3"]);
    expect(result.ir.map((p) => p.playerId)).toEqual(["4"]);
  });

  it("reads the record and points from the roster settings", () => {
    expect(result.team.record).toEqual({ wins: 2, losses: 1, ties: 0 });
    expect(result.team.pointsFor).toBe(210.5);
  });
});
