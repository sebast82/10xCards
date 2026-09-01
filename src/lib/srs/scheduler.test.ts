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

  it("previews the exact state that grading later applies, for every grade (S-05 label parity)", () => {
    // GET etykietuje przycisk oceny przez `preview(row, now)[grade]` (repeat()), a zapis
    // wykonuje `applyGrade(row, now, grade)` (next()). Etykieta nie może kłamać o skutku oceny.
    const scheduler = createScheduler();
    const learningCard = scheduler.applyGrade(scheduler.createNewCard(now), now, Rating.Good);
    const reviewCard = scheduler.applyGrade(
      scheduler.applyGrade(scheduler.createNewCard(now), now, Rating.Easy),
      now,
      Rating.Easy,
    );
    const later = new Date("2026-09-10T10:00:00.000Z");

    for (const card of [learningCard, reviewCard]) {
      const preview = scheduler.preview(card, later);
      for (const grade of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const) {
        expect(preview[grade]).toEqual(scheduler.applyGrade(card, later, grade));
      }
    }
  });
});
