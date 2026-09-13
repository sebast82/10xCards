import {
  Output,
  ToolLoopAgent,
  type FinishReason,
  type LanguageModel,
  type LanguageModelUsage,
  type ProviderMetadata,
} from 'ai';
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
// One retry absorbs a transient provider error; the SDK default of 2 means up to three paid attempts
// and hides the flakiness an eval is meant to measure.
const MAX_RETRIES = 1;

export function createReviewerAgent(options: { model: LanguageModel }) {
  return new ToolLoopAgent({
    model: options.model,
    instructions: REVIEWER_INSTRUCTIONS,
    tools: reviewerTools,
    output: Output.object({ schema: ReviewSchema }),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: MAX_RETRIES,
  });
}

export type ReviewerAgent = ReturnType<typeof createReviewerAgent>;

// Built on first use, never at import time, so importing the library reads no env.
let defaultAgent: ReviewerAgent | undefined;

function getDefaultAgent(): ReviewerAgent {
  defaultAgent ??= createReviewerAgent({ model: createOpenRouterModel(loadConfig()) });
  return defaultAgent;
}

export type ReviewOptions = { agent?: ReviewerAgent; abortSignal?: AbortSignal };

// A review together with what it cost and why it stopped — for callers that compare models (evals).
export type ReviewRun = {
  review: Review;
  usage: LanguageModelUsage;
  finishReason: FinishReason;
  modelId: string;
  providerMetadata: ProviderMetadata | undefined;
};

export async function runReview(input: ReviewInput, options?: ReviewOptions): Promise<ReviewRun> {
  const agent = options?.agent ?? getDefaultAgent();
  const result = await agent.generate({ prompt: buildReviewPrompt(input), abortSignal: options?.abortSignal });
  // `generate()` rejects with NoObjectGeneratedError on parse/validation failure; the `output` getter
  // throws NoOutputGeneratedError when the final step produced none — read it here so the promise rejects.
  const review = result.output;
  // The model-facing schema carries no numeric bounds (see schemas/review.ts), so enforce them here.
  const scores = ScoresSchema.safeParse(review.scores);
  if (!scores.success) {
    throw new Error(`Model returned invalid scores:\n${z.prettifyError(scores.error)}`);
  }
  return {
    review,
    // All-steps total; `finalStep` replaces the deprecated top-level `response` and `providerMetadata`.
    usage: result.usage,
    finishReason: result.finishReason,
    modelId: result.finalStep.response.modelId,
    providerMetadata: result.finalStep.providerMetadata,
  };
}

export async function reviewCode(input: ReviewInput, options?: ReviewOptions): Promise<Review> {
  return (await runReview(input, options)).review;
}
