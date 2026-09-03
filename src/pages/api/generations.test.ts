import { afterEach, describe, expect, it, vi } from "vitest";

import { DAILY_GENERATION_LIMIT } from "@/lib/generations/service";
import { OpenRouterError } from "@/lib/openrouter/client";
import { MODEL } from "@/lib/openrouter/prompt";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";

// Import `./generations` pod Vitestem pada na `astro:env/server` — ten mock odblokowuje import.
// Getter zamiast stałej: pozwala zmutować klucz między testami (gałąź 503 „brak konfiguracji serwera").
const keyState = vi.hoisted((): { value: string } => ({ value: "test-openrouter-key" }));
vi.mock("astro:env/server", () => ({
  get OPENROUTER_API_KEY() {
    return keyState.value;
  },
}));

import { POST } from "./generations";

// Sentinel ryzyka #5 — jedyny marker w tym pliku. Nie może wystąpić w żadnym zapisie ani ciele błędu.
const SENTINEL = "SEKRET-";
const SOURCE_TEXT = `${SENTINEL}${"x".repeat(400)}`;
const USER_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "11111111-1111-4111-8111-111111111111";

// Literały drabiny statusów i koperty `{ error: string }` pochodzą z planu S-02
// (context/archive/2026-08-25-first-gated-generation) — tekst napisany przed kodem, nie z kształtu trasy.
const KEY_DEFAULT = "test-openrouter-key";

function context({
  user = { id: USER_ID },
  supabase = new SupabaseStub([]).asClient(),
  body = { sourceText: SOURCE_TEXT },
  request = new Request("http://localhost/api/generations", {
    method: "POST",
    body: JSON.stringify(body),
  }),
}: {
  user?: { id: string } | null;
  supabase?: ReturnType<SupabaseStub["asClient"]> | null;
  body?: unknown;
  request?: Request;
} = {}) {
  return { locals: { user, supabase }, request } as never;
}

function httpResponse(body: string | Record<string, unknown>, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { "Content-Type": "application/json" } });
}

function namedError(name: string): Error {
  const error = new Error("fetch failure (test)");
  error.name = name;
  return error;
}

function stubFetchResponse(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubFetchRejection(error: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(error);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Poprawna koperta wg envelopeSchema z parse.ts — dla ścieżek, które muszą dojść do parsowania treści.
function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  return body as Record<string, unknown>;
}

// Kolejka SupabaseStub jest pozycyjna: createGeneration robi select(limit) → insert(rezerwacja) → update.
// Na ścieżce awarii dostawcy trzeci wynik w kolejce to update wykonany przez markFailed.
function reservedThenFailover(markFailedResult: { error: unknown } = { error: null }): SupabaseStub {
  return new SupabaseStub([{ count: 0, error: null }, { data: { id: GENERATION_ID }, error: null }, markFailedResult]);
}

// Klasy awarii dostawcy wg research.md §2 (A/B/C1/C2/E/F/I) — każda wyzwalana wyłącznie przez stub `fetch`.
const providerFailures: { klasa: string; arrange: () => void }[] = [
  { klasa: "network", arrange: () => void stubFetchRejection(namedError("TypeError")) },
  { klasa: "timeout", arrange: () => void stubFetchRejection(namedError("AbortError")) },
  {
    klasa: "rate_limited",
    arrange: () => void stubFetchResponse(httpResponse({ error: { message: "slow down" } }, 429)),
  },
  { klasa: "upstream", arrange: () => void stubFetchResponse(httpResponse({ error: { message: "bad key" } }, 401)) },
  { klasa: "malformed_response", arrange: () => void stubFetchResponse(httpResponse({ choices: [] }, 200)) },
  {
    klasa: "truncated",
    arrange: () =>
      void stubFetchResponse(
        httpResponse(envelope({ choices: [{ finish_reason: "length", message: { content: "{" } }] }), 200),
      ),
  },
  {
    klasa: "no_proposals",
    arrange: () =>
      void stubFetchResponse(
        httpResponse(
          envelope({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ flashcards: [] }) } }] }),
          200,
        ),
      ),
  },
];

// Rozróżnialność jest wymagana wzajemnie tylko dla klas niosących instrukcję dla użytkownika.
const INSTRUCTION_BEARING = ["network", "timeout", "rate_limited", "truncated", "no_proposals"];

afterEach(() => {
  vi.unstubAllGlobals();
  keyState.value = KEY_DEFAULT;
});

describe("POST /api/generations — wejście odrzucone przed wywołaniem serwisu", () => {
  it("brak sesji → 401 ze stałym ciałem", async () => {
    const response = await POST(context({ user: null }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Zaloguj się, aby generować fiszki." });
  });

  it("503 z obu przyczyn: brak klienta Supabase oraz pusty OPENROUTER_API_KEY (mutacja klucza)", async () => {
    const noSupabase = await POST(context({ supabase: null }));

    keyState.value = "";
    const noKey = await POST(context());

    expect(noSupabase.status).toBe(503);
    expect(noKey.status).toBe(503);
    await expect(noSupabase.json()).resolves.toEqual({
      error: "Generowanie fiszek jest chwilowo niedostępne — brakuje konfiguracji serwera.",
    });
    await expect(noKey.json()).resolves.toEqual({
      error: "Generowanie fiszek jest chwilowo niedostępne — brakuje konfiguracji serwera.",
    });
  });

  it("400 dla ciała nie-JSON, tekstu za krótkiego i za długiego — jedno stałe ciało, klucze dokładnie ['error']", async () => {
    const nonJson = await POST(
      context({ request: new Request("http://localhost/api/generations", { method: "POST", body: "{" }) }),
    );
    const tooShort = await POST(context({ body: { sourceText: `${SENTINEL}krótki tekst` } }));
    const tooLong = await POST(context({ body: { sourceText: "x".repeat(10_001) } }));

    for (const response of [nonJson, tooShort, tooLong]) {
      expect(response.status).toBe(400);
      const body = await readBody(response);
      // Zakaz `error.issues`: Zod v4 potrafi zawrzeć wartość wejściową w issues[].received.
      expect(Object.keys(body)).toEqual(["error"]);
      expect(JSON.stringify(body)).not.toContain(SENTINEL);
    }
  });

  it("sourceText krótszy niż minimum dopiero po przycięciu białych znaków → 400 (walidacja na przyciętej wartości)", async () => {
    const padded = `${" ".repeat(20)}${"x".repeat(190)}${" ".repeat(20)}`;

    const response = await POST(context({ body: { sourceText: padded } }));

    expect(response.status).toBe(400);
  });
});

describe("POST /api/generations — klasy awarii dostawcy → 502", () => {
  it.each(providerFailures)("klasa $klasa → 502 ze stałym, nie-pustym ciałem", async ({ arrange }) => {
    arrange();

    const response = await POST(context({ supabase: reservedThenFailover().asClient() }));

    expect(response.status).toBe(502);
    const body = await readBody(response);
    expect(typeof body.error).toBe("string");
    expect((body.error as string).trim().length).toBeGreaterThan(0);
  });

  it("ciała błędu klas niosących instrukcję są wzajemnie różne (porównanie między sobą)", async () => {
    const messages: string[] = [];

    for (const { arrange } of providerFailures.filter((f) => INSTRUCTION_BEARING.includes(f.klasa))) {
      arrange();
      const response = await POST(context({ supabase: reservedThenFailover().asClient() }));
      messages.push((await readBody(response)).error as string);
      vi.unstubAllGlobals();
    }

    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("stałe ciało dla klasy timeout jest komunikatem OpenRouterError bez zmiany (jedyny lekki test na warstwę)", async () => {
    stubFetchRejection(namedError("AbortError"));

    const response = await POST(context({ supabase: reservedThenFailover().asClient() }));

    expect((await readBody(response)).error).toBe(new OpenRouterError("timeout").message);
  });
});

describe("POST /api/generations — nasz limit dobowy vs limit dostawcy", () => {
  it("wyczerpany limit dobowy → 429, ciało zaczyna się od 'Wyczerpano dobowy limit'", async () => {
    const supabase = new SupabaseStub([{ count: DAILY_GENERATION_LIMIT, error: null }]);

    const response = await POST(context({ supabase: supabase.asClient() }));

    expect(response.status).toBe(429);
    expect((await readBody(response)).error).toMatch(/^Wyczerpano dobowy limit/);
  });

  it("limit dostawcy (rate_limited) daje 502, nie 429 — rozróżnialne od naszego limitu dobowego", async () => {
    stubFetchResponse(httpResponse({ error: { message: "slow down" } }, 429));

    const response = await POST(context({ supabase: reservedThenFailover().asClient() }));

    expect(response.status).toBe(502);
  });
});

describe("POST /api/generations — błędy trwałości serwisu → 500", () => {
  it("nieudane sprawdzenie limitu dobowego → 500", async () => {
    const supabase = new SupabaseStub([{ count: 0, error: { message: "boom" } }]);

    const response = await POST(context({ supabase: supabase.asClient() }));

    expect(response.status).toBe(500);
  });

  it("nieudana rezerwacja wiersza → 500", async () => {
    const supabase = new SupabaseStub([
      { count: 0, error: null },
      { data: null, error: { message: "boom" } },
    ]);

    const response = await POST(context({ supabase: supabase.asClient() }));

    expect(response.status).toBe(500);
  });

  it("nieoczekiwany, nie-typowany błąd → 500 ze stałym ciałem, bez wycieku komunikatu (ryzyko #5)", async () => {
    // Błąd spoza hierarchii GenerationServiceError / OpenRouterError / GenerationParseError:
    // trasa NIE może przełożyć jego `message` do ciała odpowiedzi (to byłby kanał wycieku).
    const throwingSupabase = {
      from() {
        throw new Error(`${SENTINEL}wewnętrzny błąd bazy`);
      },
    } as never;

    const response = await POST(context({ supabase: throwingSupabase }));

    expect(response.status).toBe(500);
    const body = await readBody(response);
    expect(body).toEqual({ error: "Nie udało się wygenerować fiszek. Spróbuj ponownie." });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  });
});

describe("POST /api/generations — Q3: obserwowalny kontrakt przy podwójnej awarii", () => {
  it("awaria dostawcy + nieudany markFailed jest nieodróżnialny od udanego markFailed (nadal 502, to samo ciało)", async () => {
    // Osierocony wiersz `pending` to znany dług (plan §What We're NOT Doing). Tu przypinamy wyłącznie
    // obserwowalny kontrakt: błąd update'u połknięty w service.ts, więc użytkownik dostaje ten sam 502
    // co przy awarii dostawcy bez drugiego błędu.
    stubFetchRejection(namedError("AbortError"));
    const baseline = await POST(context({ supabase: reservedThenFailover({ error: null }).asClient() }));
    vi.unstubAllGlobals();

    stubFetchRejection(namedError("AbortError"));
    const doubled = await POST(
      context({ supabase: reservedThenFailover({ error: { message: "update failed" } }).asClient() }),
    );

    expect(baseline.status).toBe(502);
    expect(doubled.status).toBe(502);
    expect(await readBody(doubled)).toEqual(await readBody(baseline));
  });
});

describe("POST /api/generations — zero dotknięcia flashcards (ryzyko #1)", () => {
  it("przy awarii dostawcy żadne zapytanie nie idzie do flashcards i nie ma wywołań rpc", async () => {
    stubFetchRejection(namedError("TypeError"));
    const supabase = reservedThenFailover();

    await POST(context({ supabase: supabase.asClient() }));

    expect(supabase.queries.every((q) => q.table !== "flashcards")).toBe(true);
    expect(supabase.rpcCalls).toEqual([]);
  });
});

describe("POST /api/generations — brak wycieku tekstu źródłowego (ryzyko #5)", () => {
  it("po awarii dostawcy żaden zapis nie zawiera tekstu źródłowego; rezerwacja niesie hash i długość", async () => {
    stubFetchResponse(httpResponse({ error: { message: "bad gateway" } }, 500));
    const supabase = reservedThenFailover();

    await POST(context({ supabase: supabase.asClient() }));

    const reservation = supabase.queries[1];
    expect(reservation.operation).toBe("insert");
    expect(reservation.payload).toMatchObject({ source_text_length: SOURCE_TEXT.length });
    expect(reservation.payload?.source_text_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(supabase.queries)).not.toContain(SENTINEL);
  });

  it("ciało błędu 400 nie zawiera odrzuconego tekstu źródłowego", async () => {
    const response = await POST(context({ body: { sourceText: `${SENTINEL}krótki tekst` } }));

    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(SENTINEL);
  });

  it("ciało błędu 502 nie zawiera tekstu źródłowego, gdy dostawca odbija prompt w odpowiedzi", async () => {
    stubFetchResponse(httpResponse({ error: { message: SOURCE_TEXT } }, 400));
    const supabase = reservedThenFailover();

    const response = await POST(context({ supabase: supabase.asClient() }));

    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SENTINEL);
  });
});
