import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { generateFlashcards, OpenRouterError, type PrivacyMode } from "@/lib/openrouter/client";
import { GenerationParseError, type FlashcardProposal } from "@/lib/openrouter/parse";
import { MODEL } from "@/lib/openrouter/prompt";

// Wartość z sufitu — zamienia nieograniczony koszt w policzalny. Do skorygowania po pierwszym tygodniu.
export const DAILY_GENERATION_LIMIT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

export type GenerationServiceErrorCode = "daily_limit_exceeded" | "quota_check_failed" | "persist_failed";

const ERROR_MESSAGES: Record<GenerationServiceErrorCode, string> = {
  daily_limit_exceeded: `Wyczerpano dobowy limit ${String(DAILY_GENERATION_LIMIT)} generowań. Spróbuj ponownie później.`,
  quota_check_failed: "Nie udało się sprawdzić limitu generowań. Spróbuj ponownie.",
  persist_failed: "Nie udało się zapisać zlecenia generowania. Spróbuj ponownie.",
};

export class GenerationServiceError extends Error {
  readonly code: GenerationServiceErrorCode;

  constructor(code: GenerationServiceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "GenerationServiceError";
    this.code = code;
  }
}

export interface CreateGenerationInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  sourceText: string;
  apiKey: string;
}

export interface GenerationResult {
  generationId: string;
  model: string;
  privacyMode: PrivacyMode;
  proposals: FlashcardProposal[];
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertWithinDailyLimit(supabase: SupabaseClient<Database>, userId: string): Promise<void> {
  const since = new Date(Date.now() - DAY_MS).toISOString();

  // `user_id` w filtrze nie jest zabezpieczeniem (tym jest RLS), tylko trafieniem w indeks (user_id, created_at desc).
  const { count, error } = await supabase
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  if (error) {
    throw new GenerationServiceError("quota_check_failed");
  }

  if ((count ?? 0) >= DAILY_GENERATION_LIMIT) {
    throw new GenerationServiceError("daily_limit_exceeded");
  }
}

// Do bazy trafia sam kod bledu — CHECK `generations_error_code_shape` odrzuci cokolwiek dluzszego.
function failureCode(caught: unknown): string {
  if (caught instanceof OpenRouterError || caught instanceof GenerationParseError) {
    return caught.code;
  }
  return "unknown";
}

async function markFailed(supabase: SupabaseClient<Database>, generationId: string, code: string): Promise<void> {
  await supabase.from("generations").update({ status: "failed", error_code: code }).eq("id", generationId);
}

export async function createGeneration({
  supabase,
  userId,
  sourceText,
  apiKey,
}: CreateGenerationInput): Promise<GenerationResult> {
  // Sprawdzenie limitu idzie przed wywołaniem modelu — po nim nie chroniłoby przed niczym.
  await assertWithinDailyLimit(supabase, userId);

  const sourceTextHash = await sha256Hex(sourceText);

  // Rezerwacja przed wywołaniem modelu: dopiero istniejący wiersz sprawia, że limit dobowy obejmuje
  // generowania równoległe i nieudane — a te też są płatne. Bez niej N żądań naraz widzi ten sam licznik.
  const { data: reservation, error: reserveError } = await supabase
    .from("generations")
    .insert({
      user_id: userId,
      model: MODEL,
      source_text_length: sourceText.length,
      source_text_hash: sourceTextHash,
      generation_duration: 0,
      status: "pending",
    })
    .select("id")
    .single();

  if (reserveError) {
    throw new GenerationServiceError("persist_failed");
  }

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await generateFlashcards(apiKey, sourceText);
  } catch (caught) {
    await markFailed(supabase, reservation.id, failureCode(caught));
    throw caught;
  }

  const { error } = await supabase
    .from("generations")
    .update({
      model: outcome.model,
      // Jawnie, mimo default 0: pominięcie wywala pierwszą akceptację CHECK-iem `accepted_total_leq_generated`.
      generated_count: outcome.proposals.length,
      generation_duration: Date.now() - startedAt,
      status: "succeeded",
    })
    .eq("id", reservation.id);

  if (error) {
    throw new GenerationServiceError("persist_failed");
  }

  return {
    generationId: reservation.id,
    model: outcome.model,
    privacyMode: outcome.privacyMode,
    proposals: outcome.proposals,
  };
}
