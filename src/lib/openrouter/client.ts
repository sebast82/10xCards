import { z } from "zod";
import { proposalCap } from "@/lib/limits";
import { parseGenerationResponse, type FlashcardProposal } from "./parse";
import { buildChatRequest, MODEL, type ChatRequest } from "./prompt";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

// Powyżej budżetu 30 s z PRD celowo: timeout ma sygnalizować awarię, nie ucinać wolnego, ale poprawnego generowania.
const REQUEST_TIMEOUT_MS = 45_000;

// Wyczerpanie wszystkich tras po filtrowaniu (u nas: `zdr: true`) sygnalizowane jest kodem 404
// z komunikatem zaczynającym się od "No allowed providers are available for the selected model."
// Udokumentowane: https://openrouter.ai/docs/guides/features/router-metadata — nie każdy 404 nim jest.
const NO_ALLOWED_PROVIDERS = /^no allowed providers are available/i;

// Kanoniczny, stabilny identyfikator kategorii błędu dostawcy.
// Udokumentowany: https://openrouter.ai/docs/api_reference/errors-and-debugging
const RATE_LIMIT_ERROR_TYPE = "rate_limit_exceeded";

export type PrivacyMode = "zdr" | "standard";

export interface GenerationOutcome {
  proposals: FlashcardProposal[];
  model: string;
  privacyMode: PrivacyMode;
}

export type OpenRouterErrorCode = "timeout" | "network" | "upstream" | "rate_limited";

const ERROR_MESSAGES: Record<OpenRouterErrorCode, string> = {
  timeout: "Model nie odpowiedział na czas. Spróbuj ponownie.",
  network: "Nie udało się połączyć z dostawcą modelu. Spróbuj ponownie.",
  upstream: "Dostawca modelu zwrócił błąd. Spróbuj ponownie.",
  rate_limited: "Dostawca modelu chwilowo ogranicza liczbę żądań. Odczekaj chwilę i spróbuj ponownie.",
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

// Kształt koperty błędu OpenRoutera. Czytany wyłącznie po to, żeby wybrać kod błędu — żadna
// wartość stąd nie trafia do komunikatu ani do bazy, bo ciało odpowiedzi bywa echem promptu.
const errorEnvelopeSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    metadata: z.object({ error_type: z.string().optional() }).optional(),
  }),
});

interface HttpOutcome {
  ok: boolean;
  status: number;
  body: string;
}

function readErrorEnvelope(body: string): z.infer<typeof errorEnvelopeSchema> | null {
  try {
    return errorEnvelopeSchema.safeParse(JSON.parse(body)).data ?? null;
  } catch {
    return null;
  }
}

// 404 po odfiltrowaniu wszystkich tras — jedyny 404, po którym wolno ponowić bez ZDR.
function isZdrRouteMissing(outcome: HttpOutcome): boolean {
  if (outcome.status !== 404) {
    return false;
  }

  const message = readErrorEnvelope(outcome.body)?.error.message?.trim() ?? "";
  return NO_ALLOWED_PROVIDERS.test(message);
}

// Limit dostawcy jest osobną klasą awarii: użytkownik ma czekać, a nie zmieniać tekst.
function upstreamCode(outcome: HttpOutcome): OpenRouterErrorCode {
  if (outcome.status === 429) {
    return "rate_limited";
  }

  const errorType = readErrorEnvelope(outcome.body)?.error.metadata?.error_type;
  return errorType === RATE_LIMIT_ERROR_TYPE ? "rate_limited" : "upstream";
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

  if (isZdrRouteMissing(outcome)) {
    privacyMode = "standard";
    outcome = await postChatCompletion(apiKey, withoutZdr(request), signal);
  }

  if (!outcome.ok) {
    throw new OpenRouterError(upstreamCode(outcome), outcome.status);
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
