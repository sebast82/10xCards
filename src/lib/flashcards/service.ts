import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { createScheduler } from "@/lib/srs";

export type FlashcardServiceErrorCode = "generation_not_found" | "persist_failed";

const ERROR_MESSAGES: Record<FlashcardServiceErrorCode, string> = {
  generation_not_found: "Nie znaleziono zlecenia generowania.",
  persist_failed: "Nie udało się zapisać fiszki. Spróbuj ponownie.",
};

export class FlashcardServiceError extends Error {
  readonly code: FlashcardServiceErrorCode;

  constructor(code: FlashcardServiceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "FlashcardServiceError";
    this.code = code;
  }
}

export interface CreateAiFlashcardInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  generationId: string;
  front: string;
  back: string;
  edited: boolean;
}

export async function createAiFlashcard({
  supabase,
  userId,
  generationId,
  front,
  back,
  edited,
}: CreateAiFlashcardInput): Promise<{ id: string }> {
  // Klucz obcy nie przechodzi przez RLS — bez tego zapytania cudze `generationId` przeszłoby bez przeszkód.
  const { data: generation, error: lookupError } = await supabase
    .from("generations")
    .select("id")
    .eq("id", generationId)
    .maybeSingle();

  if (lookupError) {
    throw new FlashcardServiceError("persist_failed");
  }

  if (!generation) {
    throw new FlashcardServiceError("generation_not_found");
  }

  // Trigger `flashcards_prevent_source_change` zablokuje późniejszą zmianę — decyzja zapada tutaj, raz.
  const source = edited ? "ai_edited" : "ai";
  const schedule = createScheduler().createNewCard(new Date());

  const { data, error } = await supabase
    .from("flashcards")
    .insert({
      user_id: userId,
      generation_id: generationId,
      front,
      back,
      source,
      ...schedule,
    })
    .select("id")
    .single();

  if (error) {
    throw new FlashcardServiceError("persist_failed");
  }

  // Liczniki są przeliczane, nie inkrementowane, więc nieudane wywołanie naprawi kolejny zapis w tym zleceniu.
  // Zgłoszenie błędu po udanym inserie kazałoby użytkownikowi ponowić zapis i zdublować fiszkę.
  await supabase.rpc("recount_generation_acceptance", { p_generation_id: generationId });

  return { id: data.id };
}
