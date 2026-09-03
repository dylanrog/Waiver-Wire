import { describe, expect, it } from "vitest";

import type { ResolverPlayer } from "./resolver";
import { resolveRankingNames } from "./resolver";

const ctx = { source: "fantasypros" as const, week: 1 as const };

const players: ResolverPlayer[] = [
  {
    id: "4984",
    fullName: "Josh Allen",
    lastName: "Allen",
    position: "QB",
    fantasyPositions: ["QB"],
    team: "BUF",
  },
  {
    id: "2212",
    fullName: "Josh Allen",
    lastName: "Allen",
    position: "G",
    fantasyPositions: ["OL"],
    team: null,
  },
  {
    id: "5859",
    fullName: "A.J. Brown",
    lastName: "Brown",
    position: "WR",
    fantasyPositions: ["WR"],
    team: "PHI",
  },
  {
    id: "4634",
    fullName: "Kenneth Walker",
    lastName: "Walker",
    position: "WR",
    fantasyPositions: ["WR"],
    team: null,
  },
  {
    id: "8151",
    fullName: "Kenneth Walker",
    lastName: "Walker",
    position: "RB",
    fantasyPositions: ["RB"],
    team: "SEA",
  },
  {
    id: "11628",
    fullName: "Marvin Harrison",
    lastName: "Harrison",
    position: "WR",
    fantasyPositions: ["WR"],
    team: "ARI",
  },
  {
    id: "HOU",
    fullName: null,
    lastName: "Texans",
    position: "DEF",
    fantasyPositions: ["DEF"],
    team: "HOU",
  },
  {
    id: "JAX",
    fullName: null,
    lastName: "Jaguars",
    position: "DEF",
    fantasyPositions: ["DEF"],
    team: "JAX",
  },
];

function resolve(query: {
  rawName: string;
  team?: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "K" | "DST";
}) {
  return resolveRankingNames(players, [{ team: null, ...query }], ctx);
}

describe("resolveRankingNames", () => {
  it("matches an exact full name", () => {
    const { resolved, unresolved } = resolve({ rawName: "A.J. Brown", position: "WR" });
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]?.playerId).toBe("5859");
  });

  it("matches across punctuation and casing", () => {
    const { resolved } = resolve({ rawName: "aj brown", position: "WR" });
    expect(resolved[0]?.playerId).toBe("5859");
  });

  it("strips a generational suffix before matching", () => {
    const { resolved } = resolve({ rawName: "Kenneth Walker III", team: "SEA", position: "RB" });
    expect(resolved[0]?.playerId).toBe("8151");
  });

  it("disambiguates a shared name by position", () => {
    const { resolved } = resolve({ rawName: "Josh Allen", position: "QB" });
    expect(resolved[0]?.playerId).toBe("4984");
  });

  it("falls back to last name + team + position", () => {
    const { resolved } = resolve({ rawName: "M. Harrison", team: "ARI", position: "WR" });
    expect(resolved[0]?.playerId).toBe("11628");
  });

  it("resolves a DST by full team name", () => {
    const { resolved } = resolve({ rawName: "Houston Texans", team: "HOU", position: "DST" });
    expect(resolved[0]?.playerId).toBe("HOU");
  });

  it("reconciles team abbreviations for a DST (JAC -> JAX)", () => {
    const { resolved } = resolve({ rawName: "Jacksonville Jaguars", team: "JAC", position: "DST" });
    expect(resolved[0]?.playerId).toBe("JAX");
  });

  it("reports a genuine miss as an UnresolvedName carrying the context", () => {
    const { resolved, unresolved } = resolve({ rawName: "Nobody McFakename", position: "RB" });
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual([
      { source: "fantasypros", week: 1, rawName: "Nobody McFakename", position: "RB" },
    ]);
  });

  it("reports an unresolvable ambiguity rather than guessing", () => {
    const twins: ResolverPlayer[] = [
      {
        id: "a",
        fullName: "Mike Williams",
        lastName: "Williams",
        position: "WR",
        fantasyPositions: ["WR"],
        team: null,
      },
      {
        id: "b",
        fullName: "Mike Williams",
        lastName: "Williams",
        position: "WR",
        fantasyPositions: ["WR"],
        team: null,
      },
    ];
    const { resolved, unresolved } = resolveRankingNames(
      twins,
      [{ rawName: "Mike Williams", team: null, position: "WR" }],
      ctx,
    );
    expect(resolved).toHaveLength(0);
    expect(unresolved[0]?.rawName).toBe("Mike Williams");
  });
});
