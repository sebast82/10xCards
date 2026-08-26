import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenRouterError } from "@/lib/openrouter/client";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";

const generateFlashcards = vi.hoisted(() => vi.fn());

vi.mock("@/lib/openrouter/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/openrouter/client")>();
  return { ...actual, generateFlashcards };
});

const { createGeneration, DAILY_GENERATION_LIMIT, GenerationServiceError } = await import("./service");

const USER_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_TEXT = "a".repeat(400);

function input(supabase: SupabaseStub) {
  return { supabase: supabase.asClient(), userId: USER_ID, sourceText: SOURCE_TEXT, apiKey: "key" };
}

function succeeds() {
  generateFlashcards.mockResolvedValue({
    proposals: [
      { front: "P1", back: "O1" },
      { front: "P2", back: "O2" },
    ],
    model: "google/gemini-2.5-flash",
    privacyMode: "zdr",
  });
}

beforeEach(() => {
  generateFlashcards.mockReset();
});

describe("createGeneration", () => {
  it("refuses once the daily limit is reached and never calls the model", async () => {
    const supabase = new SupabaseStub([{ count: DAILY_GENERATION_LIMIT, error: null }]);

    await expect(createGeneration(input(supabase))).rejects.toMatchObject({ code: "daily_limit_exceeded" });
    expect(generateFlashcards).not.toHaveBeenCalled();
  });

  it("maps a failing quota lookup to a typed error", async () => {
    const supabase = new SupabaseStub([{ count: 0, error: { message: "boom" } }]);

    await expect(createGeneration(input(supabase))).rejects.toBeInstanceOf(GenerationServiceError);
  });

  it("reserves the row before calling the model so parallel requests see it", async () => {
    succeeds();
    const supabase = new SupabaseStub([
      { count: 0, error: null },
      { data: { id: GENERATION_ID }, error: null },
      { data: null, error: null },
    ]);

    await createGeneration(input(supabase));

    const reservation = supabase.queries[1];
    expect(reservation.operation).toBe("insert");
    expect(reservation.payload).toMatchObject({ status: "pending", user_id: USER_ID });
    expect(generateFlashcards.mock.invocationCallOrder[0]).toBeGreaterThan(0);
  });

  it("persists only the length and a 64-character hash of the source text", async () => {
    succeeds();
    const supabase = new SupabaseStub([
      { count: 0, error: null },
      { data: { id: GENERATION_ID }, error: null },
      { data: null, error: null },
    ]);

    await createGeneration(input(supabase));

    const payload = supabase.queries[1].payload ?? {};
    expect(payload).toMatchObject({ source_text_length: SOURCE_TEXT.length });
    expect(payload.source_text_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(payload)).not.toContain(SOURCE_TEXT);
  });

  it("fills in generated_count and marks the row succeeded", async () => {
    succeeds();
    const supabase = new SupabaseStub([
      { count: 0, error: null },
      { data: { id: GENERATION_ID }, error: null },
      { data: null, error: null },
    ]);

    const result = await createGeneration(input(supabase));

    expect(supabase.queries[2].payload).toMatchObject({ generated_count: 2, status: "succeeded" });
    expect(result.generationId).toBe(GENERATION_ID);
  });

  it("marks the reserved row failed with the error code and rethrows", async () => {
    generateFlashcards.mockRejectedValue(new OpenRouterError("timeout"));
    const supabase = new SupabaseStub([
      { count: 0, error: null },
      { data: { id: GENERATION_ID }, error: null },
      { data: null, error: null },
    ]);

    await expect(createGeneration(input(supabase))).rejects.toBeInstanceOf(OpenRouterError);
    expect(supabase.queries[2].payload).toEqual({ status: "failed", error_code: "timeout" });
  });
});
