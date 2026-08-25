import { describe, expect, expectTypeOf, it } from "vitest";
import type { ScheduleStateRow } from "../lib/srs/schedule-state";
import type { Database } from "./database.types";

type FlashcardRow = Database["public"]["Tables"]["flashcards"]["Row"];

describe("database schema contract", () => {
  // Asercję typu egzekwuje `npx astro check` (i CI), nie Vitest — bez `--typecheck` jest wymazywana.
  it("keeps flashcard schedule row values aligned with the database schema", () => {
    expectTypeOf<ScheduleStateRow>().toExtend<Pick<FlashcardRow, keyof ScheduleStateRow>>();
  });

  it("exposes the expected flashcard source enum values", () => {
    const values: Database["public"]["Enums"]["flashcard_source"][] = ["ai", "ai_edited", "manual"];

    expect(values).toHaveLength(3);
    expect(values).toEqual(["ai", "ai_edited", "manual"]);
  });
});
