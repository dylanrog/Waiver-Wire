import { describe, expect, it } from "vitest";

import { buildPredictiveCurves, type PlayerWeek } from "./curves";

const opts = { minTrailingGames: 2, firstTargetWeek: 4, minObservations: 1 };

/** Three RBs with flat trailing form, then a target week. */
function baseline(week4: Record<string, number | undefined>): PlayerWeek[] {
  const weeks: PlayerWeek[] = [];
  const form: Record<string, number> = { A: 20, B: 10, C: 5 };
  for (const [playerId, points] of Object.entries(form)) {
    for (const week of [1, 2, 3]) {
      weeks.push({ position: "RB", playerId, season: 2024, week, points });
    }
  }
  for (const [playerId, points] of Object.entries(week4)) {
    if (points !== undefined) {
      weeks.push({ position: "RB", playerId, season: 2024, week: 4, points });
    }
  }
  return weeks;
}

describe("buildPredictiveCurves", () => {
  it("ranks players by trailing form and records their actual next-week outcome", () => {
    const curves = buildPredictiveCurves(baseline({ A: 30, B: 8, C: 6 }), { RB: 3 }, opts);
    expect(curves.RB?.["1"]).toEqual({ mean: 30, sd: 0 });
    expect(curves.RB?.["2"]).toEqual({ mean: 8, sd: 0 });
    expect(curves.RB?.["3"]).toEqual({ mean: 6, sd: 0 });
  });

  it("re-indexes ranks among only the players who actually played that week", () => {
    // A is on bye in week 4 (no row) -> B becomes rank 1, C rank 2
    const curves = buildPredictiveCurves(baseline({ A: undefined, B: 8, C: 6 }), { RB: 3 }, opts);
    expect(curves.RB?.["1"]).toEqual({ mean: 8, sd: 0 });
    expect(curves.RB?.["2"]).toEqual({ mean: 6, sd: 0 });
    expect(curves.RB?.["3"]).toBeUndefined();
  });

  it("ignores players without enough trailing games to rank", () => {
    const weeks = baseline({ A: 30, B: 8, C: 6 });
    weeks.push({ position: "RB", playerId: "D", season: 2024, week: 3, points: 40 }); // 1 game only
    weeks.push({ position: "RB", playerId: "D", season: 2024, week: 4, points: 25 });
    const curves = buildPredictiveCurves(weeks, { RB: 4 }, opts);
    // D is unranked; rank 1 is still A's 30
    expect(curves.RB?.["1"]).toEqual({ mean: 30, sd: 0 });
    expect(Object.keys(curves.RB ?? {})).toEqual(["1", "2", "3"]);
  });

  it("takes the population sd of outcomes across target weeks", () => {
    const weeks = [
      ...seasonWeek("RB", "A", 2024, [10, 10, 10], { 4: 20, 5: 10 }),
      ...seasonWeek("RB", "B", 2024, [5, 5, 5], { 4: 4, 5: 8 }),
    ];
    const curves = buildPredictiveCurves(weeks, { RB: 2 }, opts);
    // rank 1 outcomes: 20 (wk4), 10 (wk5) -> mean 15, sd 5
    expect(curves.RB?.["1"]).toEqual({ mean: 15, sd: 5 });
  });

  it("stops a position's curve at the first rank below minObservations", () => {
    const curves = buildPredictiveCurves(
      baseline({ A: 30, B: 8, C: 6 }),
      { RB: 3 },
      {
        ...opts,
        minObservations: 2,
      },
    );
    expect(curves.RB).toEqual({});
  });
});

function seasonWeek(
  position: string,
  playerId: string,
  season: number,
  trailing: number[],
  targets: Record<number, number>,
): PlayerWeek[] {
  const weeks: PlayerWeek[] = trailing.map((points, i) => ({
    position,
    playerId,
    season,
    week: i + 1,
    points,
  }));
  for (const [week, points] of Object.entries(targets)) {
    weeks.push({ position, playerId, season, week: Number(week), points });
  }
  return weeks;
}
