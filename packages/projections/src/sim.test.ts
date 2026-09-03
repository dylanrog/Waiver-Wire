import { PlayerId, type Projection, type SimConfig } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { simulateMatchup } from "./sim";

let id = 0;
function proj(mean: number, sd: number): Projection {
  id += 1;
  return {
    playerId: PlayerId.parse(`p${id}`),
    mean,
    sd,
    basis: { source: "fantasypros", positionRank: 1 },
  };
}

const config: SimConfig = { objective: "win_probability", iterations: 20_000, seed: 42 };

describe("simulateMatchup", () => {
  it("is deterministic for a fixed seed", () => {
    const a = simulateMatchup([proj(15, 5)], [proj(14, 5)], config);
    const b = simulateMatchup([proj(15, 5)], [proj(14, 5)], config);
    expect(a).toEqual(b);
  });

  it("gives ~50% win probability to evenly matched teams", () => {
    const team = [proj(20, 6), proj(15, 5), proj(10, 4)];
    const opp = [proj(20, 6), proj(15, 5), proj(10, 4)];
    expect(simulateMatchup(team, opp, config).winProbability).toBeCloseTo(0.5, 1);
  });

  it("gives a big favorite a win probability near 1", () => {
    const wp = simulateMatchup([proj(120, 8)], [proj(90, 8)], config).winProbability;
    expect(wp).toBeGreaterThan(0.98);
  });

  it("summarizes each side as an ordered distribution", () => {
    const { myScore } = simulateMatchup([proj(50, 10), proj(30, 8)], [proj(80, 10)], config);
    expect(myScore.p10).toBeLessThan(myScore.p50);
    expect(myScore.p50).toBeLessThan(myScore.p90);
    expect(myScore.mean).toBeCloseTo(80, 0);
  });

  it("lets variance rescue an underdog", () => {
    const steady = simulateMatchup([proj(88, 3)], [proj(100, 6)], config).winProbability;
    const volatile = simulateMatchup([proj(88, 30)], [proj(100, 6)], config).winProbability;
    expect(volatile).toBeGreaterThan(steady + 0.1);
  });
});
