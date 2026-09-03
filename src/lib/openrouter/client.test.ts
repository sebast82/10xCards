import { afterEach, describe, expect, it, vi } from "vitest";

import { generateFlashcards, OpenRouterError } from "./client";
import { GenerationParseError } from "./parse";
import { MODEL } from "./prompt";

// Ciała odpowiedzi błędu pochodzą z dokumentacji OpenRoutera, nie z kształtu client.ts:
//   https://openrouter.ai/docs/api_reference/errors-and-debugging
//   https://openrouter.ai/docs/guides/features/router-metadata
// Sentinel ryzyka #5 — jedyny marker w tym pliku; nie może pojawić się w żadnym błędzie.
const SENTINEL = "SEKRET-";
const SOURCE_TEXT = `${SENTINEL}${"x".repeat(400)}`;

function httpResponse(body: string | Record<string, unknown>, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "Content-Type": "application/json" } });
}

function namedError(name: string): Error {
  const error = new Error("fetch failure (test)");
  error.name = name;
  return error;
}

function stubFetchResponses(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchRejection(error: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(error);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Poprawna koperta odpowiedzi wg envelopeSchema z parse.ts — używana tam, gdzie test potrzebuje
// ścieżki sukcesu (fallback ZDR, przekazanie pola `model`).
function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: MODEL,
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: JSON.stringify({ flashcards: [{ front: "Pytanie?", back: "Odpowiedź." }] }),
        },
      },
    ],
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  expect.unreachable("generateFlashcards powinno rzucić");
}

function providerOf(init: unknown): Record<string, unknown> {
  const body = (init as RequestInit | undefined)?.body;
  const parsed = JSON.parse(typeof body === "string" ? body : "{}") as { provider?: Record<string, unknown> };
  return parsed.provider ?? {};
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateFlashcards — klasyfikacja awarii dostawcy", () => {
  it("klasa A (network): odrzucone połączenie → code network, nie-pusty komunikat", async () => {
    const fetchMock = stubFetchRejection(namedError("TypeError"));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(error.code).toBe("network");
    expect(error.message.trim().length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("klasa B (timeout): TimeoutError oraz AbortError → code timeout", async () => {
    for (const name of ["TimeoutError", "AbortError"]) {
      stubFetchRejection(namedError(name));

      const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

      expect(error.code).toBe("timeout");
      expect(error.message.trim().length).toBeGreaterThan(0);
      vi.unstubAllGlobals();
    }
  });

  it("komunikaty klas niosących instrukcję są wzajemnie różne i nie-puste", async () => {
    const arrangements: [string, () => void][] = [
      ["network", () => void stubFetchRejection(namedError("TypeError"))],
      ["timeout", () => void stubFetchRejection(namedError("TimeoutError"))],
      ["rate_limited", () => void stubFetchResponses(httpResponse({ error: { message: "slow down" } }, 429))],
      ["upstream", () => void stubFetchResponses(httpResponse({ error: { message: "bad key" } }, 401))],
    ];

    const messages: string[] = [];
    for (const [, arrange] of arrangements) {
      arrange();
      const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;
      messages.push(error.message);
      vi.unstubAllGlobals();
    }

    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
    // Porównanie między sobą, nie do importu z client.ts: każda klasa z instrukcją brzmi inaczej.
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("klasa C1 (rate_limited): HTTP 429 → code rate_limited, status 429", async () => {
    stubFetchResponses(httpResponse({ error: { message: "Rate limit exceeded" } }, 429));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(error.code).toBe("rate_limited");
    expect(error.status).toBe(429);
  });

  it("klasa C1 (rate_limited): error_type rate_limit_exceeded pod innym statusem HTTP → code rate_limited", async () => {
    // Ciało dokładnie z docs OpenRoutera (errors-and-debugging): error_type jest kanonicznym sygnałem.
    const body = {
      error: {
        code: 429,
        message: "Rate limit exceeded",
        metadata: { error_type: "rate_limit_exceeded", provider_code: "rate_limited" },
      },
    };
    stubFetchResponses(httpResponse(body, 500));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(error.code).toBe("rate_limited");
  });

  it("klasa C1 niesie instrukcję odczekania i jest rozróżnialna od C2 (upstream)", async () => {
    stubFetchResponses(httpResponse({ error: { message: "x" } }, 429));
    const rateLimited = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;
    vi.unstubAllGlobals();

    stubFetchResponses(httpResponse({ error: { message: "x" } }, 503));
    const upstream = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(rateLimited.message).toContain("Odczekaj");
    expect(rateLimited.message).not.toBe(upstream.message);
  });

  it("klasa C2 (upstream): 401 i 503 dzielą komunikat, ale niosą prawdziwy status", async () => {
    stubFetchResponses(httpResponse({ error: { message: "invalid key" } }, 401));
    const unauthorized = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;
    vi.unstubAllGlobals();

    stubFetchResponses(httpResponse({ error: { message: "gateway" } }, 503));
    const unavailable = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(unauthorized.code).toBe("upstream");
    expect(unavailable.code).toBe("upstream");
    expect(unauthorized.message).toBe(unavailable.message);
    expect(unauthorized.status).toBe(401);
    expect(unavailable.status).toBe(503);
  });

  it("klasa D (upstream): HTTP 200 z ciałem nie-JSON → code upstream, status 200", async () => {
    stubFetchResponses(httpResponse("<html>502 Bad Gateway</html>", 200));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(error.code).toBe("upstream");
    expect(error.status).toBe(200);
  });
});

describe("generateFlashcards — fallback ZDR", () => {
  // Dokładne zdanie wiodące z https://openrouter.ai/docs/guides/features/router-metadata
  const ZDR_404_BODY = {
    error: {
      message: "No allowed providers are available for the selected model. Please adjust your provider preferences.",
    },
  };

  it("pierwsze żądanie niesie zdr: true, a wynik privacyMode: zdr (kontrola pozytywna)", async () => {
    const fetchMock = stubFetchResponses(httpResponse(validEnvelope(), 200));

    const outcome = await generateFlashcards("key", SOURCE_TEXT);

    expect(providerOf(fetchMock.mock.calls[0][1])).toMatchObject({ zdr: true });
    expect(outcome.privacyMode).toBe("zdr");
  });

  it("udokumentowany 404 ponawia bez klucza zdr, zachowuje data_collection i dzieli jeden sygnał", async () => {
    const fetchMock = stubFetchResponses(httpResponse(ZDR_404_BODY, 404), httpResponse(validEnvelope(), 200));

    const outcome = await generateFlashcards("key", SOURCE_TEXT);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryProvider = providerOf(fetchMock.mock.calls[1][1]);
    expect(retryProvider).not.toHaveProperty("zdr");
    expect(retryProvider).toMatchObject({ data_collection: "deny", require_parameters: true });

    const firstSignal = (fetchMock.mock.calls[0][1] as RequestInit | undefined)?.signal;
    const retrySignal = (fetchMock.mock.calls[1][1] as RequestInit | undefined)?.signal;
    expect(firstSignal).toBeDefined();
    expect(firstSignal).toBe(retrySignal);

    expect(outcome.privacyMode).toBe("standard");
  });

  it("404 'Resource not found' NIE ponawia → upstream, status 404", async () => {
    const fetchMock = stubFetchResponses(httpResponse({ error: { message: "Resource not found" } }, 404));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.code).toBe("upstream");
    expect(error.status).toBe(404);
  });

  it("404 z ciałem nie-JSON NIE ponawia → upstream", async () => {
    const fetchMock = stubFetchResponses(httpResponse("not json", 404));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.code).toBe("upstream");
  });

  it("status inny niż 404 z komunikatem 'no allowed providers' NIE ponawia (strażnik statusu)", async () => {
    const fetchMock = stubFetchResponses(httpResponse(ZDR_404_BODY, 500));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.code).toBe("upstream");
    expect(error.status).toBe(500);
  });

  it("404 z komunikatem 'no allowed providers' NIE na początku zdania NIE ponawia (kotwica ^)", async () => {
    const fetchMock = stubFetchResponses(
      httpResponse(
        { error: { message: "Provider error: no allowed providers are available for the selected model." } },
        404,
      ),
    );

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.code).toBe("upstream");
    expect(error.status).toBe(404);
  });

  it("404 z kopertą błędu bez pola message NIE ponawia i NIE rzuca TypeError", async () => {
    const fetchMock = stubFetchResponses(httpResponse({ error: {} }, 404));

    const error = (await rejection(generateFlashcards("key", SOURCE_TEXT))) as OpenRouterError;

    expect(error).toBeInstanceOf(OpenRouterError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.code).toBe("upstream");
    expect(error.status).toBe(404);
  });

  it("404 z komunikatem 'no allowed providers' otoczonym białymi znakami PONAWIA (trim przed dopasowaniem)", async () => {
    const fetchMock = stubFetchResponses(
      httpResponse({ error: { message: `   ${ZDR_404_BODY.error.message}   ` } }, 404),
      httpResponse(validEnvelope(), 200),
    );

    const outcome = await generateFlashcards("key", SOURCE_TEXT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.privacyMode).toBe("standard");
  });
});

describe("generateFlashcards — kształt żądania HTTP do dostawcy", () => {
  // Jedyny test „stała przekazana bez zmiany" na tej warstwie: pełny kontrakt granicy HTTP
  // (endpoint z docs OpenRoutera, uwierzytelniony POST) w jednej asercji, nie pięć osobnych.
  it("POST na endpoint OpenRoutera z nagłówkami Authorization i Content-Type", async () => {
    const fetchMock = stubFetchResponses(httpResponse(validEnvelope(), 200));

    await generateFlashcards("klucz-abc", SOURCE_TEXT);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer klucz-abc");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("generateFlashcards — pole model i brak wycieku tekstu źródłowego", () => {
  it("kopertowe pole model jest przekazywane bez zmiany", async () => {
    stubFetchResponses(httpResponse(validEnvelope({ model: "google/gemini-2.5-pro" }), 200));

    const outcome = await generateFlashcards("key", SOURCE_TEXT);

    expect(outcome.model).toBe("google/gemini-2.5-pro");
  });

  it("brak pola model w kopercie → outcome.model spada do stałej MODEL", async () => {
    stubFetchResponses(httpResponse(validEnvelope({ model: undefined }), 200));

    const outcome = await generateFlashcards("key", SOURCE_TEXT);

    expect(outcome.model).toBe(MODEL);
  });

  const leakCases: { name: string; arrange: () => void }[] = [
    { name: "network", arrange: () => void stubFetchRejection(namedError("TypeError")) },
    { name: "timeout", arrange: () => void stubFetchRejection(namedError("AbortError")) },
    {
      name: "rate_limited (429)",
      arrange: () => void stubFetchResponses(httpResponse({ error: { message: "slow" } }, 429)),
    },
    {
      name: "upstream (401)",
      arrange: () => void stubFetchResponses(httpResponse({ error: { message: "bad key" } }, 401)),
    },
    {
      name: "upstream (200, nie-JSON)",
      arrange: () => void stubFetchResponses(httpResponse("<html>oops</html>", 200)),
    },
    {
      name: "malformed_response",
      arrange: () => void stubFetchResponses(httpResponse({ choices: [] }, 200)),
    },
    {
      name: "truncated",
      arrange: () =>
        void stubFetchResponses(
          httpResponse(validEnvelope({ choices: [{ finish_reason: "length", message: { content: "{" } }] }), 200),
        ),
    },
    {
      name: "no_proposals",
      arrange: () =>
        void stubFetchResponses(
          httpResponse(
            validEnvelope({
              choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ flashcards: [] }) } }],
            }),
            200,
          ),
        ),
    },
  ];

  it.each(leakCases)("klasa $name: żaden błąd nie niesie tekstu źródłowego", async ({ arrange }) => {
    arrange();

    const error = await rejection(generateFlashcards("key", SOURCE_TEXT));

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof OpenRouterError || error instanceof GenerationParseError).toBe(true);
    expect(error.message).not.toContain(SENTINEL);
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
  });
});
