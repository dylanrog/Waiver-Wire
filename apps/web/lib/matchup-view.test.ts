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
  it("attaches our projection to the matching player; null when there's no projection entry", () => {
    const team = buildMyTeam({
      rosterPositions: ["QB", "RB", "BN"],
      starters: ["qb", "rb1"],
      allPlayerIds: ["qb", "rb1", "rb2"],
      rows,
      games,
      platformPoints: new Map([["rb1", 17]]),
      ourProjections: new Map([["rb1", { mean: 18.4, sd: 8.2 }]]),
    });
    expect(team[1]!.ourProjection).toEqual({ mean: 18.4, sd: 8.2 });
    expect(team[2]!.ourProjection).toBeNull();
  });
});
