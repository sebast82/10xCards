import { describe, expect, it } from "vitest";

import { POST } from "./flashcards";
import { BACK_MAX_LENGTH, FRONT_MAX_LENGTH } from "@/lib/limits";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";

const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const FLASHCARD_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-09-01T12:00:00Z";

function context({
  user = { id: USER_ID },
  supabase = new SupabaseStub([]).asClient(),
  body = { front: "Pytanie?", back: "Odpowiedź." },
  request = new Request("http://localhost/api/flashcards", {
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

describe("flashcards POST API", () => {
  it("creates a manual card with trimmed content and authoritative timestamp", async () => {
    const supabase = new SupabaseStub([{ data: { id: FLASHCARD_ID, created_at: CREATED_AT }, error: null }]);

    const response = await POST(
      context({
        supabase: supabase.asClient(),
        body: { front: "  Pytanie ręczne?  ", back: "  Odpowiedź ręczna.  " },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: FLASHCARD_ID, created_at: CREATED_AT });
    expect(supabase.queries[0].payload).toMatchObject({
      user_id: USER_ID,
      generation_id: null,
      source: "manual",
      front: "Pytanie ręczne?",
      back: "Odpowiedź ręczna.",
    });
    expect(supabase.rpcCalls).toEqual([]);
  });

  it("accepts manual content at the trimmed database limits", async () => {
    const supabase = new SupabaseStub([{ data: { id: FLASHCARD_ID, created_at: CREATED_AT }, error: null }]);

    const response = await POST(
      context({
        supabase: supabase.asClient(),
        body: { front: ` ${"P".repeat(FRONT_MAX_LENGTH)} `, back: ` ${"O".repeat(BACK_MAX_LENGTH)} ` },
      }),
    );

    expect(response.status).toBe(201);
    expect(supabase.queries[0].payload?.front).toHaveLength(FRONT_MAX_LENGTH);
    expect(supabase.queries[0].payload?.back).toHaveLength(BACK_MAX_LENGTH);
  });

  it("rejects malformed and mixed request bodies before service work", async () => {
    const malformed = await POST(context({ body: { front: "", back: "Odpowiedź." } }));
    const mixed = await POST(
      context({
        body: { generationId: GENERATION_ID, front: "Pytanie?", back: "Odpowiedź.", edited: false, source: "manual" },
      }),
    );
    const ambiguous = await POST(context({ body: { front: "Pytanie?", back: "Odpowiedź.", edited: false } }));

    expect(malformed.status).toBe(400);
    expect(mixed.status).toBe(400);
    expect(ambiguous.status).toBe(400);
  });

  it("rejects unauthenticated and unavailable requests", async () => {
    const supabase = new SupabaseStub([]);
    const unauthenticated = await POST(context({ user: null, supabase: supabase.asClient() }));
    const unavailable = await POST(context({ supabase: null }));

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
    // O4-6: the handler denies before touching data — no query, no rpc on the unauthenticated path.
    expect(supabase.queries).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("maps manual persistence failures to the static response", async () => {
    const response = await POST(
      context({ supabase: new SupabaseStub([{ data: null, error: { message: "boom" } }]).asClient() }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Nie udało się zapisać fiszki. Spróbuj ponownie." });
  });

  it("preserves the accepted AI proposal request branch", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: { id: FLASHCARD_ID }, error: null },
      { data: null, error: null },
    ]);

    const response = await POST(
      context({
        supabase: supabase.asClient(),
        body: { generationId: GENERATION_ID, front: "Pytanie AI?", back: "Odpowiedź AI.", edited: true },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: FLASHCARD_ID });
    // Third filter is the AI-create generation lookup's `.eq("user_id")` (service.ts) — regression guard
    // that owner-scoping did not disappear; cross-account proof is pgTAP (supabase/tests/rls_generations.test.sql).
    expect(supabase.queries[0]).toMatchObject({
      table: "generations",
      filters: [
        ["id", GENERATION_ID],
        ["status", "succeeded"],
        ["user_id", USER_ID],
      ],
    });
    expect(supabase.queries[1].payload).toMatchObject({
      generation_id: GENERATION_ID,
      source: "ai_edited",
      front: "Pytanie AI?",
      back: "Odpowiedź AI.",
    });
    expect(supabase.rpcCalls).toEqual([
      { name: "recount_generation_acceptance", args: { p_generation_id: GENERATION_ID } },
    ]);
  });
});
