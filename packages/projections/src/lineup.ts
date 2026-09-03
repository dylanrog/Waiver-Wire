import {
  FLEX_ELIGIBLE,
  type LineupSlot,
  type PlayerId,
  type Position,
  type Projection,
  type Slot,
} from "@waiver-wire/shared";

export interface RosterEntry {
  playerId: PlayerId;
  position: Position;
  projection: Projection;
  onBye: boolean;
}

function bestBy<T>(items: readonly T[], value: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestValue = -Infinity;
  for (const item of items) {
    const v = value(item);
    if (v > bestValue) {
      best = item;
      bestValue = v;
    }
  }
  return best;
}

/**
 * The highest-expected-points lineup that honors position and FLEX eligibility.
 * Dedicated slots take the best player at that exact position; each FLEX then
 * takes the best remaining RB/WR/TE. Greedy is optimal for a sum of means with
 * one flex tier. Players on bye are skipped; an unfillable slot gets `null`.
 * Slots come back in the order given (minus BENCH).
 */
export function optimalLineup(
  slots: readonly Slot[],
  roster: readonly RosterEntry[],
): LineupSlot[] {
  const pool = roster.filter((r) => !r.onBye);
  const used = new Set<string>();
  const filled = new Map<number, PlayerId>();

  const fill = (index: number, eligible: (r: RosterEntry) => boolean): void => {
    const pick = bestBy(
      pool.filter((r) => !used.has(r.playerId) && eligible(r)),
      (r) => r.projection.mean,
    );
    if (pick) {
      used.add(pick.playerId);
      filled.set(index, pick.playerId);
    }
  };

  slots.forEach((slot, index) => {
    if (slot !== "FLEX" && slot !== "BENCH") fill(index, (r) => r.position === slot);
  });
  slots.forEach((slot, index) => {
    if (slot === "FLEX") fill(index, (r) => FLEX_ELIGIBLE.includes(r.position));
  });

  return slots
    .map((slot, index) => ({ slot, playerId: filled.get(index) ?? null }))
    .filter((entry) => entry.slot !== "BENCH");
}
