import { describe, expect, it } from "vitest";
import { Rating, State } from "ts-fsrs";
import { createScheduler } from "./index";

const now = new Date("2026-08-24T10:00:00.000Z");

describe("scheduler", () => {
  it("creates a new card with zero counters", () => {
    const card = createScheduler().createNewCard(now);

    expect(card).toMatchObject({
      due: now.toISOString(),
      stability: 0,
      difficulty: 0,
      scheduled_days: 0,
      learning_steps: 0,
      reps: 0,
      lapses: 0,
      state: State.New,
      last_review: null,
    });
  });

  it("moves a new card to learning after Good", () => {
    const scheduler = createScheduler();
    const newCard = scheduler.createNewCard(now);
    const reviewedCard = scheduler.applyGrade(newCard, now, Rating.Good);

    expect(reviewedCard.state).toBe(State.Learning);
    expect(reviewedCard.last_review).toBe(now.toISOString());
  });

  it("returns four previews without mutating the input", () => {
    const scheduler = createScheduler();
    const newCard = scheduler.createNewCard(now);
    const before = structuredClone(newCard);
    const preview = scheduler.preview(newCard, now);

    expect(Object.keys(preview)).toHaveLength(4);
    expect(newCard).toEqual(before);
    expect(preview[Rating.Again]).toBeDefined();
    expect(preview[Rating.Hard]).toBeDefined();
    expect(preview[Rating.Good]).toBeDefined();
    expect(preview[Rating.Easy]).toBeDefined();
  });

  it("increments lapses after Again on a review card", () => {
    const scheduler = createScheduler();
    let card = scheduler.createNewCard(now);
    card = scheduler.applyGrade(card, now, Rating.Easy);
    card = scheduler.applyGrade(card, now, Rating.Easy);
    const lapsesBefore = card.lapses;

    const reviewedCard = scheduler.applyGrade(card, now, Rating.Again);

    expect(card.state).toBe(State.Review);
    expect(reviewedCard.lapses).toBe(lapsesBefore + 1);
  });

  it("is deterministic for the same card, grade, and time", () => {
    const scheduler = createScheduler();
    const card = scheduler.createNewCard(now);

    expect(scheduler.applyGrade(card, now, Rating.Good)).toEqual(scheduler.applyGrade(card, now, Rating.Good));
  });
});
