import { describe, expect, it } from "vitest";

import { filterKnownPlayers, pickPoints } from "./platform-projections";

describe("pickPoints", () => {
  const stats = { pts_ppr: 14, pts_half_ppr: 12, pts_std: 10 };

  it("selects the field that matches the league's scoring", () => {
    expect(pickPoints(stats, "PPR")).toBe(14);
    expect(pickPoints(stats, "HALF")).toBe(12);
    expect(pickPoints(stats, "STD")).toBe(10);
  });

  it("returns null when the matching field is absent", () => {
    expect(pickPoints({ pts_ppr: null }, "PPR")).toBeNull();
    expect(pickPoints({}, "HALF")).toBeNull();
  });
});

describe("filterKnownPlayers", () => {
  it("keeps only rows whose player_id is known", () => {
    const rows = [{ player_id: "known" }, { player_id: "unknown" }];
    expect(filterKnownPlayers(rows, new Set(["known"]))).toEqual([{ player_id: "known" }]);
  });

  it("returns [] when no ids are known", () => {
    const rows = [{ player_id: "a" }, { player_id: "b" }];
    expect(filterKnownPlayers(rows, new Set())).toEqual([]);
  });

  it("returns every row unchanged when all ids are known", () => {
    const rows = [{ player_id: "a" }, { player_id: "b" }];
    expect(filterKnownPlayers(rows, new Set(["a", "b"]))).toEqual(rows);
  });
});
