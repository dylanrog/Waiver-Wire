import { describe, expect, it } from "vitest";

import { pickPoints } from "./platform-projections";

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
