import { describe, expect, expectTypeOf, it } from "vitest";
import { State } from "ts-fsrs";
import { scheduleStateRowSchema, scheduleStateRowToCard, cardToScheduleStateRow } from "./index";
import type { ScheduleStateRow } from "./index";

const row: ScheduleStateRow = {
  due: "2026-08-24T10:00:00.000Z",
  stability: 12.5,
  difficulty: 6.25,
  scheduled_days: 14,
  learning_steps: 1,
  reps: 8,
  lapses: 2,
  state: State.Review,
  last_review: "2026-08-23T10:00:00.000Z",
};

describe("schedule state", () => {
  it("round-trips all persisted fields and converts dates", () => {
    const card = scheduleStateRowToCard(row);
    const roundTripped = cardToScheduleStateRow(card);

    expect(card.due).toBeInstanceOf(Date);
    expect(card.last_review).toBeInstanceOf(Date);
    expect(roundTripped).toEqual(row);
  });

  it("round-trips a missing last review as null", () => {
    const card = scheduleStateRowToCard({ ...row, last_review: null });

    expect(card.last_review).toBeUndefined();
    expect(cardToScheduleStateRow(card).last_review).toBeNull();
  });

  it("rejects an invalid state", () => {
    const result = scheduleStateRowSchema.safeParse({ ...row, state: 4 });

    expect(result.success).toBe(false);
  });

  it("rejects a row with a missing required field", () => {
    const { lapses: _lapses, ...incompleteRow } = row;
    const result = scheduleStateRowSchema.safeParse(incompleteRow);

    expect(result.success).toBe(false);
    if (result.success) {
      expectTypeOf(result.data).not.toBeAny();
    }
  });

  it("rejects invalid domain values", () => {
    expect(scheduleStateRowSchema.safeParse({ ...row, stability: -1 }).success).toBe(false);
    expect(scheduleStateRowSchema.safeParse({ ...row, difficulty: 11 }).success).toBe(false);
    expect(scheduleStateRowSchema.safeParse({ ...row, reps: -1 }).success).toBe(false);
  });
});
