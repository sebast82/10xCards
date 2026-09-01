import type { APIRoute } from "astro";
import { z } from "zod";

import { deleteFlashcard, FlashcardServiceError, updateFlashcard } from "@/lib/flashcards/service";
import { BACK_MAX_LENGTH, FRONT_MAX_LENGTH } from "@/lib/limits";

const MESSAGES = {
  unauthorized: "Zaloguj się, aby zarządzać fiszkami.",
  unavailable: "Zarządzanie fiszkami jest chwilowo niedostępne — brakuje konfiguracji serwera.",
  invalidId: "Identyfikator fiszki jest nieprawidłowy.",
  invalidBody: `Przód fiszki może mieć od 1 do ${String(FRONT_MAX_LENGTH)} znaków, a tył od 1 do ${String(BACK_MAX_LENGTH)}.`,
  notFound: "Nie znaleziono fiszki.",
  unexpected: "Nie udało się zmienić fiszki. Spróbuj ponownie.",
} as const;

const idSchema = z.uuid();
const updateRequestSchema = z.object({
  front: z.string().trim().min(1).max(FRONT_MAX_LENGTH),
  back: z.string().trim().min(1).max(BACK_MAX_LENGTH),
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

function getRequestContext(
  locals: App.Locals,
  id: string | undefined,
): { userId: string; supabase: NonNullable<App.Locals["supabase"]>; flashcardId: string } | Response {
  if (!locals.user) {
    return error(MESSAGES.unauthorized, 401);
  }

  if (!locals.supabase) {
    return error(MESSAGES.unavailable, 503);
  }

  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) {
    return error(MESSAGES.invalidId, 400);
  }

  return { userId: locals.user.id, supabase: locals.supabase, flashcardId: parsedId.data };
}

function serviceError(caught: unknown): Response {
  if (caught instanceof FlashcardServiceError && caught.code === "flashcard_not_found") {
    return error(MESSAGES.notFound, 404);
  }

  return error(MESSAGES.unexpected, 500);
}

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const context = getRequestContext(locals, params.id);
  if (context instanceof Response) {
    return context;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(MESSAGES.invalidBody, 400);
  }

  const parsedBody = updateRequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return error(MESSAGES.invalidBody, 400);
  }

  try {
    return json(await updateFlashcard({ ...context, front: parsedBody.data.front, back: parsedBody.data.back }), 200);
  } catch (caught) {
    return serviceError(caught);
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const context = getRequestContext(locals, params.id);
  if (context instanceof Response) {
    return context;
  }

  try {
    return json(await deleteFlashcard(context), 200);
  } catch (caught) {
    return serviceError(caught);
  }
};
