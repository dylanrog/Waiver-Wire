import type {
  Objective,
  PlayerId,
  Position,
  Projection,
  SimConfig,
  Slot,
  StartSitCall,
} from "@waiver-wire/shared";

import { normal, seededRng } from "./rng";
import { drawTeamTotal } from "./sim";

export interface SlotCandidate {
  playerId: PlayerId;
  position: Position;
  projection: Projection;
  onBye: boolean;
}

export interface SlotInput {
  slot: Slot;
  candidates: SlotCandidate[];
  currentStarterId: PlayerId | null;
  /** The other starters, held fixed while this slot is decided. */
  rest: Projection[];
  opponent: Projection[];
  objective: Objective;
  config: SimConfig;
}

function otherObjective(objective: Objective): Objective {
  return objective === "win_probability" ? "expected_points" : "win_probability";
}

/**
 * One iteration's "team outcome" for a slot player: raw points under
 * expected_points, or 1/0 for beating the opponent under win_probability.
 */
function outcome(objective: Objective, teamTotal: number, opponentTotal: number): number {
  return objective === "win_probability" ? (teamTotal > opponentTotal ? 1 : 0) : teamTotal;
}

/** Mean team outcome with `player` in the slot — the value being maximized. */
function scoreCandidate(
  player: Projection,
  input: Pick<SlotInput, "rest" | "opponent" | "config">,
  objective: Objective,
): number {
  const rng = seededRng(input.config.seed);
  let total = 0;
  for (let i = 0; i < input.config.iterations; i++) {
    const restTotal = drawTeamTotal(rng, input.rest);
    const opponentTotal = drawTeamTotal(rng, input.opponent);
    const teamTotal = restTotal + normal(rng, player.mean, player.sd);
    total += outcome(objective, teamTotal, opponentTotal);
  }
  return total / input.config.iterations;
}

/**
 * Fraction of simulations where starting `recommended` produced a better team
 * outcome than `alternative` (ARCHITECTURE.md). Paired — same rest/opponent draws
 * each iteration; ties split. 0.5 means the choice barely matters.
 */
function pairedConfidence(
  recommended: Projection,
  alternative: Projection,
  input: Pick<SlotInput, "rest" | "opponent" | "config">,
  objective: Objective,
): number {
  const rng = seededRng(input.config.seed);
  let better = 0;
  for (let i = 0; i < input.config.iterations; i++) {
    const restTotal = drawTeamTotal(rng, input.rest);
    const opponentTotal = drawTeamTotal(rng, input.opponent);
    const recTotal = restTotal + normal(rng, recommended.mean, recommended.sd);
    const altTotal = restTotal + normal(rng, alternative.mean, alternative.sd);
    const rec = outcome(objective, recTotal, opponentTotal);
    const alt = outcome(objective, altTotal, opponentTotal);
    if (rec > alt) better += 1;
    else if (rec === alt) better += 0.5;
  }
  return better / input.config.iterations;
}

/**
 * Decide one lineup slot: who to start, the best alternative, and how confident
 * the call is — under the active objective and under the toggle's other state.
 */
export function evaluateSlot(input: SlotInput): StartSitCall {
  const eligible = input.candidates.filter((c) => !c.onBye);
  if (eligible.length === 0) {
    throw new Error(`slot ${input.slot} has no startable candidate`);
  }

  const ranked = [...eligible]
    .map((c) => ({ candidate: c, score: scoreCandidate(c.projection, input, input.objective) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]!.candidate;
  const runnerUp = ranked[1]?.candidate ?? null;

  const confidence = runnerUp
    ? pairedConfidence(best.projection, runnerUp.projection, input, input.objective)
    : 1;
  const confidenceUnderOtherObjective = runnerUp
    ? pairedConfidence(best.projection, runnerUp.projection, input, otherObjective(input.objective))
    : 1;

  return {
    slot: input.slot,
    recommended: best.playerId,
    current: input.currentStarterId,
    confidence,
    alternative: runnerUp?.playerId ?? null,
    confidenceUnderOtherObjective,
    projection: best.projection,
  };
}

export interface BenchAlternativeInput {
  slot: Slot;
  /** The starter already decided for this slot — compared against, never re-ranked. */
  recommended: Projection;
  /** Players not recommended anywhere in the final lineup, eligible for this slot. */
  benchCandidates: SlotCandidate[];
  /** Every other slot's real recommended player — the true rest of the team. */
  rest: Projection[];
  opponent: Projection[];
  objective: Objective;
  config: SimConfig;
}

export interface BenchAlternativeResult {
  alternative: PlayerId | null;
  confidence: number;
  confidenceUnderOtherObjective: number;
}

/**
 * How confident should we be that `recommended` beats the best player still on
 * the bench for this slot? `benchCandidates` must never include another
 * starter — that's the bug (ARCHITECTURE.md "Confidence score") this exists
 * to avoid: comparing a starter to a fellow starter measures slot assignment,
 * not whether the decision matters.
 */
export function evaluateAgainstBench(input: BenchAlternativeInput): BenchAlternativeResult {
  const eligible = input.benchCandidates.filter((c) => !c.onBye);
  if (eligible.length === 0) {
    return { alternative: null, confidence: 1, confidenceUnderOtherObjective: 1 };
  }

  const best = eligible
    .map((c) => ({ candidate: c, score: scoreCandidate(c.projection, input, input.objective) }))
    .sort((a, b) => b.score - a.score)[0]!.candidate;

  return {
    alternative: best.playerId,
    confidence: pairedConfidence(input.recommended, best.projection, input, input.objective),
    confidenceUnderOtherObjective: pairedConfidence(
      input.recommended,
      best.projection,
      input,
      otherObjective(input.objective),
    ),
  };
}
