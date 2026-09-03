/**
 * Deterministic RNG for the Monte Carlo. A fixed seed means a given week always
 * renders identically (see `SimConfig.seed`).
 */

/** mulberry32 — small, fast, good enough for simulation. Returns [0, 1). */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One draw from N(mean, sd) via Box–Muller. `sd === 0` returns `mean` exactly. */
export function normal(rng: () => number, mean: number, sd: number): number {
  if (sd === 0) return mean;
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}
