import { describe, expect, it } from "vitest";

import {
  insertRawFetch,
  latestRawFetch,
  recordUnresolvedNames,
  replaceNflGames,
  replacePlatformProjections,
  replaceSourceRankings,
  upsertLeague,
  upsertPlayers,
  upsertRosters,
} from "./queries";
import { makeTestDb } from "./test-support";

const league = {
  id: "L1",
  name: "ELTP LEAGUE",
  season: "2026",
  totalRosters: 12,
};

describe("latestRawFetch", () => {
  it("returns the most recent row for a (source, week)", async () => {
    const db = await makeTestDb();
    await insertRawFetch(db, {
      url: "https://x/1",
      source: "fantasypros",
      week: 1,
      body: "old",
      contentType: "text/html",
      fetchedAt: new Date("2026-09-01T00:00:00Z"),
    });
    await insertRawFetch(db, {
      url: "https://x/2",
      source: "fantasypros",
      week: 1,
      body: "new",
      contentType: "text/html",
      fetchedAt: new Date("2026-09-02T00:00:00Z"),
    });

    const found = await latestRawFetch(db, "fantasypros", 1);
    expect(found?.body).toBe("new");
  });

  it("returns undefined when nothing matches", async () => {
    const db = await makeTestDb();
    expect(await latestRawFetch(db, "fantasypros", 5)).toBeUndefined();
  });

  it("treats a null week (player index) as distinct from a numbered week", async () => {
    const db = await makeTestDb();
    await insertRawFetch(db, {
      url: "https://sleeper/players",
      source: "sleeper:players",
      week: null,
      body: "index",
      contentType: "application/json",
      fetchedAt: new Date("2026-09-02T00:00:00Z"),
    });
    expect(await latestRawFetch(db, "sleeper:players", null)).toBeDefined();
    expect(await latestRawFetch(db, "sleeper:players", 1)).toBeUndefined();
  });
});

describe("upsertLeague", () => {
  it("inserts, then updates in place on conflict and bumps updated_at", async () => {
    const db = await makeTestDb();
    await upsertLeague(db, league);
    const first = await upsertLeague(db, { ...league, name: "Renamed" });

    expect(first.name).toBe("Renamed");
    expect(first.updatedAt.getTime()).toBeGreaterThanOrEqual(first.createdAt.getTime());

    const rows = await db.query.leagues.findMany();
    expect(rows).toHaveLength(1);
  });
});

describe("upsertRosters", () => {
  it("bulk upserts and updates a roster in place without duplicating", async () => {
    const db = await makeTestDb();
    await upsertLeague(db, league);
    await upsertRosters(db, "L1", [
      { sleeperRosterId: 1, ownerDisplayName: "me", isCurrentUser: true, starters: ["a"] },
      { sleeperRosterId: 2, ownerDisplayName: "you", starters: ["b"] },
    ]);
    await upsertRosters(db, "L1", [
      { sleeperRosterId: 1, ownerDisplayName: "me", isCurrentUser: true, starters: ["a", "c"] },
    ]);

    const rows = await db.query.rosters.findMany();
    expect(rows).toHaveLength(2);
    const mine = rows.find((r) => r.sleeperRosterId === 1);
    expect(mine?.starters).toEqual(["a", "c"]);
    expect(mine?.isCurrentUser).toBe(true);
  });
});

describe("upsertPlayers", () => {
  it("is idempotent on player id", async () => {
    const db = await makeTestDb();
    await upsertPlayers(db, [
      { id: "4046", fullName: "Patrick Mahomes", position: "QB", team: "KC" },
    ]);
    await upsertPlayers(db, [
      { id: "4046", fullName: "Patrick Mahomes", position: "QB", team: "KC" },
    ]);
    expect(await db.query.players.findMany()).toHaveLength(1);
  });
});

describe("replaceSourceRankings", () => {
  it("replaces the whole (source, week) snapshot, leaving no stale rows", async () => {
    const db = await makeTestDb();
    await upsertPlayers(db, [
      { id: "p1", fullName: "One", position: "RB" },
      { id: "p2", fullName: "Two", position: "RB" },
    ]);
    const fetchedAt = new Date("2026-09-02T00:00:00Z");
    await replaceSourceRankings(db, { source: "fantasypros", week: 1 }, [
      { position: "RB", rank: 1, playerId: "p1", sourceExcerpt: null, fetchedAt },
      { position: "RB", rank: 2, playerId: "p2", sourceExcerpt: null, fetchedAt },
    ]);
    await replaceSourceRankings(db, { source: "fantasypros", week: 1 }, [
      { position: "RB", rank: 1, playerId: "p2", sourceExcerpt: null, fetchedAt },
    ]);

    const rows = await db.query.sourceRankings.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerId).toBe("p2");
  });
});

describe("replacePlatformProjections", () => {
  it("replaces the (season, week, scoring) snapshot", async () => {
    const db = await makeTestDb();
    await upsertPlayers(db, [
      { id: "p1", fullName: "One", position: "RB" },
      { id: "p2", fullName: "Two", position: "WR" },
    ]);
    const key = { season: "2026", week: 1, scoring: "HALF" };
    await replacePlatformProjections(db, key, [
      { playerId: "p1", points: 12.5, raw: {} },
      { playerId: "p2", points: null, raw: {} },
    ]);
    await replacePlatformProjections(db, key, [{ playerId: "p1", points: 9.1, raw: {} }]);

    const rows = await db.query.platformProjections.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.points).toBeCloseTo(9.1);
  });

  it("keeps snapshots for different scoring formats side by side", async () => {
    const db = await makeTestDb();
    await upsertPlayers(db, [{ id: "p1", fullName: "One", position: "RB" }]);
    await replacePlatformProjections(db, { season: "2026", week: 1, scoring: "HALF" }, [
      { playerId: "p1", points: 12.5, raw: {} },
    ]);
    await replacePlatformProjections(db, { season: "2026", week: 1, scoring: "PPR" }, [
      { playerId: "p1", points: 14.0, raw: {} },
    ]);
    expect(await db.query.platformProjections.findMany()).toHaveLength(2);
  });
});

describe("replaceNflGames", () => {
  it("replaces the (season, week) snapshot", async () => {
    const db = await makeTestDb();
    const key = { season: "2026", week: 1 };
    await replaceNflGames(db, key, [
      { kickoff: new Date("2026-09-10T00:20:00Z"), homeTeam: "SEA", awayTeam: "NE", status: "scheduled", raw: {} },
      { kickoff: new Date("2026-09-13T17:00:00Z"), homeTeam: "GB", awayTeam: "DET", status: "scheduled", raw: {} },
    ]);
    await replaceNflGames(db, key, [
      { kickoff: new Date("2026-09-13T17:00:00Z"), homeTeam: "GB", awayTeam: "DET", status: "final", raw: {} },
    ]);
    const rows = await db.query.nflGames.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("final");
  });
});

describe("recordUnresolvedNames", () => {
  it("dedupes on (source, week, rawName, position)", async () => {
    const db = await makeTestDb();
    const name = { source: "fantasypros", week: 1, rawName: "A.J. Brown", position: "WR" };
    await recordUnresolvedNames(db, [name]);
    await recordUnresolvedNames(db, [name]);
    expect(await db.query.unresolvedNames.findMany()).toHaveLength(1);
  });
});
