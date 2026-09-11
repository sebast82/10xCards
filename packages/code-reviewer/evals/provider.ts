import type {
  ApiProvider,
  CallApiContextParams,
  CallApiOptionsParams,
  ProviderOptions,
  ProviderResponse,
} from 'promptfoo';
import {
  computeVerdict,
  createOpenRouterModel,
  createReviewerAgent,
  loadConfig,
  runReview,
  type ReviewerAgent,
  type ReviewRun,
} from '../src/index.js';
import { mockReviewModel } from '../src/testing/mock-model.js';
import { loadFixture } from './fixtures.js';

// Exactly one of the two is set. promptfoo injects keys of its own (e.g. `basePath`), so others are ignored.
type ReviewerProviderConfig = { model?: unknown; mockReview?: unknown };

// The reviewer as a promptfoo provider: one instance per model, running the real agent — instructions, prompt
// builder, output schema and score check all come from `../src`. The rendered promptfoo prompt is ignored.
export default class ReviewerProvider implements ApiProvider {
  readonly label: string | undefined;
  private readonly providerId: string;
  private readonly agent: ReviewerAgent;

  constructor(options: ProviderOptions) {
    const { model, mockReview } = (options.config ?? {}) as ReviewerProviderConfig;
    if ((model === undefined) === (mockReview === undefined)) {
      throw new Error('code-reviewer provider: config needs exactly one of `model` or `mockReview`');
    }
    this.label = options.label;
    if (model !== undefined) {
      if (typeof model !== 'string' || model === '') {
        throw new Error('code-reviewer provider: `model` must be an OpenRouter model id');
      }
      this.providerId = `code-reviewer:${model}`;
      this.agent = createReviewerAgent({ model: createOpenRouterModel({ ...loadConfig(), OPENROUTER_MODEL: model }) });
    } else {
      // Offline: never reads the environment, so it runs without a key.
      this.providerId = 'code-reviewer:mock';
      this.agent = createReviewerAgent({ model: mockReviewModel(JSON.stringify(mockReview)) });
    }
  }

  id(): string {
    return this.providerId;
  }

  async callApi(
    _prompt: string,
    context?: CallApiContextParams,
    options?: CallApiOptionsParams,
  ): Promise<ProviderResponse> {
    try {
      const fixture = context?.vars.fixture;
      if (typeof fixture !== 'string' || fixture === '') {
        throw new Error('code-reviewer provider: the test needs a `fixture` var naming a fixtures/ folder');
      }
      // promptfoo aborts the signal on its timeout; forwarding it stops the paid call instead of abandoning it.
      const run = await runReview(loadFixture(fixture), { agent: this.agent, abortSignal: options?.abortSignal });
      return toResponse(run);
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }
}

function toResponse({ review, usage, finishReason, modelId, providerMetadata }: ReviewRun): ProviderResponse {
  const openrouter = providerMetadata?.openrouter;
  const billing = openrouter?.usage;
  const cost = isRecord(billing) ? billing.cost : undefined;
  const upstreamProvider = openrouter?.provider;
  return {
    output: review,
    tokenUsage: {
      prompt: usage.inputTokens,
      completion: usage.outputTokens,
      total: usage.totalTokens,
      numRequests: 1,
      completionDetails: { reasoning: usage.outputTokenDetails.reasoningTokens },
    },
    cost: typeof cost === 'number' ? cost : undefined,
    metadata: {
      modelId,
      // The host OpenRouter routed to — a schema failure may be the host's, not the model's.
      upstreamProvider: typeof upstreamProvider === 'string' ? upstreamProvider : undefined,
      finishReason,
      verdict: computeVerdict(review.scores),
    },
  };
}

// The message only: an APICallError also carries the request body, i.e. the whole reviewed diff.
// `finishReason` (e.g. on NoObjectGeneratedError) tells "the output cap ran out" from "invalid JSON".
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const finishReason = 'finishReason' in error ? error.finishReason : undefined;
  return finishReason === undefined ? error.message : `${error.message} (finishReason: ${String(finishReason)})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
