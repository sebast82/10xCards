import { NoObjectGeneratedError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { buildReviewPrompt, REVIEWER_INSTRUCTIONS } from '../prompts/reviewer.js';
import type { Review } from '../schemas/review.js';
import { createReviewerAgent, reviewCode } from './reviewer.js';

function mockModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

const review: Review = {
  summary: 'Adds two numbers, but subtracts them instead.',
  issues: [{ severity: 'high', message: 'Uses `-` instead of `+`.' }],
};

describe('reviewCode', () => {
  it('resolves to the parsed review', async () => {
    const agent = createReviewerAgent({ model: mockModel(JSON.stringify(review)) });

    await expect(reviewCode('function add(a, b) { return a - b; }', { agent })).resolves.toEqual(review);
  });

  it('rejects with NoObjectGeneratedError when the output breaks the schema', async () => {
    const invalid = { summary: 's', issues: [{ severity: 'critical', message: 'm' }] };
    const agent = createReviewerAgent({ model: mockModel(JSON.stringify(invalid)) });

    const error: unknown = await reviewCode('x', { agent }).catch((e: unknown) => e);

    expect(NoObjectGeneratedError.isInstance(error)).toBe(true);
  });

  it('sends the instructions, the delimited code and the token cap in a single step', async () => {
    const code = 'const total = items.reduce((a, b) => a + b);';
    const model = mockModel(JSON.stringify(review));

    await reviewCode(code, { agent: createReviewerAgent({ model }) });

    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call?.maxOutputTokens).toBe(2048);
    expect(call?.prompt).toEqual([
      { role: 'system', content: REVIEWER_INSTRUCTIONS },
      { role: 'user', content: [{ type: 'text', text: buildReviewPrompt(code) }] },
    ]);
  });
});
