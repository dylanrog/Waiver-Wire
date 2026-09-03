/**
 * Fantasy scoring for the rank-curve build. Keep this in sync with the target
 * league's settings — the ELTP league is half-PPR with standard K and DST.
 * A row is a raw CSV record (string fields) from nflverse.
 */

type Row = Record<string, string | undefined>;

export interface PointsAllowedTier {
  /** Applies when points allowed <= max. */
  max: number;
  pts: number;
}

export interface ScoringConfig {
  passYard: number;
  passTd: number;
  passInt: number;
  pass2pt: number;
  rushYard: number;
  rushTd: number;
  rush2pt: number;
  recYard: number;
  recTd: number;
  reception: number;
  rec2pt: number;
  fumbleLost: number;
  kick: {
    fgUnder40: number;
    fg40to49: number;
    fg50plus: number;
    pat: number;
    fgMiss: number;
  };
  dst: {
    sack: number;
    interception: number;
    fumbleRecovery: number;
    touchdown: number;
    safety: number;
    blockedKick: number;
    pointsAllowed: PointsAllowedTier[];
  };
}

export const HALF_PPR: ScoringConfig = {
  passYard: 0.04,
  passTd: 4,
  passInt: -1,
  pass2pt: 2,
  rushYard: 0.1,
  rushTd: 6,
  rush2pt: 2,
  recYard: 0.1,
  recTd: 6,
  reception: 0.5,
  rec2pt: 2,
  fumbleLost: -2,
  kick: { fgUnder40: 3, fg40to49: 4, fg50plus: 5, pat: 1, fgMiss: 0 },
  dst: {
    sack: 1,
    interception: 2,
    fumbleRecovery: 2,
    touchdown: 6,
    safety: 2,
    blockedKick: 2,
    pointsAllowed: [
      { max: 0, pts: 10 },
      { max: 6, pts: 7 },
      { max: 13, pts: 4 },
      { max: 20, pts: 1 },
      { max: 27, pts: 0 },
      { max: 34, pts: -1 },
      { max: Infinity, pts: -4 },
    ],
  },
};

function num(value: string | undefined): number {
  if (value === undefined || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function offensePoints(row: Row, cfg: ScoringConfig): number {
  const passing =
    num(row.passing_yards) * cfg.passYard +
    num(row.passing_tds) * cfg.passTd +
    num(row.passing_interceptions) * cfg.passInt +
    num(row.passing_2pt_conversions) * cfg.pass2pt;

  const rushing =
    num(row.rushing_yards) * cfg.rushYard +
    num(row.rushing_tds) * cfg.rushTd +
    num(row.rushing_2pt_conversions) * cfg.rush2pt;

  const receiving =
    num(row.receiving_yards) * cfg.recYard +
    num(row.receiving_tds) * cfg.recTd +
    num(row.receptions) * cfg.reception +
    num(row.receiving_2pt_conversions) * cfg.rec2pt;

  const fumblesLost =
    (num(row.rushing_fumbles_lost) + num(row.receiving_fumbles_lost) + num(row.sack_fumbles_lost)) *
    cfg.fumbleLost;

  return passing + rushing + receiving + fumblesLost;
}

export function kickerPoints(row: Row, cfg: ScoringConfig): number {
  const under40 = num(row.fg_made_0_19) + num(row.fg_made_20_29) + num(row.fg_made_30_39);
  const from50 = num(row.fg_made_50_59) + num(row.fg_made_60_);
  return (
    under40 * cfg.kick.fgUnder40 +
    num(row.fg_made_40_49) * cfg.kick.fg40to49 +
    from50 * cfg.kick.fg50plus +
    num(row.pat_made) * cfg.kick.pat +
    num(row.fg_missed) * cfg.kick.fgMiss
  );
}

export function pointsAllowedScore(pointsAllowed: number, cfg: ScoringConfig): number {
  for (const tier of cfg.dst.pointsAllowed) {
    if (pointsAllowed <= tier.max) return tier.pts;
  }
  return cfg.dst.pointsAllowed.at(-1)?.pts ?? 0;
}

export function dstPoints(row: Row, pointsAllowed: number, cfg: ScoringConfig): number {
  const blocked = num(row.def_fg_blocks) + num(row.def_pat_blocks) + num(row.def_punt_blocks);
  return (
    num(row.def_sacks) * cfg.dst.sack +
    num(row.def_interceptions) * cfg.dst.interception +
    num(row.fumble_recovery_opp) * cfg.dst.fumbleRecovery +
    (num(row.def_tds) + num(row.special_teams_tds)) * cfg.dst.touchdown +
    num(row.def_safeties) * cfg.dst.safety +
    blocked * cfg.dst.blockedKick +
    pointsAllowedScore(pointsAllowed, cfg)
  );
}
