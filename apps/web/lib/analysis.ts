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
import {
  buildMyTeam,
  buildTeam,
  type MatchupPlayer,
  type MyMatchupPlayer,
  type PlayerRow,
} from "./matchup-view";
import { ensurePlatformProjections, loadPlatformPoints } from "./platform-projections";
import { loadWeekRankings, scoringOf } from "./rankings";
import { ensureNflSchedule, loadGamesByTeam } from "./schedule";

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
  opponentTeamName: string;
  expectedPoints: MatchupAnalysis;
  winProbability: MatchupAnalysis;
  waivers: WaiverScan[];
  players: Record<string, PlayerCard>;
  myTeam: MyMatchupPlayer[];
  opponentTeam: MatchupPlayer[];
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

  const season = league.season;
  // Refresh the platform projections + NFL schedule, but never let an upstream
  // outage take down the dashboard: on a cold cache both `ensure*` rethrow, so
  // isolate the failure here and fall through to whatever the readers below can
  // load. `analyzeLeague` owns this resilience call — the `ensure*` rethrow
  // contract stays intact for other callers. `Promise.allSettled` (rather than
  // `Promise.all` + try/catch) keeps one source's failure from obscuring the
  // other's, and each rejection is logged with which source it came from.
  const refreshResults = await Promise.allSettled([
    ensurePlatformProjections(season, week, scoring),
    ensureNflSchedule(season, week),
  ]);
  const REFRESH_LABELS = ["platform projections", "NFL schedule"];
  for (const [i, result] of refreshResults.entries()) {
    if (result.status === "rejected") {
      console.error(`analyzeLeague: ${REFRESH_LABELS[i]} refresh failed — degrading`, result.reason);
    }
  }
  // Both readers are a plain `select().where()` over their snapshot table with
  // no throwing post-processing — an empty table just yields an empty Map.
  const [platformPoints, gamesByTeam] = await Promise.all([
    loadPlatformPoints(season, week, scoring),
    loadGamesByTeam(season, week),
  ]);

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
  const oppRosterRow = oppMatchup
    ? allRosters.find((r) => r.sleeperRosterId === oppMatchup.roster_id)
    : undefined;

  let opponent: Projection[] = [];
  let opponentName = "league average";
  if (oppMatchup) {
    opponentName = oppRosterRow?.teamName ?? oppRosterRow?.ownerDisplayName ?? "opponent";
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

  // The full matchup view — my team (with our numbers + the sim's calls) and
  // the opponent's team (names, games, platform points only — no math).
  // `oppRosterRow` was resolved once alongside `oppMatchup` above.
  const everyId = [
    ...new Set([
      ...mine.players,
      ...mine.starters,
      ...(oppRosterRow?.players ?? []),
      ...(oppRosterRow?.starters ?? []),
    ]),
  ].filter((id) => id && id !== "0");

  const allRows: PlayerRow[] = everyId.length
    ? (
        await db().select().from(playersTable).where(inArray(playersTable.id, everyId))
      ).map((p) => ({
        id: p.id,
        fullName: p.fullName,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        team: p.team,
        injuryStatus: p.injuryStatus,
      }))
    : [];

  const ourProjections = new Map(
    roster.map((r) => [r.playerId as string, { mean: r.projection.mean, sd: r.projection.sd }]),
  );

  const rosterPositions = league.rosterPositions ?? [];
  const myTeam = buildMyTeam({
    rosterPositions,
    starters: mine.starters,
    allPlayerIds: mine.players,
    rows: allRows,
    games: gamesByTeam,
    platformPoints,
    ourProjections,
  });

  const opponentTeam = oppRosterRow
    ? buildTeam({
        rosterPositions,
        starters: oppRosterRow.starters,
        allPlayerIds: oppRosterRow.players,
        rows: allRows,
        games: gamesByTeam,
        platformPoints,
      })
    : [];

  const opponentTeamName =
    oppRosterRow?.teamName ?? oppRosterRow?.ownerDisplayName ?? "League average";

  return {
    week,
    scoring,
    opponentName,
    opponentTeamName,
    expectedPoints,
    winProbability,
    waivers,
    players,
    myTeam,
    opponentTeam,
  };
}
