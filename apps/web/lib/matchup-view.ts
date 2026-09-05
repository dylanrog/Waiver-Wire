import type { Position, Slot } from "@waiver-wire/shared";

import type { TeamGame } from "./schedule";

const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const EMPTY = "0";

export type GameLine = TeamGame | null;

export interface PlayerRow {
  id: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  team: string | null;
  injuryStatus: string | null;
}

export interface MatchupPlayer {
  playerId: string;
  slot: Slot;
  position: Position | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  team: string | null;
  injuryStatus: string | null;
  game: GameLine;
  platformPoints: number | null;
}

export interface MyMatchupPlayer extends MatchupPlayer {
  ourProjection: { mean: number; sd: number } | null;
}

const FANTASY = new Set(["QB", "RB", "WR", "TE", "K", "DST"]);
const toPosition = (raw: string | null): Position | null =>
  raw === "DEF" ? "DST" : FANTASY.has(raw ?? "") ? (raw as Position) : null;
const toSlot = (raw: string): Slot => (raw === "DEF" ? "DST" : (raw as Slot));

interface BaseArgs {
  rosterPositions: string[];
  starters: string[];
  allPlayerIds: string[];
  rows: PlayerRow[];
  games: Map<string, TeamGame>;
  platformPoints: Map<string, number>;
}

function order(args: BaseArgs): { id: string; slot: Slot }[] {
  const startingSlots = args.rosterPositions.filter((s) => !BENCH_SLOTS.has(s));
  const started = new Set<string>();
  const starters = startingSlots.flatMap((slot, i) => {
    const id = args.starters[i];
    if (!id || id === EMPTY) return [];
    started.add(id);
    return [{ id, slot: toSlot(slot) }];
  });
  const bench = args.allPlayerIds
    .filter((id) => id && id !== EMPTY && !started.has(id))
    .map((id) => ({ id, slot: "BENCH" as Slot }));
  return [...starters, ...bench];
}

function base(entry: { id: string; slot: Slot }, args: BaseArgs, byId: Map<string, PlayerRow>): MatchupPlayer {
  const row = byId.get(entry.id);
  const team = row?.team ?? null;
  return {
    playerId: entry.id,
    slot: entry.slot,
    position: toPosition(row?.position ?? null),
    firstName: row?.firstName ?? null,
    lastName: row?.lastName ?? null,
    fullName: row?.fullName ?? entry.id,
    team,
    injuryStatus: row?.injuryStatus ?? null,
    game: team ? (args.games.get(team) ?? null) : null,
    platformPoints: args.platformPoints.get(entry.id) ?? null,
  };
}

export function buildTeam(args: BaseArgs): MatchupPlayer[] {
  const byId = new Map(args.rows.map((r) => [r.id, r]));
  return order(args).map((entry) => base(entry, args, byId));
}

export function buildMyTeam(
  args: BaseArgs & {
    ourProjections: Map<string, { mean: number; sd: number }>;
  },
): MyMatchupPlayer[] {
  const byId = new Map(args.rows.map((r) => [r.id, r]));

  return order(args).map((entry) => ({
    ...base(entry, args, byId),
    ourProjection: args.ourProjections.get(entry.id) ?? null,
  }));
}
