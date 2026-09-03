import {
  FLEX_ELIGIBLE,
  type PlayerId,
  type Position,
  type Projection,
  type Slot,
  type SourceRanking,
  type WaiverCandidate,
  type WaiverScan,
  type Week,
} from "@waiver-wire/shared";

import { rankCurves, type RankCurves } from "./curves";
import { rankToProjection } from "./projection";

export interface WaiverStarter {
  slot: Slot;
  playerId: PlayerId;
  position: Position;
  projection: Projection;
}

export interface WaiverScanInput {
  week: Week;
  /** Every ranked player from the source for this week. */
  rankings: SourceRanking[];
  /** Sleeper ids rostered by anyone in the league. */
  rosteredPlayerIds: Set<string>;
  /** My current starter in each slot, for the upgrade comparison. */
  myStarters: WaiverStarter[];
  /** Which slots to scan. */
  slots: Slot[];
  curves?: RankCurves;
  /** Max candidates per slot (WaiverScan caps at 5). */
  limit?: number;
}

function positionsForSlot(slot: Slot): Position[] {
  if (slot === "FLEX") return [...FLEX_ELIGIBLE];
  if (slot === "BENCH") return [];
  return [slot];
}

/**
 * Per requested slot: this week's ranked players at the slot's position(s),
 * minus everyone rostered anywhere, re-ranked by projection, top N. Each carries
 * its projected gain over the current starter (MVP.md §3).
 */
export function waiverScan(input: WaiverScanInput): WaiverScan[] {
  const curves = input.curves ?? rankCurves;
  const limit = Math.min(input.limit ?? 5, 5);

  return input.slots.map((slot) => {
    const positions = positionsForSlot(slot);
    const current = input.myStarters.find((s) => s.slot === slot) ?? null;
    const currentMean = current?.projection.mean ?? 0;

    const candidates: WaiverCandidate[] = input.rankings
      .filter((r) => positions.includes(r.position) && !input.rosteredPlayerIds.has(r.playerId))
      .map((ranking): WaiverCandidate => {
        const projection = rankToProjection(ranking, curves);
        return {
          playerId: ranking.playerId,
          position: ranking.position,
          rank: ranking.rank,
          source: ranking.source,
          projection,
          upgradeOverCurrent: projection.mean - currentMean,
          currentStarter: current?.playerId ?? null,
        };
      })
      .sort((a, b) => b.projection.mean - a.projection.mean)
      .slice(0, limit);

    return { week: input.week, slot, candidates };
  });
}
