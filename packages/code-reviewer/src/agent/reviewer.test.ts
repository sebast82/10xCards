import { APICallError, NoObjectGeneratedError } from 'ai';
import { describe, expect, it } from 'vitest';
import { buildReviewPrompt, REVIEWER_INSTRUCTIONS } from '../prompts/reviewer.js';
import type { ReviewInput } from '../schemas/input.js';
import type { Review } from '../schemas/review.js';
import { mockFailingModel, mockReviewModel } from '../testing/mock-model.js';
import { createReviewerAgent, reviewCode, runReview } from './reviewer.js';

const input: ReviewInput = {
  title: 'Fix add()',
  description: 'It subtracted.',
  diff: '-  return a - b;\n+  return a + b;',
};

const review: Review = {
  summary: 'Fixes add() to add instead of subtract.',
  scores: { correctness: 9, idiomaticity: 8, complexity: 9, testCoverage: 4, documentation: 6, security: 10 },
  issues: [{ severity: 'medium', message: 'No test covers `add()`.' }],
};

describe('reviewCode', () => {
  it('resolves to the parsed review', async () => {
    const agent = createReviewerAgent({ model: mockReviewModel(JSON.stringify(review)) });

    await expect(reviewCode(input, { agent })).resolves.toEqual(review);
  });

  it('rejects with NoObjectGeneratedError when the output breaks the schema', async () => {
    const invalid = { ...review, issues: [{ severity: 'critical', message: 'm' }] };
    const agent = createReviewerAgent({ model: mockReviewModel(JSON.stringify(invalid)) });

    const error: unknown = await reviewCode(input, { agent }).catch((e: unknown) => e);

    expect(NoObjectGeneratedError.isInstance(error)).toBe(true);
  });

  it.each([0, 11, 7.5])('rejects when the model returns a security score of %s', async (security) => {
    const invalid = { ...review, scores: { ...review.scores, security } };
    const agent = createReviewerAgent({ model: mockReviewModel(JSON.stringify(invalid)) });

    await expect(reviewCode(input, { agent })).rejects.toThrow(/invalid scores[\s\S]*security/);
  });

  it('sends the instructions, the three-block prompt and the token cap in a single step', async () => {
    const model = mockReviewModel(JSON.stringify(review));

    await reviewCode(input, { agent: createReviewerAgent({ model }) });

    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call?.maxOutputTokens).toBe(8192);
    expect(call?.prompt).toEqual([
      { role: 'system', content: REVIEWER_INSTRUCTIONS },
      { role: 'user', content: [{ type: 'text', text: buildReviewPrompt(input) }] },
    ]);
  });

  // Offline guard for a provider-side 400: Anthropic structured outputs reject `minimum`/`maximum`.
  it('sends a response schema with no numeric bounds', async () => {
    const model = mockReviewModel(JSON.stringify(review));

    await reviewCode(input, { agent: createReviewerAgent({ model }) });

    const format = model.doGenerateCalls[0]?.responseFormat;
    const schema = JSON.stringify(format?.type === 'json' ? format.schema : null);
    expect(schema).toContain('"testCoverage"');
    expect(schema).not.toMatch(/"(minimum|maximum|exclusiveMinimum|exclusiveMaximum)"/);
  });
});

describe('runReview', () => {
  it('resolves to the review with its usage, finish reason and model id', async () => {
    const model = mockReviewModel(JSON.stringify(review));

    const run = await runReview(input, { agent: createReviewerAgent({ model }) });

    expect(run).toMatchObject({ review, finishReason: 'stop', modelId: model.modelId });
    expect(run.usage).toMatchObject({ inputTokens: 10, outputTokens: 20 });
  });

  it('forwards the abort signal to the model call', async () => {
    const model = mockReviewModel(JSON.stringify(review));
    const controller = new AbortController();

    await runReview(input, { agent: createReviewerAgent({ model }), abortSignal: controller.signal });
    controller.abort();

    // State, not identity: the SDK may combine the caller's signal with its own.
    expect(model.doGenerateCalls[0]?.abortSignal?.aborted).toBe(true);
  });

  it('retries a retryable provider error once before rejecting', async () => {
    const model = mockFailingModel(
      new APICallError({
        message: 'Rate limited',
        url: 'https://openrouter.test/api/v1/chat/completions',
        requestBodyValues: {},
        statusCode: 429,
        // Honoured by the SDK instead of its 2 s backoff, so the retry runs immediately.
        responseHeaders: { 'retry-after-ms': '0' },
      }),
    );

    await expect(runReview(input, { agent: createReviewerAgent({ model }) })).rejects.toThrow('Rate limited');
    expect(model.doGenerateCalls).toHaveLength(2);
  });
});
