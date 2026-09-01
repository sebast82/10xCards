import type { APIRoute } from "astro";
import { z } from "zod";

import { createAiFlashcard, createManualFlashcard, FlashcardServiceError } from "@/lib/flashcards/service";
import { BACK_MAX_LENGTH, FRONT_MAX_LENGTH } from "@/lib/limits";

// Komunikaty są stałe. Wstawienie `error.issues` wypuściłoby treść fiszki w odpowiedzi.
const MESSAGES = {
  unauthorized: "Zaloguj się, aby zapisywać fiszki.",
  unavailable: "Zapis fiszek jest chwilowo niedostępny — brakuje konfiguracji serwera.",
  invalidBody: `Przód fiszki może mieć od 1 do ${String(FRONT_MAX_LENGTH)} znaków, a tył od 1 do ${String(BACK_MAX_LENGTH)}.`,
  unexpected: "Nie udało się zapisać fiszki. Spróbuj ponownie.",
} as const;

// Progi muszą być dokładnie te z CHECK-ów w bazie — rozjazd o jeden znak daje 500 zamiast komunikatu.
const contentSchema = {
  front: z.string().trim().min(1).max(FRONT_MAX_LENGTH),
  back: z.string().trim().min(1).max(BACK_MAX_LENGTH),
} as const;

const aiRequestSchema = z.object({
  generationId: z.uuid(),
  ...contentSchema,
  edited: z.boolean(),
}).strict();

const manualRequestSchema = z.object(contentSchema).strict();

const requestSchema = z.union([aiRequestSchema, manualRequestSchema]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

export const POST: APIRoute = async ({ locals, request }) => {
  const { user, supabase } = locals;

  if (!user) {
    return error(MESSAGES.unauthorized, 401);
  }

  if (!supabase) {
    return error(MESSAGES.unavailable, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(MESSAGES.invalidBody, 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return error(MESSAGES.invalidBody, 400);
  }

  try {
    const result = "generationId" in parsed.data
      ? await createAiFlashcard({
          supabase,
          userId: user.id,
          generationId: parsed.data.generationId,
          front: parsed.data.front,
          back: parsed.data.back,
          edited: parsed.data.edited,
        })
      : await createManualFlashcard({
          supabase,
          userId: user.id,
          front: parsed.data.front,
          back: parsed.data.back,
        });

    return json(result, 201);
  } catch (caught) {
    if (caught instanceof FlashcardServiceError) {
      return error(caught.message, caught.code === "generation_not_found" ? 404 : 500);
    }

    return error(MESSAGES.unexpected, 500);
  }
};
