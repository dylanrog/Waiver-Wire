import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildCurves, type PositionWeek } from "./src/curves";
import { DATASETS, groupBy, loadCsv, requireColumns } from "./src/nflverse";
import { dstPoints, HALF_PPR, kickerPoints, offensePoints } from "./src/scoring";

/**
 * Build packages/projections/data/rank_curves.json — positional rank → mean and
 * standard deviation of weekly fantasy points, from three past seasons of
 * nflverse data. Offline; the JSON is committed and must never run at request
 * time. See docs/ARCHITECTURE.md "The projection problem".
 *
 *   pnpm --filter @waiver-wire/scripts rank-curves
 */

const SEASONS = [2022, 2023, 2024];
const SCORING = HALF_PPR;
const MIN_OBSERVATIONS = 20;

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
): Promise<PositionWeek[]> {
  const weeks: PositionWeek[] = [];

  const players = await loadCsv(DATASETS.playerWeek(season));
  requireColumns(
    players,
    [
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
  const offense = players.filter(
    (r) => r.season_type === "REG" && OFFENSE_POSITIONS.has(r.position ?? ""),
  );
  for (const [key, rows] of groupBy(
    offense,
    (r) => `${domainPosition(r.position ?? "")}|${r.week ?? ""}`,
  )) {
    const position = key.split("|")[0] ?? "";
    weeks.push({ position, scores: rows.map((r) => offensePoints(r, SCORING)) });
  }

  const kickers = await loadCsv(DATASETS.kickingWeek(season));
  requireColumns(
    kickers,
    ["week", "season_type", "fg_made_0_19", "fg_made_40_49", "pat_made"],
    `player_stats_kicking_${season}`,
  );
  for (const [, rows] of groupBy(
    kickers.filter((r) => r.season_type === "REG"),
    (r) => r.week ?? "",
  )) {
    weeks.push({ position: "K", scores: rows.map((r) => kickerPoints(r, SCORING)) });
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
  for (const [, rows] of groupBy(
    teams.filter((r) => r.season_type === "REG"),
    (r) => r.week ?? "",
  )) {
    weeks.push({
      position: "DST",
      scores: rows.map((r) =>
        dstPoints(r, pointsAllowed.get(`${r.game_id}:${r.team}`) ?? 0, SCORING),
      ),
    });
  }

  return weeks;
}

async function main(): Promise<void> {
  const pointsAllowed = await pointsAllowedByGameTeam();

  const weeks: PositionWeek[] = [];
  for (const season of SEASONS) {
    console.log(`loading ${season}…`);
    weeks.push(...(await collectSeason(season, pointsAllowed)));
  }

  const curves = buildCurves(weeks, RANK_CAPS, MIN_OBSERVATIONS);
  curves.__meta__ = {
    ...curves.__meta__,
    sampleCounts: curves.__meta__?.sampleCounts ?? {},
    seasons: SEASONS,
    scoring: "half-ppr offense; standard K and DST",
    minObservations: MIN_OBSERVATIONS,
    generatedAt: new Date().toISOString(),
  };

  // Pretty structure, but each {mean, sd} on one line — one rank per line.
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
