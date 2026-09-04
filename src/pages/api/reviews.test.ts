import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";

import { GET, POST } from "./reviews";
import { createScheduler } from "@/lib/srs";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const FLASHCARD_ID = "11111111-1111-4111-8111-111111111111";
const SEED_NOW = new Date("2026-09-01T10:00:00.000Z");

const scheduler = createScheduler();
const REVIEW_ROW = scheduler.applyGrade(
  scheduler.applyGrade(scheduler.createNewCard(SEED_NOW), SEED_NOW, Rating.Easy),
  SEED_NOW,
  Rating.Good,
);

function queueRow(overrides: Record<string, unknown> = {}) {
  return { id: FLASHCARD_ID, front: "Pytanie?", back: "Odpowiedź.", ...REVIEW_ROW, ...overrides };
}

function cardsOf(payload: unknown): { id: string; intervals: Record<string, string> }[] {
  return (payload as { cards: { id: string; intervals: Record<string, string> }[] }).cards;
}

function context({
  user = { id: USER_ID },
  supabase = new SupabaseStub([]).asClient(),
  body,
  method = "GET",
}: {
  user?: { id: string } | null;
  supabase?: ReturnType<SupabaseStub["asClient"]> | null;
  body?: unknown;
  method?: string;
} = {}) {
  const request = new Request("http://localhost/api/reviews", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { locals: { user, supabase }, request } as never;
}

describe("reviews GET", () => {
  it("rejects unauthenticated and unavailable requests", async () => {
    const supabase = new SupabaseStub([]);
    expect((await GET(context({ user: null, supabase: supabase.asClient() }))).status).toBe(401);
    expect((await GET(context({ supabase: null }))).status).toBe(503);
    // O4-6: the handler denies before touching data — no query, no rpc on the unauthenticated path.
    expect(supabase.queries).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("returns the due-card queue wrapped in { cards }", async () => {
    const supabase = new SupabaseStub([{ data: [queueRow()], error: null }]);

    const response = await GET(context({ supabase: supabase.asClient() }));
    const cards = cardsOf(await response.json());

    expect(response.status).toBe(200);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(FLASHCARD_ID);
    expect(Object.keys(cards[0].intervals)).toEqual(["1", "2", "3", "4"]);
  });

  it("maps an invalid stored schedule state to 500", async () => {
    const supabase = new SupabaseStub([{ data: [queueRow({ state: 9 })], error: null }]);

    const response = await GET(context({ supabase: supabase.asClient() }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Nie udało się przetworzyć żądania sesji powtórkowej. Spróbuj ponownie.",
    });
  });
});

describe("reviews POST", () => {
  const postCtx = (over: Parameters<typeof context>[0] = {}) => context({ method: "POST", ...over });

  it("rejects unauthenticated and unavailable requests", async () => {
    const supabase = new SupabaseStub([]);
    const body = { flashcardId: FLASHCARD_ID, grade: 3 };
    const unauthenticated = await POST(postCtx({ user: null, supabase: supabase.asClient(), body }));
    const unavailable = await POST(postCtx({ supabase: null, body }));

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
    // O4-6: the handler denies before touching data — no query, no rpc on the unauthenticated path.
    expect(supabase.queries).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("rejects a malformed body and an out-of-range grade", async () => {
    const badJson = await POST(postCtx({ body: undefined }));
    const badShape = await POST(postCtx({ body: { flashcardId: "not-a-uuid", grade: 3 } }));
    const gradeZero = await POST(postCtx({ body: { flashcardId: FLASHCARD_ID, grade: 0 } }));
    const gradeFive = await POST(postCtx({ body: { flashcardId: FLASHCARD_ID, grade: 5 } }));

    expect(badJson.status).toBe(400);
    expect(badShape.status).toBe(400);
    expect(gradeZero.status).toBe(400);
    expect(gradeFive.status).toBe(400);
  });

  it("rejects a body carrying an extra clock field before the service runs", async () => {
    // `postBodySchema` jest `.strict()` (reviews.ts:20) — serwer jest właścicielem zegara,
    // klient nie może przemycić `now`/`date`.
    const supabase = new SupabaseStub([]);
    const response = await POST(
      postCtx({
        supabase: supabase.asClient(),
        body: { flashcardId: FLASHCARD_ID, grade: 3, now: "2020-01-01T00:00:00.000Z" },
      }),
    );

    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toEqual({ error: "Nieprawidłowe dane oceny." });
    expect(Object.keys(body as Record<string, unknown>)).toEqual(["error"]);
    expect(supabase.queries).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("records a grade and returns the bare { id }", async () => {
    const supabase = new SupabaseStub([
      { data: { id: FLASHCARD_ID, ...REVIEW_ROW }, error: null },
      { data: { id: FLASHCARD_ID }, error: null },
    ]);

    const response = await POST(
      postCtx({ supabase: supabase.asClient(), body: { flashcardId: FLASHCARD_ID, grade: 3 } }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: FLASHCARD_ID });
    expect(supabase.queries[1].filters).toEqual([
      ["id", FLASHCARD_ID],
      ["user_id", USER_ID],
      ["reps", REVIEW_ROW.reps],
    ]);
  });

  it("maps a missing flashcard to 404", async () => {
    const supabase = new SupabaseStub([{ data: null, error: null }]);

    const response = await POST(
      postCtx({ supabase: supabase.asClient(), body: { flashcardId: FLASHCARD_ID, grade: 3 } }),
    );

    expect(response.status).toBe(404);
  });

  it("absorbs a lost race as 409 with the conflict envelope", async () => {
    const supabase = new SupabaseStub([
      { data: { id: FLASHCARD_ID, ...REVIEW_ROW }, error: null },
      { data: null, error: null },
    ]);

    const response = await POST(
      postCtx({ supabase: supabase.asClient(), body: { flashcardId: FLASHCARD_ID, grade: 2 } }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Ta fiszka została już oceniona." });
    expect(supabase.queries[1].filters).toContainEqual(["reps", REVIEW_ROW.reps]);
  });
});
