import { MockLanguageModelV4 } from 'ai/test';

// Test-only helpers, excluded from the build. The offline eval smoke run uses them too: code under
// evals/ must not import `ai` itself, because promptfoo nests its own `ai@6` there.

// A model that answers every call with `text` as the reviewer's structured output.
export function mockReviewModel(text: string): MockLanguageModelV4 {
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

// A model whose every call rejects with `error`.
export function mockFailingModel(error: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw error;
    },
  });
}
