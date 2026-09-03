import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type NameResolver, PlayerId } from "@waiver-wire/shared";
import { describe, expect, it } from "vitest";

import type { RawFetchCache } from "./cache";
import { createFantasyProsSource, pageUrl } from "./fantasypros";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../tests/fixtures/fantasypros/${name}`, import.meta.url)),
    "utf8",
  );
}
const DST_HTML = fixture("rankings-dst-2026-wk1.html");
const RB_HTML = fixture("rankings-rb-2026-wk1.html");

function memCache(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  const writes: string[] = [];
  const cache: RawFetchCache = {
    read: async ({ url }) => store.get(url) ?? null,
    write: async ({ url, body }) => {
      store.set(url, body);
      writes.push(url);
    },
  };
  return { cache, store, writes };
}

function recordingFetch(bodyBySuffix: Record<string, string>) {
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    const key = Object.keys(bodyBySuffix).find((suffix) => url.includes(suffix));
    if (key === undefined) return new Response("not found", { status: 404 });
    return new Response(bodyBySuffix[key], {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const resolverKnowing = (known: Record<string, string>): NameResolver => {
  return (queries, ctx) => {
    const resolved = [];
    const unresolved = [];
    for (const q of queries) {
      const id = known[q.rawName];
      if (id !== undefined) {
        resolved.push({ rawName: q.rawName, position: q.position, playerId: PlayerId.parse(id) });
      } else {
        unresolved.push({
          source: ctx.source,
          week: ctx.week,
          rawName: q.rawName,
          position: q.position,
        });
      }
    }
    return { resolved, unresolved };
  };
};

const explode = (() => {
  throw new Error("fetch should not have been called");
}) as unknown as typeof fetch;

describe("pageUrl", () => {
  it("adds the scoring prefix only where scoring applies", () => {
    expect(pageUrl("B", "RB", "STD", 1)).toBe("B/rb.php?week=1");
    expect(pageUrl("B", "RB", "HALF", 3)).toBe("B/half-point-ppr-rb.php?week=3");
    expect(pageUrl("B", "WR", "PPR", 2)).toBe("B/ppr-wr.php?week=2");
    expect(pageUrl("B", "QB", "PPR", 1)).toBe("B/qb.php?week=1");
    expect(pageUrl("B", "DST", "HALF", 1)).toBe("B/dst.php?week=1");
  });
});

describe("createFantasyProsSource.getRankings", () => {
  it("parses, resolves, and returns ranked SourceRankings with the raw record as excerpt", async () => {
    const { cache } = memCache({
      "https://www.fantasypros.com/nfl/rankings/dst.php?week=1": DST_HTML,
    });
    const source = createFantasyProsSource({
      scoring: "STD",
      cache,
      userAgent: "waiver-wire-test",
      fetchImpl: explode,
      resolve: resolverKnowing({
        "Jacksonville Jaguars": "JAX",
        "Los Angeles Chargers": "LAC",
        "Houston Texans": "HOU",
      }),
    });

    const { rankings, unresolved } = await source.getRankings(1, ["DST"]);

    expect(rankings.map((r) => [r.rank, r.playerId])).toEqual([
      [1, "JAX"],
      [2, "LAC"],
      [3, "HOU"],
    ]);
    expect(rankings.every((r) => r.source === "fantasypros" && r.position === "DST")).toBe(true);
    expect(JSON.parse(rankings[0]!.sourceExcerpt!)).toMatchObject({
      player_name: "Jacksonville Jaguars",
    });
    expect(unresolved).toHaveLength(29);
  });

  it("writes the raw body to the cache before parsing", async () => {
    const { cache, store, writes } = memCache();
    const { fetchImpl, urls } = recordingFetch({ "dst.php": DST_HTML });
    const source = createFantasyProsSource({
      scoring: "STD",
      cache,
      userAgent: "waiver-wire-test",
      fetchImpl,
      resolve: resolverKnowing({}),
    });

    await source.getRankings(1, ["DST"]);

    expect(urls).toHaveLength(1);
    expect(writes).toContain("https://www.fantasypros.com/nfl/rankings/dst.php?week=1");
    expect(store.get("https://www.fantasypros.com/nfl/rankings/dst.php?week=1")).toBe(DST_HTML);
  });

  it("serves from cache without touching the network", async () => {
    const { cache } = memCache({
      "https://www.fantasypros.com/nfl/rankings/dst.php?week=1": DST_HTML,
    });
    const source = createFantasyProsSource({
      scoring: "STD",
      cache,
      userAgent: "t",
      fetchImpl: explode,
      resolve: resolverKnowing({ "Jacksonville Jaguars": "JAX" }),
    });
    const { rankings } = await source.getRankings(1, ["DST"]);
    expect(rankings).toHaveLength(1);
  });

  it("picks the scoring-specific page for a scoring-sensitive position", async () => {
    const { cache } = memCache();
    const { fetchImpl, urls } = recordingFetch({ "half-point-ppr-rb.php": RB_HTML });
    const source = createFantasyProsSource({
      scoring: "HALF",
      cache,
      userAgent: "t",
      fetchImpl,
      resolve: resolverKnowing({}),
    });
    await source.getRankings(4, ["RB"]);
    expect(urls[0]).toBe("https://www.fantasypros.com/nfl/rankings/half-point-ppr-rb.php?week=4");
  });

  it("surfaces every unresolved name instead of dropping it", async () => {
    const { cache } = memCache({
      "https://www.fantasypros.com/nfl/rankings/dst.php?week=1": DST_HTML,
    });
    const source = createFantasyProsSource({
      scoring: "STD",
      cache,
      userAgent: "t",
      fetchImpl: explode,
      resolve: resolverKnowing({}),
    });
    const { rankings, unresolved } = await source.getRankings(1, ["DST"]);
    expect(rankings).toHaveLength(0);
    expect(unresolved).toHaveLength(32);
    expect(unresolved.every((u) => u.source === "fantasypros" && u.week === 1)).toBe(true);
  });

  it("throws offline on a cache miss", async () => {
    const { cache } = memCache();
    const source = createFantasyProsSource({
      scoring: "STD",
      cache,
      userAgent: "t",
      fetchImpl: explode,
      offline: true,
      resolve: resolverKnowing({}),
    });
    await expect(source.getRankings(1, ["DST"])).rejects.toThrow(/offline/);
  });

  it("throws when a page returns the wrong position", async () => {
    const { cache } = memCache({
      "https://www.fantasypros.com/nfl/rankings/qb.php?week=1": DST_HTML,
    });
    const source = createFantasyProsSource({
      scoring: "STD",
      cache,
      userAgent: "t",
      fetchImpl: explode,
      resolve: resolverKnowing({}),
    });
    await expect(source.getRankings(1, ["QB"])).rejects.toThrow(/expected "QB"/);
  });
});
