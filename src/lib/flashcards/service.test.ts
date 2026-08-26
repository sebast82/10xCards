import { describe, expect, it } from "vitest";

import { createAiFlashcard, FlashcardServiceError } from "./service";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";

const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function input(overrides: Partial<Parameters<typeof createAiFlashcard>[0]> = {}) {
  return {
    supabase: new SupabaseStub([]).asClient(),
    userId: USER_ID,
    generationId: GENERATION_ID,
    front: "Pytanie?",
    back: "Odpowiedź.",
    edited: false,
    ...overrides,
  };
}

describe("createAiFlashcard", () => {
  it("rejects a generation the caller cannot see", async () => {
    const supabase = new SupabaseStub([{ data: null, error: null }]);

    await expect(createAiFlashcard(input({ supabase: supabase.asClient() }))).rejects.toMatchObject({
      code: "generation_not_found",
    });
    expect(supabase.queries).toHaveLength(1);
  });

  it("narrows the lookup to completed generations", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: { id: "fc" }, error: null },
      { data: null, error: null },
    ]);

    await createAiFlashcard(input({ supabase: supabase.asClient() }));

    expect(supabase.queries[0].filters).toEqual([
      ["id", GENERATION_ID],
      ["status", "succeeded"],
    ]);
  });

  it("stores source 'ai' when the proposal was not edited", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: { id: "fc" }, error: null },
      { data: null, error: null },
    ]);

    await createAiFlashcard(input({ supabase: supabase.asClient(), edited: false }));

    expect(supabase.queries[1].payload).toMatchObject({ source: "ai", user_id: USER_ID });
  });

  it("stores source 'ai_edited' when the proposal was edited", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: { id: "fc" }, error: null },
      { data: null, error: null },
    ]);

    await createAiFlashcard(input({ supabase: supabase.asClient(), edited: true }));

    expect(supabase.queries[1].payload).toMatchObject({ source: "ai_edited" });
  });

  it("writes the nine schedule columns alongside the card", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: { id: "fc" }, error: null },
      { data: null, error: null },
    ]);

    await createAiFlashcard(input({ supabase: supabase.asClient() }));

    expect(Object.keys(supabase.queries[1].payload ?? {})).toEqual(
      expect.arrayContaining([
        "due",
        "stability",
        "difficulty",
        "scheduled_days",
        "learning_steps",
        "reps",
        "lapses",
        "state",
        "last_review",
      ]),
    );
  });

  it("recounts the acceptance metrics for the generation", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: { id: "fc" }, error: null },
      { data: null, error: null },
    ]);

    await createAiFlashcard(input({ supabase: supabase.asClient() }));

    expect(supabase.rpcCalls).toEqual([
      { name: "recount_generation_acceptance", args: { p_generation_id: GENERATION_ID } },
    ]);
  });

  it("surfaces a persist failure as a typed error", async () => {
    const supabase = new SupabaseStub([
      { data: { id: GENERATION_ID }, error: null },
      { data: null, error: { message: "boom" } },
    ]);

    await expect(createAiFlashcard(input({ supabase: supabase.asClient() }))).rejects.toBeInstanceOf(
      FlashcardServiceError,
    );
  });
});
