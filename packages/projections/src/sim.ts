import type { Distribution, Projection, SimConfig } from "@waiver-wire/shared";

import { normal, seededRng } from "./rng";

export interface MatchupSim {
  myScore: Distribution;
  opponentScore: Distribution;
  winProbability: number;
}

/** One simulated team total: independent normal draws, summed (ARCHITECTURE.md). */
export function drawTeamTotal(rng: () => number, projections: readonly Projection[]): number {
  let total = 0;
  for (const projection of projections) {
    total += normal(rng, projection.mean, projection.sd);
  }
  return total;
}

export function summarize(samples: readonly number[]): Distribution {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const percentile = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
  return { mean, p10: percentile(0.1), p50: percentile(0.5), p90: percentile(0.9) };
}

/**
 * Simulate a head-to-head. Both sides are drawn from one deterministic stream so
 * the result is reproducible for a given seed. Ties split half a win.
 */
export function simulateMatchup(
  mine: readonly Projection[],
  opponent: readonly Projection[],
  config: SimConfig,
): MatchupSim {
  const rng = seededRng(config.seed);
  const myTotals: number[] = new Array<number>(config.iterations);
  const opponentTotals: number[] = new Array<number>(config.iterations);
  let wins = 0;
  let ties = 0;

  for (let i = 0; i < config.iterations; i++) {
    const mineTotal = drawTeamTotal(rng, mine);
    const opponentTotal = drawTeamTotal(rng, opponent);
    myTotals[i] = mineTotal;
    opponentTotals[i] = opponentTotal;
    if (mineTotal > opponentTotal) wins += 1;
    else if (mineTotal === opponentTotal) ties += 1;
  }

  return {
    myScore: summarize(myTotals),
    opponentScore: summarize(opponentTotals),
    winProbability: (wins + 0.5 * ties) / config.iterations,
  };
}
