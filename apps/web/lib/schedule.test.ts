import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { gamesByTeam, normalizeTeam, parseScoreboard, SLEEPER_TEAMS } from "./schedule";

const scoreboard = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/espn-scoreboard-w1.json", import.meta.url)), "utf8"),
) as unknown;

describe("normalizeTeam", () => {
  it("passes through a canonical abbreviation", () => {
    expect(normalizeTeam("SEA")).toBe("SEA");
  });
  it("maps ESPN's Washington to Sleeper's", () => {
    expect(normalizeTeam("WSH")).toBe("WAS");
  });
  it("throws on an unknown abbreviation", () => {
    expect(() => normalizeTeam("ZZZ")).toThrow();
  });
  it("resolves every ESPN abbreviation used by the current 32 teams", () => {
    for (const espn of ["WSH", "LAR", "LAC", "LV", "JAX", "NE", "GB", "KC", "SF", "TB", "NO", "NYG", "NYJ"]) {
      expect(SLEEPER_TEAMS.has(normalizeTeam(espn))).toBe(true);
    }
  });
});

describe("parseScoreboard", () => {
  it("produces one row per event with normalized teams and a UTC kickoff", () => {
    const rows = parseScoreboard(scoreboard, "2026", 1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(SLEEPER_TEAMS.has(r.homeTeam)).toBe(true);
      expect(SLEEPER_TEAMS.has(r.awayTeam)).toBe(true);
      expect(r.kickoff.toISOString()).toMatch(/Z$/);
      expect(["scheduled", "in_progress", "final"]).toContain(r.status);
    }
  });
  it("throws on a malformed payload rather than returning []", () => {
    expect(() =>
      parseScoreboard(
        { season: { year: 2026 }, events: [{ competitions: [{}] }] },
        "2026",
        1,
      ),
    ).toThrow();
  });
  it("throws when the response's season doesn't match the requested one", () => {
    expect(() => parseScoreboard(scoreboard, "2025", 1)).toThrow(/season/i);
  });
});

describe("gamesByTeam", () => {
  it("indexes both teams of a game, with home/away and opponent", () => {
    const map = gamesByTeam([
      { kickoff: new Date("2026-09-13T17:00:00Z"), homeTeam: "GB", awayTeam: "DET", status: "scheduled" },
    ]);
    expect(map.get("GB")).toMatchObject({ opponent: "DET", home: true, status: "scheduled" });
    expect(map.get("DET")).toMatchObject({ opponent: "GB", home: false });
  });
});
