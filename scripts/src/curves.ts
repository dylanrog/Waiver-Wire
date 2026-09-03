/** One player's fantasy points in one game. */
export interface PlayerWeek {
  position: string;
  playerId: string;
  season: number;
  week: number;
  points: number;
}

export interface RankStat {
  mean: number;
  sd: number;
}

export interface CurvesMeta {
  sampleCounts: Record<string, Record<string, number>>;
  seasons?: number[];
  scoring?: string;
  method?: string;
  minObservations?: number;
  generatedAt?: string;
}

/** `{ QB: { "1": { mean, sd }, … }, __meta__: … }` — see data/README.md. */
export type RankCurves = Record<string, Record<string, RankStat>> & {
  __meta__?: CurvesMeta;
};

export interface PredictiveOptions {
  /** Prior games a player needs before we'll rank him. */
  minTrailingGames: number;
  /** First week we treat as a target (needs trailing data behind it). */
  firstTargetWeek: number;
  /** Drop a rank once it has fewer weeks of data than this. */
  minObservations: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stat(samples: number[]): RankStat {
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean: round2(mean), sd: round2(Math.sqrt(variance)) };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Predictive rank curves. For each week, rank the players who play by their
 * trailing average, then record each one's *actual* points that week. The rank
 * is re-indexed among players who play (matching how a weekly ranking source
 * only lists players who'll suit up). The result is "how a player projected Nth
 * actually performs" — the spread the Monte Carlo needs.
 */
export function buildPredictiveCurves(
  playerWeeks: readonly PlayerWeek[],
  rankCaps: Readonly<Record<string, number>>,
  opts: PredictiveOptions,
): RankCurves {
  const bySeason = new Map<string, PlayerWeek[]>();
  for (const pw of playerWeeks) {
    push(bySeason, `${pw.position}|${pw.season}`, pw);
  }

  const samples = new Map<string, Map<number, number[]>>();

  for (const [key, rows] of bySeason) {
    const position = key.split("|")[0] ?? "";
    const maxWeek = Math.max(...rows.map((r) => r.week));
    const posSamples = samples.get(position) ?? new Map<number, number[]>();
    samples.set(position, posSamples);

    for (let target = opts.firstTargetWeek; target <= maxWeek; target++) {
      const playedThisWeek = new Map<string, number>();
      const trailing = new Map<string, { sum: number; n: number }>();
      for (const r of rows) {
        if (r.week === target) playedThisWeek.set(r.playerId, r.points);
        else if (r.week < target) {
          const t = trailing.get(r.playerId) ?? { sum: 0, n: 0 };
          trailing.set(r.playerId, { sum: t.sum + r.points, n: t.n + 1 });
        }
      }
      if (playedThisWeek.size === 0) continue;

      const ranked: { id: string; avg: number }[] = [];
      for (const id of playedThisWeek.keys()) {
        const form = trailing.get(id);
        if (form !== undefined && form.n >= opts.minTrailingGames) {
          ranked.push({ id, avg: form.sum / form.n });
        }
      }
      ranked.sort((a, b) => b.avg - a.avg);

      ranked.forEach((player, index) => {
        push(posSamples, index + 1, playedThisWeek.get(player.id) ?? 0);
      });
    }
  }

  const curves: RankCurves = {};
  const sampleCounts: CurvesMeta["sampleCounts"] = {};

  for (const [position, posSamples] of samples) {
    const cap = rankCaps[position] ?? 0;
    const curve: Record<string, RankStat> = {};
    const counts: Record<string, number> = {};
    for (let rank = 1; rank <= cap; rank++) {
      const xs = posSamples.get(rank);
      if (xs === undefined || xs.length < opts.minObservations) break;
      curve[String(rank)] = stat(xs);
      counts[String(rank)] = xs.length;
    }
    curves[position] = curve;
    sampleCounts[position] = counts;
  }

  curves.__meta__ = { sampleCounts };
  return curves;
}
