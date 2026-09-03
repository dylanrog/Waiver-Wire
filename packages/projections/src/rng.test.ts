import { describe, expect, it } from "vitest";

import { normal, seededRng } from "./rng";

describe("seededRng", () => {
  it("is deterministic for a given seed", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    expect(seededRng(1)()).not.toEqual(seededRng(2)());
  });

  it("stays in [0, 1)", () => {
    const rng = seededRng(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("normal", () => {
  it("recovers the target mean and sd over many draws", () => {
    const rng = seededRng(123);
    const n = 50_000;
    let sum = 0;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = normal(rng, 10, 3);
      xs.push(x);
      sum += x;
    }
    const mean = sum / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeCloseTo(3, 1);
  });

  it("returns the mean exactly when sd is 0", () => {
    const rng = seededRng(1);
    expect(normal(rng, 7.5, 0)).toBe(7.5);
  });
});
