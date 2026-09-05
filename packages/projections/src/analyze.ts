import {
  FLEX_ELIGIBLE,
  type MatchupAnalysis,
  type PlayerId,
  type Position,
  type Projection,
  type SimConfig,
  type Slot,
  type StartSitCall,
  type Week,
} from "@waiver-wire/shared";

import { evaluateAgainstBench, evaluateSlot, type SlotCandidate } from "./calls";
import { rankCurves, type RankCurves } from "./curves";
import { type RosterEntry } from "./lineup";
import { simulateMatchup } from "./sim";

export interface AnalyzeInput {
  week: Week;
  /** Starting slots, in order (roster_positions minus BN / IR / TAXI). */
  slots: Slot[];
  /** Every player on my roster, with a projection. */
  roster: RosterEntry[];
  /** Who Sleeper currently has in each slot, aligned to `slots`. */
  currentStarters: (PlayerId | null)[];
  /** The opponent's projected starting lineup. */
  opponent: Projection[];
  config: SimConfig;
  curves?: RankCurves;
}

/** A slot is weak if even its best option projects below a startable baseline. */
const REPLACEMENT_RANK: Record<Position, number> = {
  QB: 18,
  RB: 36,
  WR: 48,
  TE: 18,
  K: 18,
  DST: 18,
};

function eligibleFor(slot: Slot, position: Position): boolean {
  return slot === "FLEX" ? FLEX_ELIGIBLE.includes(position) : slot === position;
}

function replacementMean(position: Position, curves: RankCurves): number {
  const curve = curves[position];
  const rank = String(REPLACEMENT_RANK[position]);
  return curve[rank]?.mean ?? 0;
}

/**
 * The whole matchup: the objective-optimal lineup, a start/sit call per slot
 * (with `confidenceUnderOtherObjective` from running the other toggle state), the
 * simulated score distributions, win probability, and which slots are weak enough
 * to warrant a waiver scan.
 */
export function analyzeMatchup(input: AnalyzeInput): MatchupAnalysis {
  const curves = input.curves ?? rankCurves;
  const byId = new Map(input.roster.map((r) => [r.playerId, r]));

  const calls: StartSitCall[] = [];
  const recommendedByProjection: Projection[] = [];
  /** Players already locked into an earlier slot — can't start twice. */
  const used = new Set<string>();

  input.slots.forEach((slot, index) => {
    const candidates: SlotCandidate[] = input.roster
      .filter((r) => eligibleFor(slot, r.position) && !used.has(r.playerId))
      .map((r) => ({
        playerId: r.playerId,
        position: r.position,
        projection: r.projection,
        onBye: r.onBye,
      }));
    if (candidates.every((c) => c.onBye)) return;

    // "Rest" = earlier slots' recommended players, plus a best-guess for the
    // slots not yet decided (their best still-available non-bye candidate).
    const pencilled = new Set(used);
    const rest: Projection[] = [
      ...recommendedByProjection,
      ...input.slots.slice(index + 1).flatMap((laterSlot) => {
        const pick = input.roster
          .filter(
            (r) => !r.onBye && eligibleFor(laterSlot, r.position) && !pencilled.has(r.playerId),
          )
          .sort((a, b) => b.projection.mean - a.projection.mean)[0];
        if (pick) pencilled.add(pick.playerId);
        return pick ? [pick.projection] : [];
      }),
    ];

    const call = evaluateSlot({
      slot,
      candidates,
      currentStarterId: input.currentStarters[index] ?? null,
      rest,
      opponent: input.opponent,
      objective: input.config.objective,
      config: input.config,
    });
    calls.push(call);
    recommendedByProjection.push(call.projection);
    used.add(call.recommended);
  });

  // Pass 2: recompute each call's alternative/confidence against the best
  // genuinely-benched player for that slot — never another starter. `used`
  // now holds every slot's final recommended player (pass 1 is complete), so
  // this can use the real rest of the lineup instead of the mid-walk
  // "pencilled guess" pass 1 needed while slots were still undecided.
  calls.forEach((call, index) => {
    const benchCandidates: SlotCandidate[] = input.roster
      .filter((r) => eligibleFor(call.slot, r.position) && !used.has(r.playerId))
      .map((r) => ({
        playerId: r.playerId,
        position: r.position,
        projection: r.projection,
        onBye: r.onBye,
      }));
    const rest = recommendedByProjection.filter((_, i) => i !== index);
    const bench = evaluateAgainstBench({
      slot: call.slot,
      recommended: call.projection,
      benchCandidates,
      rest,
      opponent: input.opponent,
      objective: input.config.objective,
      config: input.config,
    });
    calls[index] = { ...call, ...bench };
  });

  const sim = simulateMatchup(recommendedByProjection, input.opponent, input.config);

  const weakSlots = calls
    .filter((call) => {
      const entry = byId.get(call.recommended);
      return entry !== undefined && call.projection.mean < replacementMean(entry.position, curves);
    })
    .map((call) => call.slot);

  return {
    week: input.week,
    objective: input.config.objective,
    myScore: sim.myScore,
    opponentScore: sim.opponentScore,
    winProbability: sim.winProbability,
    calls,
    weakSlots,
  };
}
