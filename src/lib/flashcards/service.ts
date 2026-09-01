import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { createScheduler } from "@/lib/srs";

export type FlashcardServiceErrorCode = "generation_not_found" | "flashcard_not_found" | "persist_failed";

const ERROR_MESSAGES: Record<FlashcardServiceErrorCode, string> = {
  generation_not_found: "Nie znaleziono zlecenia generowania.",
  flashcard_not_found: "Nie znaleziono fiszki.",
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

export interface CreateManualFlashcardInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  front: string;
  back: string;
}

export interface UpdateFlashcardInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  flashcardId: string;
  front: string;
  back: string;
}

export interface DeleteFlashcardInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  flashcardId: string;
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
  // `status` zawęża do zleceń zakończonych: wiersz `pending`/`failed` ma `generated_count = 0` i wywaliłby CHECK.
  const { data: generation, error: lookupError } = await supabase
    .from("generations")
    .select("id")
    .eq("id", generationId)
    .eq("status", "succeeded")
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
  // Ostatnia fiszka w zleceniu nie ma jednak kto naprawić — stąd sygnał. Do logu idzie sam kod błędu:
  // to jedyny instrument pomiaru kryterium 75%, a cicha awaria zaniża je bez śladu.
  const { error: recountError } = await supabase.rpc("recount_generation_acceptance", {
    p_generation_id: generationId,
  });

  if (recountError) {
    // eslint-disable-next-line no-console -- kod błędu Postgresa, bez treści użytkownika
    console.warn("recount_generation_acceptance failed", recountError.code);
  }

  return { id: data.id };
}

export async function createManualFlashcard({
  supabase,
  userId,
  front,
  back,
}: CreateManualFlashcardInput): Promise<{ id: string; created_at: string }> {
  const schedule = createScheduler().createNewCard(new Date());

  const { data, error } = await supabase
    .from("flashcards")
    .insert({
      user_id: userId,
      generation_id: null,
      front: front.trim(),
      back: back.trim(),
      source: "manual",
      ...schedule,
    })
    .select("id, created_at")
    .single();

  if (error) {
    throw new FlashcardServiceError("persist_failed");
  }

  return { id: data.id, created_at: data.created_at };
}

export async function updateFlashcard({
  supabase,
  userId,
  flashcardId,
  front,
  back,
}: UpdateFlashcardInput): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("flashcards")
    .update({ front: front.trim(), back: back.trim() })
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new FlashcardServiceError("persist_failed");
  }

  if (!data) {
    throw new FlashcardServiceError("flashcard_not_found");
  }

  return { id: data.id };
}

export async function deleteFlashcard({
  supabase,
  userId,
  flashcardId,
}: DeleteFlashcardInput): Promise<{ id: string }> {
  const { data: card, error: lookupError } = await supabase
    .from("flashcards")
    .select("generation_id")
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    throw new FlashcardServiceError("persist_failed");
  }

  if (!card) {
    throw new FlashcardServiceError("flashcard_not_found");
  }

  const { data: deleted, error: deleteError } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", flashcardId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (deleteError) {
    throw new FlashcardServiceError("persist_failed");
  }

  if (!deleted) {
    throw new FlashcardServiceError("flashcard_not_found");
  }

  if (card.generation_id) {
    const { error: recountError } = await supabase.rpc("recount_generation_acceptance", {
      p_generation_id: card.generation_id,
    });

    if (recountError) {
      // eslint-disable-next-line no-console -- kod błędu Postgresa, bez treści użytkownika
      console.warn("recount_generation_acceptance failed", recountError.code);
    }
  }

  return { id: deleted.id };
}
