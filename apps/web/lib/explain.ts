import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

import type { CallExplanation, Objective, StartSitCall } from "@waiver-wire/shared";

/** Cheap prose only — never the math (CLAUDE.md). Bump the model for richer copy. */
const MODEL = "claude-haiku-4-5";

const Prose = z.object({
  pros: z.array(z.string().min(1)).min(1).max(3),
  cons: z.array(z.string().min(1)).min(1).max(3),
  toggleEffect: z.string().min(1),
});

export interface ExplainInput {
  call: StartSitCall;
  objective: Objective;
  recommendedName: string;
  alternativeName: string | null;
  currentName: string | null;
  opponentName: string;
  winProbability: number;
}

function range(mean: number, sd: number): string {
  return `${Math.round(mean - 1.28 * sd)}–${Math.round(mean + 1.28 * sd)}`;
}

/**
 * Turn an already-computed `StartSitCall` into pros / cons / a one-line toggle
 * effect. The model gets the exact numbers and is told not to invent any.
 */
export async function explainCall(input: ExplainInput): Promise<CallExplanation> {
  const { call } = input;
  const other = input.objective === "win_probability" ? "expected points" : "win probability";
  const objectiveText =
    input.objective === "win_probability"
      ? `maximize win probability vs ${input.opponentName}`
      : "maximize expected points";

  const facts = [
    `Slot: ${call.slot}`,
    `Recommended: ${input.recommendedName} — projected ${range(call.projection.mean, call.projection.sd)} pts (mean ${call.projection.mean.toFixed(1)}, sd ${call.projection.sd.toFixed(1)})`,
    input.alternativeName ? `Best bench alternative: ${input.alternativeName}` : null,
    input.currentName ? `Currently in the slot: ${input.currentName}` : null,
    `Objective: ${objectiveText}`,
    input.alternativeName
      ? `Confidence in this call: ${call.confidence.toFixed(2)} (share of simulations where ${input.recommendedName} beats ${input.alternativeName}; 0.5 = the choice barely matters)`
      : "There is no eligible player on your bench for this slot — this is not really a decision.",
    input.alternativeName
      ? `Confidence if the opponent-aware toggle were flipped (objective = ${other}): ${call.confidenceUnderOtherObjective.toFixed(2)}`
      : null,
    `Matchup: ${(input.winProbability * 100).toFixed(0)}% to win`,
  ]
    .filter(Boolean)
    .join("\n");

  const { object } = await generateObject({
    model: anthropic(MODEL),
    schema: Prose,
    temperature: 0.3,
    system:
      "You explain one fantasy football start/sit decision in plain language. " +
      "Use ONLY the numbers provided — never invent or estimate stats. Say what the " +
      "call is and why. Keep each pro/con to a short phrase. If confidence is near " +
      "0.5, say the choice barely matters rather than 'uncertain'.",
    prompt: `${facts}\n\nExplain starting ${input.recommendedName} in this slot.`,
  });

  return { playerId: call.recommended, ...object };
}
