import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildPredictiveCurves, type PlayerWeek } from "./src/curves";
import { DATASETS, loadCsv, requireColumns } from "./src/nflverse";
import { dstPoints, HALF_PPR, kickerPoints, offensePoints } from "./src/scoring";

/**
 * Build packages/projections/data/rank_curves.json — positional rank → mean and
 * standard deviation of weekly fantasy points, from three past seasons of
 * nflverse data. Offline; the JSON is committed and must never run at request
 * time. See docs/ARCHITECTURE.md "The projection problem" and the method note in
 * packages/projections/data/README.md.
 *
 *   pnpm --filter @waiver-wire/scripts rank-curves
 */

const SEASONS = [2022, 2023, 2024];
const SCORING = HALF_PPR;

const CURVE_OPTIONS = {
  /** A player needs this many prior games before we'll rank him. */
  minTrailingGames: 2,
  /** First week used as a target — weeks 1–3 only build trailing form. */
  firstTargetWeek: 4,
  /** Drop a rank once it has fewer than this many weeks of data. */
  minObservations: 20,
};

/** How deep to publish each position — roughly where start/sit/waiver decisions stop. */
const RANK_CAPS: Record<string, number> = { QB: 40, RB: 72, WR: 96, TE: 40, K: 36, DST: 32 };

const OFFENSE_POSITIONS = new Set(["QB", "RB", "WR", "TE", "FB"]);
const domainPosition = (raw: string): string => (raw === "FB" ? "RB" : raw);

async function pointsAllowedByGameTeam(): Promise<Map<string, number>> {
  const games = await loadCsv(DATASETS.games());
  requireColumns(
    games,
    ["game_id", "game_type", "home_team", "away_team", "home_score", "away_score"],
    "games",
  );
  const lookup = new Map<string, number>();
  for (const g of games) {
    if (g.game_type !== "REG") continue;
    if (g.home_score === "" || g.away_score === "") continue;
    lookup.set(`${g.game_id}:${g.home_team}`, Number(g.away_score));
    lookup.set(`${g.game_id}:${g.away_team}`, Number(g.home_score));
  }
  return lookup;
}

async function collectSeason(
  season: number,
  pointsAllowed: Map<string, number>,
): Promise<PlayerWeek[]> {
  const out: PlayerWeek[] = [];

  const players = await loadCsv(DATASETS.playerWeek(season));
  requireColumns(
    players,
    [
      "player_id",
      "position",
      "week",
      "season_type",
      "passing_yards",
      "rushing_yards",
      "receiving_yards",
      "receptions",
    ],
    `stats_player_week_${season}`,
  );
  for (const r of players) {
    if (r.season_type !== "REG" || !OFFENSE_POSITIONS.has(r.position ?? "")) continue;
    out.push({
      position: domainPosition(r.position ?? ""),
      playerId: r.player_id ?? "",
      season,
      week: Number(r.week),
      points: offensePoints(r, SCORING),
    });
  }

  const kickers = await loadCsv(DATASETS.kickingWeek(season));
  requireColumns(
    kickers,
    ["player_id", "week", "season_type", "fg_made_0_19", "fg_made_40_49", "pat_made"],
    `player_stats_kicking_${season}`,
  );
  for (const r of kickers) {
    if (r.season_type !== "REG") continue;
    out.push({
      position: "K",
      playerId: r.player_id ?? "",
      season,
      week: Number(r.week),
      points: kickerPoints(r, SCORING),
    });
  }

  const teams = await loadCsv(DATASETS.teamWeek(season));
  requireColumns(
    teams,
    [
      "team",
      "week",
      "season_type",
      "game_id",
      "def_sacks",
      "def_interceptions",
      "fumble_recovery_opp",
    ],
    `stats_team_week_${season}`,
  );
  for (const r of teams) {
    if (r.season_type !== "REG") continue;
    out.push({
      position: "DST",
      playerId: r.team ?? "",
      season,
      week: Number(r.week),
      points: dstPoints(r, pointsAllowed.get(`${r.game_id}:${r.team}`) ?? 0, SCORING),
    });
  }

  return out;
}

async function main(): Promise<void> {
  const pointsAllowed = await pointsAllowedByGameTeam();

  const playerWeeks: PlayerWeek[] = [];
  for (const season of SEASONS) {
    console.log(`loading ${season}…`);
    playerWeeks.push(...(await collectSeason(season, pointsAllowed)));
  }

  const curves = buildPredictiveCurves(playerWeeks, RANK_CAPS, CURVE_OPTIONS);
  curves.__meta__ = {
    sampleCounts: curves.__meta__?.sampleCounts ?? {},
    seasons: SEASONS,
    scoring: "half-ppr offense; standard K and DST",
    method: "predictive-rank (rank by trailing average, record the target week's actual points)",
    minObservations: CURVE_OPTIONS.minObservations,
    generatedAt: new Date().toISOString(),
  };

  // Pretty structure, each { mean, sd } on one line — one rank per line.
  const json = JSON.stringify(curves, null, 2).replace(
    /\{\s+"mean": ([\d.-]+),\s+"sd": ([\d.-]+)\s+\}/g,
    '{ "mean": $1, "sd": $2 }',
  );
  const outPath = fileURLToPath(
    new URL("../packages/projections/data/rank_curves.json", import.meta.url),
  );
  writeFileSync(outPath, `${json}\n`);
  console.log(`\nwrote ${outPath}`);

  for (const position of ["QB", "RB", "WR", "TE", "K", "DST"]) {
    const curve = curves[position] ?? {};
    const ranks = Object.keys(curve);
    const top = curve["1"];
    const mid = curve[String(Math.max(1, Math.floor(ranks.length / 2)))];
    console.log(
      `  ${position.padEnd(3)} ranks 1–${ranks.length}` +
        `  #1 ${top?.mean}±${top?.sd}` +
        `  mid ${mid?.mean}±${mid?.sd}`,
    );
  }
}

await main();
