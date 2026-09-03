import { describe, expect, it } from "vitest";

import { buildCurves } from "./curves";

describe("buildCurves", () => {
  it("computes mean and population sd of points at each positional rank", () => {
    const curves = buildCurves(
      [
        { position: "QB", scores: [30, 20, 10] },
        { position: "QB", scores: [10, 20, 30] }, // order shouldn't matter — sorted desc
        { position: "QB", scores: [20, 20, 20] },
      ],
      { QB: 3 },
      1,
    );

    // rank 1 samples: 30, 30, 20 -> mean 26.67
    expect(curves.QB?.["1"]?.mean).toBeCloseTo(26.67);
    // rank 2 samples: 20, 20, 20 -> mean 20, sd 0
    expect(curves.QB?.["2"]).toEqual({ mean: 20, sd: 0 });
  });

  it("stops emitting ranks once observations fall below the minimum", () => {
    const curves = buildCurves(
      [
        { position: "RB", scores: [10, 5] },
        { position: "RB", scores: [12] }, // only one week reaches rank 2
      ],
      { RB: 5 },
      2,
    );
    expect(Object.keys(curves.RB ?? {})).toEqual(["1"]);
  });

  it("records sample counts in __meta__ without polluting the position curves", () => {
    const curves = buildCurves([{ position: "K", scores: [8, 6] }], { K: 2 }, 1);
    expect(curves.__meta__?.sampleCounts).toEqual({ K: { "1": 1, "2": 1 } });
    expect(curves.K).toEqual({ "1": { mean: 8, sd: 0 }, "2": { mean: 6, sd: 0 } });
  });
});
