import { describe, expect, it } from "vitest";

import { createSleeperClient } from "./client";
import { SleeperResponseInvalid } from "./errors";
import { fixture, mockFetch } from "./test-support";

function client(routes: Record<string, { status?: number; body: unknown }>) {
  return createSleeperClient({ fetchImpl: mockFetch(routes), maxRetries: 0, retryDelayMs: 0 });
}

describe("getProjections", () => {
  it("parses the week's projections and keeps the scoring variants", async () => {
    const c = client({
      "/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF":
        { body: fixture("projections_w1") },
    });
    const rows = await c.getProjections("2025", 1, ["QB", "RB", "WR", "TE", "K", "DEF"]);
    expect(rows.length).toBeGreaterThan(0);
    const withPoints = rows.find((r) => r.stats.pts_half_ppr !== null);
    expect(withPoints).toBeDefined();
    expect(typeof withPoints!.player_id).toBe("string");
  });

  it("keeps a DST row keyed by team abbreviation", async () => {
    const c = client({
      "/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF":
        { body: fixture("projections_w1") },
    });
    const rows = await c.getProjections("2025", 1, ["QB", "RB", "WR", "TE", "K", "DEF"]);
    const dst = rows.find((r) => /^[A-Z]{2,3}$/.test(r.player_id));
    expect(dst).toBeDefined();
  });

  it("rejects a row whose stats block is missing", async () => {
    const c = client({
      "/projections/nfl/2025/1?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF":
        { body: [{ player_id: "1", week: 1, season: "2025" }] },
    });
    await expect(
      c.getProjections("2025", 1, ["QB", "RB", "WR", "TE", "K", "DEF"]),
    ).rejects.toBeInstanceOf(SleeperResponseInvalid);
  });
});
