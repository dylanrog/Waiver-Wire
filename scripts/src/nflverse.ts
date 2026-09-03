import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";

/**
 * nflverse-data GitHub releases. https://github.com/nflverse/nflverse-data/releases
 * — `stats_player` (weekly offense), `player_stats` (weekly kicking),
 * `stats_team` (weekly team incl. defense), `schedules` (game scores).
 */
const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

export const DATASETS = {
  playerWeek: (season: number) => `${BASE}/stats_player/stats_player_week_${season}.csv`,
  kickingWeek: (season: number) => `${BASE}/player_stats/player_stats_kicking_${season}.csv`,
  teamWeek: (season: number) => `${BASE}/stats_team/stats_team_week_${season}.csv`,
  games: () => `${BASE}/schedules/games.csv`,
};

const CACHE_DIR = fileURLToPath(new URL("../.data-cache/", import.meta.url));

async function fetchCached(url: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const name = url.split("/").pop() ?? "download.csv";
  const file = `${CACHE_DIR}${name}`;
  if (existsSync(file)) return readFileSync(file, "utf8");

  const res = await fetch(url, { headers: { "user-agent": "waiver-wire rank-curves build" } });
  if (!res.ok) throw new Error(`nflverse ${url} → ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

export type CsvRow = Record<string, string>;

export async function loadCsv(url: string): Promise<CsvRow[]> {
  const text = await fetchCached(url);
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    cast: false,
  }) as CsvRow[];
  return rows;
}

/** Fail loud if nflverse renamed or dropped a column we depend on. */
export function requireColumns(rows: CsvRow[], needed: string[], label: string): void {
  const first = rows[0];
  if (first === undefined) return;
  const have = new Set(Object.keys(first));
  const missing = needed.filter((column) => !have.has(column));
  if (missing.length > 0) {
    throw new Error(
      `${label}: missing expected column(s) [${missing.join(", ")}] — nflverse schema may have changed`,
    );
  }
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  return groups;
}
