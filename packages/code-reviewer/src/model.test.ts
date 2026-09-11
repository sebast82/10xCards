import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReviewerAgent, reviewCode } from './agent/reviewer.js';
import { createOpenRouterModel } from './model.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const review = {
  summary: 's',
  scores: { correctness: 8, idiomaticity: 8, complexity: 8, testCoverage: 8, documentation: 8, security: 8 },
  issues: [],
};

function completion(content: string): Response {
  const body = {
    id: 'gen-test',
    object: 'chat.completion',
    created: 0,
    model: 'anthropic/claude-sonnet-5',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('createOpenRouterModel', () => {
  // Reasoning shares the output budget: at the default effort a near-cap diff spent all of it thinking.
  it('sends low-effort reasoning and the reviewer output cap in the request body', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => completion(JSON.stringify(review)));
    vi.stubGlobal('fetch', fetch);
    const model = createOpenRouterModel({ OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'anthropic/claude-sonnet-5' });

    await reviewCode({ title: 't', description: '', diff: '' }, { agent: createReviewerAgent({ model }) });

    expect(fetch).toHaveBeenCalledTimes(1);
    const body: unknown = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ model: 'anthropic/claude-sonnet-5', max_tokens: 8192, reasoning: { effort: 'low' } });
  });
});
