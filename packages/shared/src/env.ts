import { z } from "zod";

/**
 * The application's environment contract. Mirrors `.env.example`.
 *
 * Validate once at startup with {@link parseEnv}; never read `process.env`
 * directly elsewhere. See CLAUDE.md — "No secrets in code".
 */
const EnvSchema = z.object({
  /** Supabase transaction pooler (port 6543). Runtime queries. */
  DATABASE_URL: z.string().url(),
  /** Supabase session pooler (port 5432). Drizzle migrations. */
  DIRECT_URL: z.string().url(),
  /** Ranking extraction and explanation prose only — never the math. */
  ANTHROPIC_API_KEY: z.string().min(1),
  NFL_SEASON: z.string().regex(/^\d{4}$/, "NFL_SEASON must be a four-digit year"),
  /** Sent on every outbound scrape. Identifiable, not a browser string. */
  FETCH_USER_AGENT: z.string().min(1),
  /** Serve every source read from the cache and never hit the network. */
  OFFLINE_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parse and validate an environment. Throws with every offending key named.
 *
 * @param source defaults to `process.env`; pass an explicit object in tests.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${detail}`);
  }
  return result.data;
}
