// Progi współdzielone przez wyspę React, walidację serwerową i adapter modelu — stąd neutralna lokalizacja:
// import z `lib/openrouter/**` wciągałby domenę serwerową do bundla klienckiego.
export const SOURCE_TEXT_MIN = 200;
export const SOURCE_TEXT_MAX = 10_000;

// MAX_FLASHCARDS = ⌈SOURCE_TEXT_MAX / CHARS_PER_FLASHCARD⌉ — obie wartości zmienia się razem.
export const MAX_FLASHCARDS = 25;
const CHARS_PER_FLASHCARD = 400;

// Progi CHECK-ów w `public.flashcards`, liczone po `btrim`.
export const FRONT_MAX_LENGTH = 500;
export const BACK_MAX_LENGTH = 2000;

export function proposalCap(length: number): number {
  return Math.min(MAX_FLASHCARDS, Math.ceil(length / CHARS_PER_FLASHCARD));
}
