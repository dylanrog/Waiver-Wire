import { describe, expect, it } from "vitest";

import { toPlayer, toResolverPlayers } from "./map";
import { resolveRankingNames } from "./resolver";
import { SleeperPlayer } from "./schemas";
import { fixture } from "./test-support";

const players = SleeperPlayer.array().parse(
  Object.values(fixture("players") as Record<string, unknown>),
);

describe("toPlayer", () => {
  it("maps a skill player to the domain type", () => {
    const mahomes = players.find((p) => p.player_id === "4046");
    expect(toPlayer(mahomes!)).toEqual({
      id: "4046",
      fullName: "Patrick Mahomes",
      position: "QB",
      team: "KC",
      byeWeek: null,
      injuryStatus: expect.any(String),
    });
  });

  it("maps a Sleeper DEF to position DST", () => {
    const hou = players.find((p) => p.player_id === "HOU");
    expect(toPlayer(hou!)?.position).toBe("DST");
  });

  it("drops a non-fantasy position", () => {
    const guard = players.find((p) => p.player_id === "2212"); // Josh Allen, G
    expect(toPlayer(guard!)).toBeNull();
  });
});

describe("toResolverPlayers → resolveRankingNames (end to end on real data)", () => {
  it("resolves FantasyPros-style names against the real player index", () => {
    const index = toResolverPlayers(players);
    const { resolved, unresolved } = resolveRankingNames(
      index,
      [
        { rawName: "Patrick Mahomes II", team: "KC", position: "QB" },
        { rawName: "Kenneth Walker III", team: "KC", position: "RB" },
        { rawName: "Jacksonville Jaguars", team: "JAC", position: "DST" },
        { rawName: "D'Andre Swift", team: "CHI", position: "RB" },
      ],
      { source: "fantasypros", week: 1 },
    );

    expect(unresolved).toHaveLength(0);
    expect(resolved.map((r) => r.playerId)).toEqual(["4046", "8151", "JAX", "6790"]);
  });
});
