import { describe, expect, it } from "vitest";

import { decodeSession, encodeSession } from "./session";

describe("session encoding", () => {
  it("round-trips a session", () => {
    const session = { sleeperUserId: "873852584098721792", leagueId: "1389672995785543680" };
    expect(decodeSession(encodeSession(session))).toEqual(session);
  });

  it("round-trips a session with no league selected yet", () => {
    const session = { sleeperUserId: "873852584098721792", leagueId: null };
    expect(decodeSession(encodeSession(session))).toEqual(session);
  });

  it("returns null for a malformed cookie", () => {
    expect(decodeSession("not-base64-json")).toBeNull();
    expect(decodeSession(Buffer.from('{"nope":1}').toString("base64"))).toBeNull();
  });
});
