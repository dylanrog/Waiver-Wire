/** One position's players' fantasy points for a single week (any order). */
export interface PositionWeek {
  position: string;
  scores: number[];
}

export interface RankStat {
  mean: number;
  sd: number;
}

export interface CurvesMeta {
  sampleCounts: Record<string, Record<string, number>>;
  seasons?: number[];
  scoring?: string;
  minObservations?: number;
  generatedAt?: string;
}

/** `{ QB: { "1": { mean, sd }, … }, __meta__: … }` — see data/README.md. */
export type RankCurves = Record<string, Record<string, RankStat>> & {
  __meta__?: CurvesMeta;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stat(samples: number[]): RankStat {
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean: round2(mean), sd: round2(Math.sqrt(variance)) };
}

/**
 * For each position, rank each week's players by points (desc), then take the
 * mean and population sd of points at each rank across all weeks. A rank is
 * emitted only while it has at least `minObservations` weeks of data; the first
 * thin rank ends that position's curve.
 */
export function buildCurves(
  weeks: readonly PositionWeek[],
  rankCaps: Readonly<Record<string, number>>,
  minObservations = 10,
): RankCurves {
  const sortedByPosition = new Map<string, number[][]>();
  for (const week of weeks) {
    const list = sortedByPosition.get(week.position) ?? [];
    list.push([...week.scores].sort((a, b) => b - a));
    sortedByPosition.set(week.position, list);
  }

  const curves: RankCurves = {};
  const sampleCounts: CurvesMeta["sampleCounts"] = {};

  for (const [position, weekScores] of sortedByPosition) {
    const cap = rankCaps[position] ?? 0;
    const curve: Record<string, RankStat> = {};
    const counts: Record<string, number> = {};

    for (let rank = 1; rank <= cap; rank++) {
      const samples: number[] = [];
      for (const scores of weekScores) {
        const value = scores[rank - 1];
        if (value !== undefined) samples.push(value);
      }
      if (samples.length < minObservations) break;
      curve[String(rank)] = stat(samples);
      counts[String(rank)] = samples.length;
    }

    curves[position] = curve;
    sampleCounts[position] = counts;
  }

  curves.__meta__ = { sampleCounts };
  return curves;
}
