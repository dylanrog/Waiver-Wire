import { PlayerId, type Objective, type Projection, type SimConfig } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import { evaluateAgainstBench, evaluateSlot, type SlotCandidate } from "./calls";

let seq = 0;
function proj(mean: number, sd: number): Projection {
  seq += 1;
  return {
    playerId: PlayerId.parse(`x${seq}`),
    mean,
    sd,
    basis: { source: "fantasypros", positionRank: 1 },
  };
}
function candidate(mean: number, sd: number, onBye = false): SlotCandidate {
  const projection = proj(mean, sd);
  return { playerId: projection.playerId, position: "WR", projection, onBye };
}
function team(...totals: number[]): Projection[] {
  return totals.map((t) => proj(t, 3));
}

const config: SimConfig = { objective: "win_probability", iterations: 20_000, seed: 42 };
const run = (over: Partial<Parameters<typeof evaluateSlot>[0]>) =>
  evaluateSlot({
    slot: "FLEX",
    currentStarterId: null,
    rest: team(),
    opponent: team(),
    objective: "win_probability" as Objective,
    config,
    candidates: [],
    ...over,
  });

describe("evaluateSlot — win probability objective", () => {
  const steady = candidate(12, 2);
  const volatile = candidate(11, 9);

  it("an underdog starts the higher-variance player", () => {
    const call = run({
      candidates: [steady, volatile],
      rest: team(80), // my team ~92 vs opp ~100: variance is the only path
      opponent: team(50, 50),
      objective: "win_probability",
    });
    expect(call.recommended).toBe(volatile.playerId);
  });

  it("a favorite starts the lower-variance player", () => {
    const call = run({
      candidates: [steady, volatile],
      rest: team(60), // my team ~72 vs opp ~60: protect the lead
      opponent: team(30, 30),
      objective: "win_probability",
    });
    expect(call.recommended).toBe(steady.playerId);
  });

  it("two identical players produce a confidence near 0.5", () => {
    const a = candidate(13, 4);
    const b = candidate(13, 4);
    const call = run({
      candidates: [a, b],
      rest: team(45, 45),
      opponent: team(45, 45),
    });
    expect(call.confidence).toBeGreaterThan(0.44);
    expect(call.confidence).toBeLessThan(0.56);
  });

  it("never recommends a player on bye, even the highest projected", () => {
    const bye = candidate(30, 6, true);
    const active = candidate(9, 3);
    const call = run({ candidates: [bye, active], rest: team(50, 50), opponent: team(50) });
    expect(call.recommended).toBe(active.playerId);
    expect(call.alternative).toBeNull();
  });
});

describe("evaluateSlot — expected points objective", () => {
  it("picks the higher mean and fills confidenceUnderOtherObjective from the toggle", () => {
    const call = run({
      candidates: [candidate(12, 2), candidate(11, 9)],
      rest: team(80),
      opponent: team(50, 50),
      objective: "expected_points",
    });
    // expected points: the steady 12 wins the mean. But as an underdog under the
    // other objective (win probability) you'd rather gamble on the volatile 11 —
    // so this same recommendation is a coin flip there.
    expect(call.confidence).toBeGreaterThan(0.5);
    expect(call.confidenceUnderOtherObjective).toBeLessThan(0.5);
  });
});

describe("evaluateAgainstBench", () => {
  const recommended = candidate(20, 6).projection; // the already-decided starter

  it("returns undisputed (confidence 1, no alternative) with an empty bench", () => {
    const result = evaluateAgainstBench({
      slot: "RB",
      recommended,
      benchCandidates: [],
      rest: team(45, 45),
      opponent: team(90),
      objective: "win_probability",
      config,
    });
    expect(result.alternative).toBeNull();
    expect(result.confidence).toBe(1);
    expect(result.confidenceUnderOtherObjective).toBe(1);
  });

  it("compares recommended against the best bench candidate, not the worst", () => {
    const weakBench = candidate(4, 3);
    const strongBench = candidate(11, 5);
    const result = evaluateAgainstBench({
      slot: "RB",
      recommended,
      benchCandidates: [weakBench, strongBench],
      rest: team(45, 45),
      opponent: team(45, 45),
      objective: "win_probability",
      config,
    });
    expect(result.alternative).toBe(strongBench.playerId);
  });

  it("never proposes a bye-week player as the alternative", () => {
    const onBye = candidate(30, 6, true);
    const active = candidate(6, 3);
    const result = evaluateAgainstBench({
      slot: "RB",
      recommended,
      benchCandidates: [onBye, active],
      rest: team(45, 45),
      opponent: team(45, 45),
      objective: "win_probability",
      config,
    });
    expect(result.alternative).toBe(active.playerId);
  });

  it("a clearly worse bench option produces confidence near 1, not a coin flip", () => {
    const bench = candidate(3, 3);
    const result = evaluateAgainstBench({
      slot: "RB",
      recommended, // mean 20
      benchCandidates: [bench], // mean 3
      rest: team(45, 45),
      opponent: team(45, 45),
      objective: "win_probability",
      config,
    });
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});
