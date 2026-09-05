import { describe, expect, it } from "vitest";

import { confidenceColor, pct } from "./confidence";

describe("confidenceColor", () => {
  it("0 is the amber (low) ramp end", () => {
    expect(confidenceColor(0)).toBe("rgb(198 138 59)");
  });

  it("1 is the teal (high) ramp end", () => {
    expect(confidenceColor(1)).toBe("rgb(63 168 143)");
  });
});

describe("pct", () => {
  it("rounds a fraction to a whole-percent string", () => {
    expect(pct(0.684)).toBe("68%");
  });
});
