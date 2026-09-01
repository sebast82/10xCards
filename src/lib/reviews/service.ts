import type { SupabaseClient } from "@supabase/supabase-js";
import { Rating } from "ts-fsrs";
import type { Grade } from "ts-fsrs";

import type { Database } from "@/db/database.types";
import { createScheduler, scheduleStateRowSchema } from "@/lib/srs";
import { formatInterval } from "./interval";

export type ReviewServiceErrorCode =
  | "schedule_state_invalid"
  | "flashcard_not_found"
  | "grade_conflict"
  | "persist_failed";

const ERROR_MESSAGES: Record<ReviewServiceErrorCode, string> = {
  schedule_state_invalid: "Nie udało się odczytać stanu powtórek tej fiszki.",
  flashcard_not_found: "Nie znaleziono fiszki.",
  grade_conflict: "Ta fiszka została już oceniona.",
  persist_failed: "Nie udało się zapisać oceny. Spróbuj ponownie.",
};

export class ReviewServiceError extends Error {
  readonly code: ReviewServiceErrorCode;

  constructor(code: ReviewServiceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ReviewServiceError";
    this.code = code;
  }
}

// Sufit chroni budżet 10 ms CPU — karty ocenione "Znowu" wracają jako wymagalne, więc wyspa i tak dobiera ponownie.
export const REVIEW_BATCH_SIZE = 50;

// Dziewięć kolumn harmonogramu + `id` do zbudowania odpowiedzi. `front`/`back` tylko w kolejce.
const QUEUE_COLUMNS =
  "id, front, back, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review";
const GRADE_COLUMNS =
  "id, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review";

export interface ReviewCard {
  id: string;
  front: string;
  back: string;
  intervals: Record<Grade, string>;
}

export interface GetReviewQueueInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  now: Date;
}

export interface ApplyReviewGradeInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  flashcardId: string;
  grade: Grade;
  now: Date;
}

export async function getReviewQueue({ supabase, userId, now }: GetReviewQueueInput): Promise<ReviewCard[]> {
  // `.eq("user_id", …)` celuje w indeks `(user_id, due)`, izolację daje RLS. `.range` ze stałą, nie `.limit()`.
  const { data, error } = await supabase
    .from("flashcards")
    .select(QUEUE_COLUMNS)
    .eq("user_id", userId)
    .lte("due", now.toISOString())
    .order("due", { ascending: true })
    .range(0, REVIEW_BATCH_SIZE - 1);

  if (error) {
    throw new ReviewServiceError("persist_failed");
  }

  const scheduler = createScheduler();

  return data.map((row) => {
    const parsed = scheduleStateRowSchema.safeParse(row);
    if (!parsed.success) {
      // eslint-disable-next-line no-console -- samo id fiszki, bez treści użytkownika
      console.error("review queue: nieprawidłowy stan harmonogramu", row.id);
      throw new ReviewServiceError("schedule_state_invalid");
    }

    const preview = scheduler.preview(parsed.data, now);
    const intervals: Record<Grade, string> = {
      [Rating.Again]: formatInterval(preview[Rating.Again].due, now),
      [Rating.Hard]: formatInterval(preview[Rating.Hard].due, now),
      [Rating.Good]: formatInterval(preview[Rating.Good].due, now),
      [Rating.Easy]: formatInterval(preview[Rating.Easy].due, now),
    };

    return { id: row.id, front: row.front, back: row.back, intervals };
  });
}

export async function applyReviewGrade({
  supabase,
  userId,
  flashcardId,
  grade,
  now,
}: ApplyReviewGradeInput): Promise<{ id: string }> {
  const { data: row, error: readError } = await supabase
    .from("flashcards")
    .select(GRADE_COLUMNS)
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    throw new ReviewServiceError("persist_failed");
  }

  if (!row) {
    throw new ReviewServiceError("flashcard_not_found");
  }

  const parsed = scheduleStateRowSchema.safeParse(row);
  if (!parsed.success) {
    // eslint-disable-next-line no-console -- samo id fiszki, bez treści użytkownika
    console.error("review grade: nieprawidłowy stan harmonogramu", flashcardId);
    throw new ReviewServiceError("schedule_state_invalid");
  }

  const previousReps = parsed.data.reps;
  const next = createScheduler().applyGrade(parsed.data, now, grade);

  // `reps` rośnie przy każdym `next()` — warunek na poprzedniej wartości wykrywa równoległą ocenę.
  // `updated_at` zostawiamy triggerowi bazy.
  const { data: updated, error: writeError } = await supabase
    .from("flashcards")
    .update({
      due: next.due,
      stability: next.stability,
      difficulty: next.difficulty,
      scheduled_days: next.scheduled_days,
      learning_steps: next.learning_steps,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      last_review: next.last_review,
    })
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .eq("reps", previousReps)
    .select("id")
    .maybeSingle();

  if (writeError) {
    throw new ReviewServiceError("persist_failed");
  }

  if (!updated) {
    throw new ReviewServiceError("grade_conflict");
  }

  return { id: updated.id };
}
