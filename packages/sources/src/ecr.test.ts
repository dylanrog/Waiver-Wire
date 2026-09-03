import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EcrParseError, parseEcrData } from "./ecr";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../tests/fixtures/fantasypros/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("parseEcrData", () => {
  it("reads the DST rankings out of a real page", () => {
    const ecr = parseEcrData(fixture("rankings-dst-2026-wk1.html"));
    expect(ecr.position_id).toBe("DST");
    expect(ecr.scoring).toBe("STD");
    expect(ecr.week).toBe("1");
    expect(ecr.players).toHaveLength(ecr.count);
    expect(ecr.players[0]?.rank_ecr).toBe(1);
    expect(ecr.players[0]?.player_team_id).toBe("JAC");
    expect(ecr.players[0]?.player_position_id).toBe("DST");
  });

  it("reads a real QB page and keeps players rank-ordered", () => {
    const ecr = parseEcrData(fixture("rankings-qb-2026-wk1.html"));
    expect(ecr.position_id).toBe("QB");
    const ranks = ecr.players.map((p) => p.rank_ecr);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("reads a real RB page", () => {
    const ecr = parseEcrData(fixture("rankings-rb-2026-wk1.html"));
    expect(ecr.position_id).toBe("RB");
    expect(ecr.players.length).toBeGreaterThan(100);
  });

  it("throws when the ecrData block is absent", () => {
    expect(() => parseEcrData("<html><body>no rankings here</body></html>")).toThrow(EcrParseError);
  });

  it("throws when ecrData is not valid JSON", () => {
    expect(() => parseEcrData("var ecrData = {oops;")).toThrow(EcrParseError);
  });
});
