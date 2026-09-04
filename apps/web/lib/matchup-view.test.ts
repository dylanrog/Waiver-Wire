import type { PlayerId } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { buildMyTeam, buildTeam } from "./matchup-view";

const rows = [
  { id: "qb", fullName: "Justin Herbert", firstName: "Justin", lastName: "Herbert", position: "QB", team: "LAC", injuryStatus: null },
  { id: "rb1", fullName: "Jahmyr Gibbs", firstName: "Jahmyr", lastName: "Gibbs", position: "RB", team: "DET", injuryStatus: null },
  { id: "rb2", fullName: "Bench Back", firstName: "Bench", lastName: "Back", position: "RB", team: "GB", injuryStatus: "Q" },
];

const games = new Map([
  ["LAC", { kickoff: "2026-09-13T17:00:00Z", opponent: "KC", home: false, status: "scheduled" as const }],
  ["DET", { kickoff: "2026-09-13T17:00:00Z", opponent: "GB", home: true, status: "scheduled" as const }],
]);

describe("buildTeam (opponent — no numbers we compute)", () => {
  it("orders starters by roster slot then bench, and attaches game + platform points", () => {
    const team = buildTeam({
      rosterPositions: ["QB", "RB", "BN"],
      starters: ["qb", "rb1"],
      allPlayerIds: ["qb", "rb1", "rb2"],
      rows,
      games,
      platformPoints: new Map([["qb", 18.1], ["rb1", 20.4]]),
    });
    expect(team.map((p) => [p.playerId, p.slot])).toEqual([
      ["qb", "QB"],
      ["rb1", "RB"],
      ["rb2", "BENCH"],
    ]);
    expect(team[0]!.platformPoints).toBe(18.1);
    expect(team[2]!.game).toBeNull(); // GB not in the games map → bye
    expect(team[1]!.game).toMatchObject({ opponent: "GB", home: true });
  });
});

describe("buildMyTeam", () => {
  const call = {
    slot: "RB" as const,
    recommended: "rb1" as PlayerId,
    current: "rb1" as PlayerId,
    confidence: 0.52,
    alternative: "rb2" as PlayerId,
    confidenceUnderOtherObjective: 0.55,
    projection: { playerId: "rb1" as PlayerId, mean: 18.4, sd: 8.2, basis: { source: "fantasypros" as const, positionRank: 3 } },
  };

  it("adds our projection and the call (keyed by player) to the recommended player; others null", () => {
    const team = buildMyTeam({
      rosterPositions: ["QB", "RB", "BN"],
      starters: ["qb", "rb1"],
      allPlayerIds: ["qb", "rb1", "rb2"],
      rows,
      games,
      platformPoints: new Map([["rb1", 17]]),
      ourProjections: new Map([["rb1", { mean: 18.4, sd: 8.2 }]]),
      callsByPlayer: new Map([["rb1", call]]),
    });
    expect(team[1]!.ourProjection).toEqual({ mean: 18.4, sd: 8.2 });
    expect(team[1]!.call?.confidence).toBe(0.52);
    expect(team[2]!.call).toBeNull();
  });

  it("puts the call on a bench player when the sim recommends starting them (swap-in)", () => {
    const swapIn = { ...call, recommended: "rb2" as PlayerId, current: "rb1" as PlayerId };
    const team = buildMyTeam({
      rosterPositions: ["QB", "RB", "BN"],
      starters: ["qb", "rb1"],
      allPlayerIds: ["qb", "rb1", "rb2"],
      rows,
      games,
      platformPoints: new Map(),
      ourProjections: new Map(),
      callsByPlayer: new Map([["rb2", swapIn]]),
    });
    expect(team[2]!.playerId).toBe("rb2"); // the bench row
    expect(team[2]!.call?.confidence).toBe(0.52);
    expect(team[1]!.call).toBeNull(); // current starter carries no call
  });
});
