import { createEmptyCard, fsrs, generatorParameters, Rating } from "ts-fsrs";
import type { FSRSParameters, Grade } from "ts-fsrs";
import { cardToScheduleStateRow, scheduleStateRowToCard } from "./schedule-state";
import type { ScheduleStateRow } from "./schedule-state";

export type SchedulePreview = Record<Grade, ScheduleStateRow>;

export interface ScheduleOperations {
  createNewCard(now: Date): ScheduleStateRow;
  preview(row: ScheduleStateRow, now: Date): SchedulePreview;
  applyGrade(row: ScheduleStateRow, now: Date, grade: Grade): ScheduleStateRow;
}

export function createScheduler(parameters?: Partial<FSRSParameters>): ScheduleOperations {
  const scheduler = fsrs(generatorParameters(parameters));

  return {
    createNewCard(now) {
      return cardToScheduleStateRow(createEmptyCard(now));
    },
    preview(row, now) {
      const card = scheduleStateRowToCard(row);
      const preview = scheduler.repeat(card, now);

      return {
        [Rating.Again]: cardToScheduleStateRow(preview[Rating.Again].card),
        [Rating.Hard]: cardToScheduleStateRow(preview[Rating.Hard].card),
        [Rating.Good]: cardToScheduleStateRow(preview[Rating.Good].card),
        [Rating.Easy]: cardToScheduleStateRow(preview[Rating.Easy].card),
      };
    },
    applyGrade(row, now, grade) {
      const card = scheduleStateRowToCard(row);
      return cardToScheduleStateRow(scheduler.next(card, now, grade).card);
    },
  };
}
