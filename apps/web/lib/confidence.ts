/**
 * Confidence rendering primitives, shared by the dashboard and the matchup view.
 * Pure — no React, no DOM.
 */

/** amber (low confidence) → teal (high). One continuous ramp — never red/green. */
export function confidenceColor(c: number): string {
  const lo = [0xc6, 0x8a, 0x3b];
  const hi = [0x3f, 0xa8, 0x8f];
  const t = Math.max(0, Math.min(1, c));
  const [r, g, b] = lo.map((l, i) => Math.round(l + ((hi[i] ?? l) - l) * t));
  return `rgb(${r} ${g} ${b})`;
}

/** A 0–1 fraction as a whole-percent string. */
export const pct = (x: number): string => `${Math.round(x * 100)}%`;
