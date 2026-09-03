import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://user:pass@host.pooler.supabase.com:6543/postgres",
  DIRECT_URL: "postgresql://user:pass@host.pooler.supabase.com:5432/postgres",
  ANTHROPIC_API_KEY: "sk-ant-test",
  NFL_SEASON: "2026",
  FETCH_USER_AGENT: "waiver-wire/0.1 (contact: me@example.com)",
} satisfies Record<string, string>;

describe("parseEnv", () => {
  it("returns a typed config from a complete environment", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(env.NFL_SEASON).toBe("2026");
    expect(env.FETCH_USER_AGENT).toBe(valid.FETCH_USER_AGENT);
  });

  it("defaults OFFLINE_MODE to the boolean false when unset", () => {
    expect(parseEnv(valid).OFFLINE_MODE).toBe(false);
  });

  it('coerces OFFLINE_MODE "true" to the boolean true', () => {
    expect(parseEnv({ ...valid, OFFLINE_MODE: "true" }).OFFLINE_MODE).toBe(true);
  });

  it("throws naming the missing variable", () => {
    const missing: Record<string, string> = { ...valid };
    delete missing.DATABASE_URL;
    expect(() => parseEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it("rejects an NFL_SEASON that is not a four-digit year", () => {
    expect(() => parseEnv({ ...valid, NFL_SEASON: "26" })).toThrow(/NFL_SEASON/);
  });

  it("rejects a DATABASE_URL that is not a URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "not-a-url" })).toThrow(/DATABASE_URL/);
  });
});
