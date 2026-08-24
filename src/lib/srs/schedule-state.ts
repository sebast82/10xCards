import { z } from "zod";
import { TypeConvert } from "ts-fsrs";
import type { Card, CardInput } from "ts-fsrs";

const stateSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const scheduleStateRowSchema = z.object({
  due: z.iso.datetime({ offset: true }),
  stability: z.number().nonnegative(),
  difficulty: z.number().min(0).max(10),
  scheduled_days: z.number().int().nonnegative(),
  learning_steps: z.number().int().nonnegative(),
  reps: z.number().int().nonnegative(),
  lapses: z.number().int().nonnegative(),
  state: stateSchema,
  last_review: z.iso.datetime({ offset: true }).nullable(),
});

export type ScheduleStateRow = z.infer<typeof scheduleStateRowSchema>;

export function scheduleStateRowToCard(row: ScheduleStateRow): Card {
  const validatedRow = scheduleStateRowSchema.parse(row);
  const cardInput: CardInput = {
    ...validatedRow,
    elapsed_days: 0,
    last_review: validatedRow.last_review,
  };

  return TypeConvert.card(cardInput);
}

export function cardToScheduleStateRow(card: Card): ScheduleStateRow {
  return scheduleStateRowSchema.parse({
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.toISOString() ?? null,
  });
}
