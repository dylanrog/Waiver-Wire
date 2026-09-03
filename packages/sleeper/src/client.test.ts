import { describe, expect, it } from "vitest";

import { createSleeperClient } from "./client";
import { SleeperNotFound, SleeperRateLimited, SleeperUnavailable } from "./errors";
import { fixture, flakyFetch, hangingFetch, mockFetch } from "./test-support";

function client(routes: Record<string, { status?: number; body: unknown }>, extra = {}) {
  return createSleeperClient({
    fetchImpl: mockFetch(routes),
    maxRetries: 2,
    retryDelayMs: 0,
    ...extra,
  });
}

describe("createSleeperClient — parsing real fixtures", () => {
  it("getUser resolves the connected user", async () => {
    const c = client({ "/user/dylanrogers44": { body: fixture("user_dylanrogers44") } });
    const user = await c.getUser("dylanrogers44");
    expect(user.user_id).toBe("873852584098721792");
    expect(user.display_name).toBe("dylanrogers44");
  });

  it("getLeague parses settings, status, and roster positions", async () => {
    const c = client({ "/league/L": { body: fixture("league") } });
    const league = await c.getLeague("L");
    expect(league.status).toBe("pre_draft");
    expect(league.roster_positions).toContain("DEF");
    expect(Object.keys(league.scoring_settings).length).toBeGreaterThan(0);
  });

  it("getRosters parses all 12 rosters", async () => {
    const c = client({ "/league/L/rosters": { body: fixture("rosters") } });
    const rosters = await c.getRosters("L");
    expect(rosters).toHaveLength(12);
    expect(rosters.every((r) => typeof r.roster_id === "number")).toBe(true);
  });

  it("getState parses the current week", async () => {
    const c = client({ "/state/nfl": { body: fixture("state") } });
    const state = await c.getState();
    expect(state.week).toBe(1);
    expect(state.season).toBe("2026");
  });

  it("getMatchups tolerates an empty week", async () => {
    const c = client({ "/league/L/matchups/1": { body: fixture("matchups_w1") } });
    expect(await c.getMatchups("L", 1)).toEqual([]);
  });
});

describe("createSleeperClient — getAllPlayers", () => {
  it("returns validated players and skips malformed records", async () => {
    const c = client({
      "/players/nfl": {
        body: {
          "4046": { player_id: "4046", full_name: "Patrick Mahomes", position: "QB", team: "KC" },
          broken: { first_name: "No", last_name: "Id" },
        },
      },
    });
    const players = await c.getAllPlayers();
    expect(players).toHaveLength(1);
    expect(players[0]?.player_id).toBe("4046");
  });
});

describe("createSleeperClient — errors and retries", () => {
  it("maps an unknown username (null body) to SleeperNotFound", async () => {
    const c = client({ "/user/ghost": { body: null } });
    await expect(c.getUser("ghost")).rejects.toBeInstanceOf(SleeperNotFound);
  });

  it("maps a 404 to SleeperNotFound", async () => {
    const c = client({ "/user/ghost": { status: 404, body: null } });
    await expect(c.getUser("ghost")).rejects.toBeInstanceOf(SleeperNotFound);
  });

  it("retries through transient 5xx and then succeeds", async () => {
    const c = createSleeperClient({
      fetchImpl: flakyFetch(2, 503, fixture("state")),
      maxRetries: 3,
      retryDelayMs: 0,
    });
    expect((await c.getState()).week).toBe(1);
  });

  it("gives up on persistent 5xx with SleeperUnavailable", async () => {
    const c = client({ "/state/nfl": { status: 503, body: null } });
    await expect(c.getState()).rejects.toBeInstanceOf(SleeperUnavailable);
  });

  it("maps persistent 429 to SleeperRateLimited", async () => {
    const c = client({ "/state/nfl": { status: 429, body: null } });
    await expect(c.getState()).rejects.toBeInstanceOf(SleeperRateLimited);
  });

  it("aborts a hung request and reports SleeperUnavailable", async () => {
    const c = createSleeperClient({
      fetchImpl: hangingFetch(),
      timeoutMs: 15,
      maxRetries: 1,
      retryDelayMs: 0,
    });
    await expect(c.getState()).rejects.toBeInstanceOf(SleeperUnavailable);
  });
});
