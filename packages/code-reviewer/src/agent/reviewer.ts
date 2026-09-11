import { Output, ToolLoopAgent, type LanguageModel } from 'ai';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createOpenRouterModel } from '../model.js';
import { buildReviewPrompt, REVIEWER_INSTRUCTIONS } from '../prompts/reviewer.js';
import type { ReviewInput } from '../schemas/input.js';
import { ReviewSchema, ScoresSchema, type Review } from '../schemas/review.js';
import { reviewerTools } from './tools.js';

// Without an explicit cap OpenRouter reserves the model's max output (65k tokens) against credits.
// The cap covers reasoning and the answer together: 2048 was spent entirely on (default-effort)
// reasoning for a near-cap diff, so it leaves room for low-effort thinking plus a 10-issue review.
const MAX_OUTPUT_TOKENS = 8192;

export function createReviewerAgent(options: { model: LanguageModel }) {
  return new ToolLoopAgent({
    model: options.model,
    instructions: REVIEWER_INSTRUCTIONS,
    tools: reviewerTools,
    output: Output.object({ schema: ReviewSchema }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
}

export type ReviewerAgent = ReturnType<typeof createReviewerAgent>;

// Built on first use, never at import time, so importing the library reads no env.
let defaultAgent: ReviewerAgent | undefined;

function getDefaultAgent(): ReviewerAgent {
  defaultAgent ??= createReviewerAgent({ model: createOpenRouterModel(loadConfig()) });
  return defaultAgent;
}

export async function reviewCode(input: ReviewInput, options?: { agent?: ReviewerAgent }): Promise<Review> {
  const agent = options?.agent ?? getDefaultAgent();
  const result = await agent.generate({ prompt: buildReviewPrompt(input) });
  // `generate()` rejects with NoObjectGeneratedError on parse/validation failure; the `output` getter
  // throws NoOutputGeneratedError when the final step produced none — read it here so the promise rejects.
  const review = result.output;
  // The model-facing schema carries no numeric bounds (see schemas/review.ts), so enforce them here.
  const scores = ScoresSchema.safeParse(review.scores);
  if (!scores.success) {
    throw new Error(`Model returned invalid scores:\n${z.prettifyError(scores.error)}`);
  }
  return review;
}
