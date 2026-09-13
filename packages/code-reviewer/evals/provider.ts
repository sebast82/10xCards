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
// `mockReviews` is keyed by fixture name: the cases assert in both directions (a flawed fixture must fail the
// verdict, the control must pass it), so one canned review for every fixture could not exercise them all.
type ReviewerProviderConfig = { model?: unknown; mockReviews?: unknown };

// The reviewer as a promptfoo provider: one instance per model, running the real agent — instructions, prompt
// builder, output schema and score check all come from `../src`. The rendered promptfoo prompt is ignored.
export default class ReviewerProvider implements ApiProvider {
  readonly label: string | undefined;
  private readonly providerId: string;
  // Set for a real model; `undefined` offline, where the agent is built per call from the fixture's canned review.
  private readonly agent: ReviewerAgent | undefined;
  private readonly mockReviews: Record<string, unknown> | undefined;

  constructor(options: ProviderOptions) {
    const { model, mockReviews } = (options.config ?? {}) as ReviewerProviderConfig;
    if ((model === undefined) === (mockReviews === undefined)) {
      throw new Error('code-reviewer provider: config needs exactly one of `model` or `mockReviews`');
    }
    this.label = options.label;
    if (model !== undefined) {
      if (typeof model !== 'string' || model === '') {
        throw new Error('code-reviewer provider: `model` must be an OpenRouter model id');
      }
      this.providerId = `code-reviewer:${model}`;
      this.agent = createReviewerAgent({ model: createOpenRouterModel({ ...loadConfig(), OPENROUTER_MODEL: model }) });
      this.mockReviews = undefined;
    } else {
      if (!isRecord(mockReviews)) {
        throw new Error('code-reviewer provider: `mockReviews` must be an object keyed by fixture name');
      }
      // Offline: never reads the environment, so it runs without a key.
      this.providerId = 'code-reviewer:mock';
      this.agent = undefined;
      this.mockReviews = mockReviews;
    }
  }

  // The real agent, or one wired to the canned review for this fixture. Building a mock agent per call is
  // free (no network, no client) and keeps the offline run's inputs and assertions in one place per fixture.
  private agentFor(fixture: string): ReviewerAgent {
    if (this.agent !== undefined) return this.agent;
    const mockReview = this.mockReviews?.[fixture];
    if (mockReview === undefined) {
      throw new Error(`code-reviewer provider: \`mockReviews\` has no canned review for fixture '${fixture}'`);
    }
    return createReviewerAgent({ model: mockReviewModel(JSON.stringify(mockReview)) });
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
      const run = await runReview(loadFixture(fixture), {
        agent: this.agentFor(fixture),
        abortSignal: options?.abortSignal,
      });
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
