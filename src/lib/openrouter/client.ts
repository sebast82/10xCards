import { z } from "zod";
import { proposalCap } from "@/lib/limits";
import { parseGenerationResponse, type FlashcardProposal } from "./parse";
import { buildChatRequest, MODEL, type ChatRequest } from "./prompt";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Powyżej budżetu 30 s z PRD celowo: timeout ma sygnalizować awarię, nie ucinać wolnego, ale poprawnego generowania.
const REQUEST_TIMEOUT_MS = 45_000;

// Brak trasy spełniającej ZDR sygnalizowany jest kodem 404 z komunikatem o dostawcy — nie każdy 404 nim jest.
const ZDR_ROUTE_MISSING = /provider|endpoint|data policy/i;

export type PrivacyMode = "zdr" | "standard";

export interface GenerationOutcome {
  proposals: FlashcardProposal[];
  model: string;
  privacyMode: PrivacyMode;
}

export type OpenRouterErrorCode = "timeout" | "network" | "upstream";

const ERROR_MESSAGES: Record<OpenRouterErrorCode, string> = {
  timeout: "Model nie odpowiedział na czas. Spróbuj ponownie.",
  network: "Nie udało się połączyć z dostawcą modelu. Spróbuj ponownie.",
  upstream: "Dostawca modelu zwrócił błąd. Spróbuj ponownie.",
};

export class OpenRouterError extends Error {
  readonly code: OpenRouterErrorCode;
  readonly status: number | null;

  constructor(code: OpenRouterErrorCode, status: number | null = null) {
    super(ERROR_MESSAGES[code]);
    this.name = "OpenRouterError";
    this.code = code;
    this.status = status;
  }
}

const modelSchema = z.object({ model: z.string().min(1) });

interface HttpOutcome {
  ok: boolean;
  status: number;
  body: string;
}

async function postChatCompletion(apiKey: string, request: ChatRequest, signal: AbortSignal): Promise<HttpOutcome> {
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });

    // Odczyt body w tym samym `try`: zerwanie połączenia w trakcie strumienia też musi dać `OpenRouterError`.
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new OpenRouterError(timedOut ? "timeout" : "network");
  }
}

function withoutZdr(request: ChatRequest): ChatRequest {
  const { zdr: _zdr, ...provider } = request.provider;
  return { ...request, provider };
}

export async function generateFlashcards(apiKey: string, sourceText: string): Promise<GenerationOutcome> {
  const request = buildChatRequest(sourceText);

  // Jeden budżet na obie próby: dwa niezależne timeouty sumowałyby się do 90 s i przebijały limit klienta.
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let privacyMode: PrivacyMode = "zdr";
  let outcome = await postChatCompletion(apiKey, request, signal);

  if (outcome.status === 404 && ZDR_ROUTE_MISSING.test(outcome.body)) {
    privacyMode = "standard";
    outcome = await postChatCompletion(apiKey, withoutZdr(request), signal);
  }

  if (!outcome.ok) {
    throw new OpenRouterError("upstream", outcome.status);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(outcome.body) as unknown;
  } catch {
    throw new OpenRouterError("upstream", outcome.status);
  }

  const parsedModel = modelSchema.safeParse(payload);

  return {
    proposals: parseGenerationResponse(payload, proposalCap(sourceText.length)),
    model: parsedModel.success ? parsedModel.data.model : MODEL,
    privacyMode,
  };
}
