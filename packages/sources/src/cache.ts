/**
 * The raw-fetch cache a `RankingSource` reads through. `apps/web` wires this to
 * `packages/db` (`latestRawFetch` / `insertRawFetch`); `sources` never imports
 * `db`. Every raw body is written before it is parsed (CLAUDE.md).
 */
export interface RawFetchCache {
  /** The most recent cached body for this url/source/week, or null. */
  read(key: { url: string; source: string; week: number | null }): Promise<string | null>;
  write(entry: {
    url: string;
    source: string;
    week: number | null;
    body: string;
    contentType: string;
    fetchedAt: Date;
  }): Promise<void>;
}

/** A cache that never hits and never stores — for one-off scripts and tests. */
export const noCache: RawFetchCache = {
  read: async () => null,
  write: async () => {},
};
