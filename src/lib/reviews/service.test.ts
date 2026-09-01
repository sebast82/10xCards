import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";

import { createScheduler } from "@/lib/srs";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";
import { applyReviewGrade, getReviewQueue, REVIEW_BATCH_SIZE, ReviewServiceError } from "./service";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const FLASHCARD_ID = "11111111-1111-4111-8111-111111111111";
const SEED_NOW = new Date("2026-09-01T10:00:00.000Z");
const NOW = new Date("2026-09-02T12:00:00.000Z");

// Poprawny wiersz harmonogramu wyprowadzony z modułu SRS — karta w stanie "review" po dwóch ocenach.
const scheduler = createScheduler();
const REVIEW_ROW = scheduler.applyGrade(
  scheduler.applyGrade(scheduler.createNewCard(SEED_NOW), SEED_NOW, Rating.Easy),
  SEED_NOW,
  Rating.Good,
);

function queueRow(overrides: Record<string, unknown> = {}) {
  return { id: FLASHCARD_ID, front: "Pytanie?", back: "Odpowiedź.", ...REVIEW_ROW, ...overrides };
}

describe("getReviewQueue", () => {
  it("queries due cards by the (user_id, due) index in due order and caps the batch", async () => {
    const supabase = new SupabaseStub([{ data: [queueRow()], error: null }]);

    const cards = await getReviewQueue({ supabase: supabase.asClient(), userId: USER_ID, now: NOW });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: FLASHCARD_ID, front: "Pytanie?", back: "Odpowiedź." });
    expect(Object.keys(cards[0].intervals)).toEqual(["1", "2", "3", "4"]);
    for (const label of Object.values(cards[0].intervals)) {
      expect(label).toMatch(/^(za \d+ (min|godz\.|dni|mies\.)|jutro)$/);
    }

    const query = supabase.queries[0];
    expect(query.table).toBe("flashcards");
    expect(query.filters).toEqual([
      ["user_id", USER_ID],
      ["due", NOW.toISOString()],
    ]);
    expect(query.order).toEqual({ column: "due", ascending: true });
    expect(query.range).toEqual([0, REVIEW_BATCH_SIZE - 1]);
  });

  it("throws schedule_state_invalid on a malformed row", async () => {
    const supabase = new SupabaseStub([{ data: [queueRow({ state: 9 })], error: null }]);

    await expect(getReviewQueue({ supabase: supabase.asClient(), userId: USER_ID, now: NOW })).rejects.toMatchObject({
      code: "schedule_state_invalid",
    });
  });

  it("maps a failing query to persist_failed", async () => {
    const supabase = new SupabaseStub([{ data: null, error: { message: "boom" } }]);

    await expect(getReviewQueue({ supabase: supabase.asClient(), userId: USER_ID, now: NOW })).rejects.toBeInstanceOf(
      ReviewServiceError,
    );
  });

  it("returns an empty list when nothing is due", async () => {
    const supabase = new SupabaseStub([{ data: [], error: null }]);

    await expect(getReviewQueue({ supabase: supabase.asClient(), userId: USER_ID, now: NOW })).resolves.toEqual([]);
  });
});

describe("applyReviewGrade", () => {
  it("advances the schedule under a reps-guarded update", async () => {
    const supabase = new SupabaseStub([
      { data: { id: FLASHCARD_ID, ...REVIEW_ROW }, error: null },
      { data: { id: FLASHCARD_ID }, error: null },
    ]);

    const result = await applyReviewGrade({
      supabase: supabase.asClient(),
      userId: USER_ID,
      flashcardId: FLASHCARD_ID,
      grade: Rating.Good,
      now: NOW,
    });

    expect(result).toEqual({ id: FLASHCARD_ID });

    const update = supabase.queries[1];
    expect(update.operation).toBe("update");
    expect(update.filters).toEqual([
      ["id", FLASHCARD_ID],
      ["user_id", USER_ID],
      ["reps", REVIEW_ROW.reps],
    ]);
    expect(update.payload).toMatchObject({ reps: REVIEW_ROW.reps + 1 });
    expect(update.payload).not.toHaveProperty("updated_at");
  });

  it("throws flashcard_not_found when the pre-read is null", async () => {
    const supabase = new SupabaseStub([{ data: null, error: null }]);

    await expect(
      applyReviewGrade({
        supabase: supabase.asClient(),
        userId: USER_ID,
        flashcardId: FLASHCARD_ID,
        grade: Rating.Good,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "flashcard_not_found" });
  });

  it("throws schedule_state_invalid when the stored row is malformed", async () => {
    const supabase = new SupabaseStub([{ data: { id: FLASHCARD_ID, ...REVIEW_ROW, difficulty: 99 }, error: null }]);

    await expect(
      applyReviewGrade({
        supabase: supabase.asClient(),
        userId: USER_ID,
        flashcardId: FLASHCARD_ID,
        grade: Rating.Good,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "schedule_state_invalid" });
  });

  it("throws grade_conflict when the guarded update matches no row", async () => {
    const supabase = new SupabaseStub([
      { data: { id: FLASHCARD_ID, ...REVIEW_ROW }, error: null },
      { data: null, error: null },
    ]);

    await expect(
      applyReviewGrade({
        supabase: supabase.asClient(),
        userId: USER_ID,
        flashcardId: FLASHCARD_ID,
        grade: Rating.Good,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "grade_conflict" });
  });

  it("maps a failing update to persist_failed", async () => {
    const supabase = new SupabaseStub([
      { data: { id: FLASHCARD_ID, ...REVIEW_ROW }, error: null },
      { data: null, error: { message: "boom" } },
    ]);

    await expect(
      applyReviewGrade({
        supabase: supabase.asClient(),
        userId: USER_ID,
        flashcardId: FLASHCARD_ID,
        grade: Rating.Good,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "persist_failed" });
  });
});
