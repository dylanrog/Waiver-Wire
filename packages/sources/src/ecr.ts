import { z } from "zod";

/** FantasyPros serves numbers as strings on some fields; accept either. */
const numish = z.union([z.string(), z.number()]);

export const EcrPlayer = z
  .object({
    player_id: numish.transform(String),
    player_name: z.string(),
    player_team_id: z.string().nullable().optional(),
    player_position_id: z.string(),
    player_short_name: z.string().optional(),
    rank_ecr: z.number().int().positive(),
    rank_min: numish.optional(),
    rank_max: numish.optional(),
    rank_ave: numish.optional(),
    rank_std: numish.optional(),
    pos_rank: z.string().optional(),
    player_bye_week: numish.nullable().optional(),
    player_opponent: z.string().nullable().optional(),
  })
  .passthrough();
export type EcrPlayer = z.infer<typeof EcrPlayer>;

export const EcrData = z.object({
  year: numish.transform(String),
  week: numish.transform(String),
  position_id: z.string(),
  scoring: z.string(),
  count: z.number().int().nonnegative(),
  total_experts: z.number().int().nonnegative(),
  last_updated: z.string().optional(),
  players: z.array(EcrPlayer),
});
export type EcrData = z.infer<typeof EcrData>;

export class EcrParseError extends Error {
  constructor(message: string) {
    super(`FantasyPros ecrData: ${message}`);
    this.name = "EcrParseError";
  }
}

// `var ecrData = { ... };` — non-greedy up to the first `};`, which is enough for
// this payload (no `};` appears inside its string values).
const ECR_RE = /ecrData\s*=\s*(\{[\s\S]*?\});/;

/** Extract and validate the embedded `ecrData` blob from a FantasyPros rankings page. */
export function parseEcrData(html: string): EcrData {
  const match = ECR_RE.exec(html);
  if (match?.[1] === undefined) {
    throw new EcrParseError("no `var ecrData = { … };` block found — markup may have changed");
  }

  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch (err) {
    throw new EcrParseError(`block is not valid JSON: ${(err as Error).message}`);
  }

  const result = EcrData.safeParse(json);
  if (!result.success) {
    throw new EcrParseError(
      result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; "),
    );
  }
  return result.data;
}
