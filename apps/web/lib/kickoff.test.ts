import { describe, expect, it } from "vitest";

import { formatGameLine } from "./kickoff";

const tz = "America/New_York";

describe("formatGameLine", () => {
  it("home game: TEAM vs OPP · Day Time", () => {
    const line = formatGameLine(
      { kickoff: "2026-09-13T17:00:00Z", opponent: "GB", home: true, status: "scheduled" },
      "DET",
      tz,
    );
    expect(line).toBe("DET vs GB · Sun 1:00");
  });

  it("away game uses @", () => {
    const line = formatGameLine(
      { kickoff: "2026-09-14T00:20:00Z", opponent: "SEA", home: false, status: "scheduled" },
      "NE",
      tz,
    );
    expect(line).toBe("NE @ SEA · Sun 8:20");
  });

  it("final game shows Final instead of the time", () => {
    const line = formatGameLine(
      { kickoff: "2026-09-13T17:00:00Z", opponent: "GB", home: true, status: "final" },
      "DET",
      tz,
    );
    expect(line).toBe("DET vs GB · Final");
  });

  it("no game → BYE", () => {
    expect(formatGameLine(null, "DET", tz)).toBe("BYE");
  });

  it("no team → empty string", () => {
    expect(formatGameLine(null, null, tz)).toBe("");
  });
});
