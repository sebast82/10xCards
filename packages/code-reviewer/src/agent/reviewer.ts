import { Output, ToolLoopAgent, type LanguageModel } from 'ai';
import { loadConfig } from '../config.js';
import { createOpenRouterModel } from '../model.js';
import { buildReviewPrompt, REVIEWER_INSTRUCTIONS } from '../prompts/reviewer.js';
import { ReviewSchema, type Review } from '../schemas/review.js';
import { reviewerTools } from './tools.js';

// Without an explicit cap OpenRouter reserves the model's max output (65k tokens) against credits.
const MAX_OUTPUT_TOKENS = 2048;

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

export async function reviewCode(code: string, options?: { agent?: ReviewerAgent }): Promise<Review> {
  const agent = options?.agent ?? getDefaultAgent();
  const result = await agent.generate({ prompt: buildReviewPrompt(code) });
  // `generate()` rejects with NoObjectGeneratedError on parse/validation failure; the `output` getter
  // throws NoOutputGeneratedError when the final step produced none — read it here so the promise rejects.
  return result.output;
}
