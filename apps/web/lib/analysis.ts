import { eq, inArray } from "drizzle-orm";

import { players as playersTable, rosters as rostersTable } from "@waiver-wire/db";
import {
  analyzeMatchup,
  rankCurves,
  rankToProjection,
  waiverScan,
  type RosterEntry,
} from "@waiver-wire/projections";
import type {
  MatchupAnalysis,
  PlayerId,
  Position,
  Projection,
  SimConfig,
  Slot,
  SourceRanking,
  WaiverScan,
} from "@waiver-wire/shared";

import { db, sleeper } from "./clients";
import { loadWeekRankings, scoringOf } from "./rankings";

const BENCH_SLOTS = new Set(["BN", "IR", "TAXI"]);
const FANTASY_POSITIONS = new Set<Position>(["QB", "RB", "WR", "TE", "K", "DST"]);
const SIM: Omit<SimConfig, "objective"> = { iterations: 10_000, seed: 42 };

/** A "typical starter" rank per position — the league-average opponent. */
const AVERAGE_RANK: Record<Position, number> = { QB: 8, RB: 18, WR: 24, TE: 8, K: 8, DST: 8 };

const toDomainPosition = (raw: string | null): Position | null =>
  raw === "DEF" ? "DST" : FANTASY_POSITIONS.has(raw as Position) ? (raw as Position) : null;

const toSlot = (raw: string): Slot => (raw === "DEF" ? "DST" : (raw as Slot));

export interface PlayerCard {
  name: string;
  position: string | null;
  team: string | null;
}

export interface FullAnalysis {
  week: number;
  scoring: string;
  opponentName: string;
  expectedPoints: MatchupAnalysis;
  winProbability: MatchupAnalysis;
  waivers: WaiverScan[];
  players: Record<string, PlayerCard>;
}

function averageOpponent(slots: Slot[]): Projection[] {
  return slots.flatMap((slot) => {
    const position: Position = slot === "FLEX" ? "RB" : (slot as Position);
    if (!FANTASY_POSITIONS.has(position)) return [];
    const stat = rankCurves[position][String(AVERAGE_RANK[position])];
    if (!stat) return [];
    return [
      {
        playerId: `avg-${slot}` as PlayerId,
        mean: stat.mean,
        sd: stat.sd,
        basis: { source: "fantasypros" as const, positionRank: AVERAGE_RANK[position] },
      },
    ];
  });
}

/** The whole matchup + waiver picture for a selected league. */
export async function analyzeLeague(leagueId: string): Promise<FullAnalysis | null> {
  const league = await db().query.leagues.findFirst({ where: (l, { eq: e }) => e(l.id, leagueId) });
  const mine = await db().query.rosters.findFirst({
    where: (r, { and, eq: e }) => and(e(r.leagueId, leagueId), e(r.isCurrentUser, true)),
  });
  if (!league || !mine) return null;

  const allRosters = await db()
    .select()
    .from(rostersTable)
    .where(eq(rostersTable.leagueId, leagueId));
  const state = await sleeper().getState();
  const week = state.week;
  const scoring = scoringOf(league.scoringSettings);
  const { rankings } = await loadWeekRankings(week, scoring);

  const rankingByPlayer = new Map<string, SourceRanking>(rankings.map((r) => [r.playerId, r]));
  const rosteredPlayerIds = new Set(allRosters.flatMap((r) => r.players));

  const myIds = [...new Set([...mine.players, ...mine.starters])].filter((id) => id && id !== "0");
  const myPlayerRows = myIds.length
    ? await db().select().from(playersTable).where(inArray(playersTable.id, myIds))
    : [];
  const positionOf = new Map(myPlayerRows.map((p) => [p.id, toDomainPosition(p.position)]));

  const roster: RosterEntry[] = mine.players
    .filter((id) => id && id !== "0")
    .flatMap((id) => {
      const position = positionOf.get(id) ?? null;
      if (position === null) return [];
      const ranking = rankingByPlayer.get(id);
      const projection: Projection = ranking
        ? rankToProjection(ranking, rankCurves)
        : {
            playerId: id as PlayerId,
            mean: 0,
            sd: 0,
            basis: { source: "fantasypros", positionRank: 999 },
          };
      return [{ playerId: id as PlayerId, position, projection, onBye: ranking === undefined }];
    });

  const startingRosterSlots = (league.rosterPositions ?? []).filter((s) => !BENCH_SLOTS.has(s));
  const slots = startingRosterSlots.map(toSlot);
  const currentStarters: (PlayerId | null)[] = startingRosterSlots.map((_, i) => {
    const id = mine.starters[i];
    return id && id !== "0" ? (id as PlayerId) : null;
  });

  // Opponent — this week's actual matchup, else a league-average lineup.
  const matchups = await sleeper()
    .getMatchups(leagueId, week)
    .catch(() => []);
  const myMatchup = matchups.find((m) => m.roster_id === mine.sleeperRosterId);
  const oppMatchup =
    myMatchup?.matchup_id != null
      ? matchups.find(
          (m) => m.matchup_id === myMatchup.matchup_id && m.roster_id !== mine.sleeperRosterId,
        )
      : undefined;

  let opponent: Projection[] = [];
  let opponentName = "league average";
  if (oppMatchup) {
    const oppRoster = allRosters.find((r) => r.sleeperRosterId === oppMatchup.roster_id);
    opponentName = oppRoster?.teamName ?? oppRoster?.ownerDisplayName ?? "opponent";
    opponent = oppMatchup.starters
      .filter((id) => id && id !== "0")
      .flatMap((id) => {
        const r = rankingByPlayer.get(id);
        return r ? [rankToProjection(r, rankCurves)] : [];
      });
  }
  if (opponent.length === 0) opponent = averageOpponent(slots);

  const base = { week, slots, roster, currentStarters, opponent };
  const expectedPoints = analyzeMatchup({
    ...base,
    config: { ...SIM, objective: "expected_points" },
  });
  const winProbability = analyzeMatchup({
    ...base,
    config: { ...SIM, objective: "win_probability" },
  });

  const myStarters = winProbability.calls.map((call) => ({
    slot: call.slot,
    playerId: call.recommended,
    position: roster.find((r) => r.playerId === call.recommended)?.position ?? ("RB" as Position),
    projection: call.projection,
  }));
  const waivers = waiverScan({
    week,
    rankings,
    rosteredPlayerIds,
    myStarters,
    slots:
      winProbability.weakSlots.length > 0
        ? winProbability.weakSlots
        : slots.filter((s) => s !== "FLEX"),
  });

  // Names for everything referenced in the response.
  const referenced = new Set<string>([
    ...roster.map((r) => r.playerId),
    ...currentStarters.filter((id): id is PlayerId => id !== null),
    ...waivers.flatMap((w) => w.candidates.map((c) => c.playerId)),
  ]);
  const nameRows = referenced.size
    ? await db()
        .select()
        .from(playersTable)
        .where(inArray(playersTable.id, [...referenced]))
    : [];
  const players: Record<string, PlayerCard> = {};
  for (const p of nameRows)
    players[p.id] = { name: p.fullName, position: p.position, team: p.team };

  return { week, scoring, opponentName, expectedPoints, winProbability, waivers, players };
}
