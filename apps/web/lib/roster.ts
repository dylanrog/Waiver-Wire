import { inArray } from "drizzle-orm";

import { players as playersTable } from "@waiver-wire/db";

import { db } from "./clients";

const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const EMPTY_SLOT = "0";

export interface RosterPlayerView {
  playerId: string;
  name: string;
  position: string | null;
  team: string | null;
  injuryStatus: string | null;
}

export interface StructuredRoster {
  team: {
    rosterId: number;
    teamName: string | null;
    record: { wins: number; losses: number; ties: number };
    pointsFor: number;
  };
  starters: { slot: string; player: RosterPlayerView | null }[];
  bench: RosterPlayerView[];
  ir: RosterPlayerView[];
}

interface RosterRow {
  sleeperRosterId: number;
  teamName: string | null;
  players: string[];
  starters: string[];
  reserve: string[];
  settings: Record<string, unknown> | null;
}

interface PlayerRow {
  id: string;
  fullName: string;
  position: string | null;
  team: string | null;
  injuryStatus: string | null;
}

/** Pure: assemble the roster view from DB rows. Slots come from `rosterPositions`. */
export function structureRoster(
  roster: RosterRow,
  rosterPositions: string[],
  playerRows: PlayerRow[],
): StructuredRoster {
  const byId = new Map(playerRows.map((p) => [p.id, p]));
  const view = (id: string): RosterPlayerView | null => {
    const p = byId.get(id);
    return p
      ? {
          playerId: p.id,
          name: p.fullName,
          position: p.position,
          team: p.team,
          injuryStatus: p.injuryStatus,
        }
      : null;
  };

  const startingSlots = rosterPositions.filter((s) => !BENCH_SLOTS.has(s));
  const starters = startingSlots.map((slot, i) => {
    const id = roster.starters[i];
    return { slot, player: id && id !== EMPTY_SLOT ? view(id) : null };
  });

  const started = new Set(roster.starters.filter((id) => id !== EMPTY_SLOT));
  const reserved = new Set(roster.reserve);
  const bench = roster.players
    .filter((id) => !started.has(id) && !reserved.has(id))
    .map(view)
    .filter((p): p is RosterPlayerView => p !== null);
  const ir = roster.reserve.map(view).filter((p): p is RosterPlayerView => p !== null);

  const settings = roster.settings ?? {};
  const number = (key: string): number => (typeof settings[key] === "number" ? settings[key] : 0);

  return {
    team: {
      rosterId: roster.sleeperRosterId,
      teamName: roster.teamName,
      record: { wins: number("wins"), losses: number("losses"), ties: number("ties") },
      pointsFor: number("fpts"),
    },
    starters,
    bench,
    ir,
  };
}

/** Load my roster for a selected league and structure it, or null if not synced. */
export async function getStructuredRoster(leagueId: string): Promise<StructuredRoster | null> {
  const league = await db().query.leagues.findFirst({
    where: (l, { eq }) => eq(l.id, leagueId),
  });
  if (!league) return null;

  const mine = await db().query.rosters.findFirst({
    where: (r, { and, eq }) => and(eq(r.leagueId, leagueId), eq(r.isCurrentUser, true)),
  });
  if (!mine) return null;

  const ids = [...new Set([...mine.players, ...mine.starters, ...mine.reserve])].filter(
    (id) => id && id !== EMPTY_SLOT,
  );

  const rows = ids.length
    ? await db().select().from(playersTable).where(inArray(playersTable.id, ids))
    : [];

  return structureRoster(
    {
      sleeperRosterId: mine.sleeperRosterId,
      teamName: mine.teamName,
      players: mine.players,
      starters: mine.starters,
      reserve: mine.reserve,
      settings: mine.settings,
    },
    league.rosterPositions ?? [],
    rows,
  );
}
