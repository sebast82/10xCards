import type { APIRoute } from "astro";
import { Rating } from "ts-fsrs";
import type { Grade } from "ts-fsrs";
import { z } from "zod";

import { applyReviewGrade, getReviewQueue, ReviewServiceError } from "@/lib/reviews/service";

// Komunikaty są stałe. `error.issues` nigdy nie trafia do klienta.
const MESSAGES = {
  unauthorized: "Zaloguj się, aby powtarzać fiszki.",
  unavailable: "Sesja powtórkowa jest chwilowo niedostępna — brakuje konfiguracji serwera.",
  invalidBody: "Nieprawidłowe dane oceny.",
  notFound: "Nie znaleziono fiszki.",
  conflict: "Ta fiszka została już oceniona.",
  unexpected: "Nie udało się przetworzyć żądania sesji powtórkowej. Spróbuj ponownie.",
} as const;

// Ocena walidowana wyłącznie na granicy API — `0` albo `5` rzuca w ts-fsrs nieprzechwytywalnie.
const gradeSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const postBodySchema = z.object({ flashcardId: z.uuid(), grade: gradeSchema }).strict();

// Zwężenie zwalidowanego `1|2|3|4` do nominalnego enuma `Grade` z ts-fsrs, bez rzutowania.
const GRADES: Record<z.infer<typeof gradeSchema>, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
};

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
): { userId: string; supabase: NonNullable<App.Locals["supabase"]> } | Response {
  if (!locals.user) {
    return error(MESSAGES.unauthorized, 401);
  }

  if (!locals.supabase) {
    return error(MESSAGES.unavailable, 503);
  }

  return { userId: locals.user.id, supabase: locals.supabase };
}

export const GET: APIRoute = async ({ locals }) => {
  const context = getRequestContext(locals);
  if (context instanceof Response) {
    return context;
  }

  try {
    // `now` powstaje w handlerze — nigdy z żądania.
    const cards = await getReviewQueue({ ...context, now: new Date() });
    return json({ cards }, 200);
  } catch {
    return error(MESSAGES.unexpected, 500);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const context = getRequestContext(locals);
  if (context instanceof Response) {
    return context;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error(MESSAGES.invalidBody, 400);
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return error(MESSAGES.invalidBody, 400);
  }

  try {
    const result = await applyReviewGrade({
      ...context,
      flashcardId: parsed.data.flashcardId,
      grade: GRADES[parsed.data.grade],
      now: new Date(),
    });
    return json(result, 200);
  } catch (caught) {
    if (caught instanceof ReviewServiceError) {
      if (caught.code === "flashcard_not_found") {
        return error(MESSAGES.notFound, 404);
      }
      if (caught.code === "grade_conflict") {
        return error(MESSAGES.conflict, 409);
      }
    }

    return error(MESSAGES.unexpected, 500);
  }
};
