import type { APIRoute } from "astro";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { z } from "zod";

import { createGeneration, GenerationServiceError } from "@/lib/generations/service";
import { OpenRouterError } from "@/lib/openrouter/client";
import { SOURCE_TEXT_MAX, SOURCE_TEXT_MIN } from "@/lib/limits";
import { GenerationParseError } from "@/lib/openrouter/parse";

// Komunikaty są stałe. Wstawienie `error.issues` wypuściłoby tekst źródłowy w odpowiedzi.
const MESSAGES = {
  unauthorized: "Zaloguj się, aby generować fiszki.",
  unavailable: "Generowanie fiszek jest chwilowo niedostępne — brakuje konfiguracji serwera.",
  invalidBody: `Tekst źródłowy musi mieć od ${String(SOURCE_TEXT_MIN)} do ${String(SOURCE_TEXT_MAX)} znaków.`,
  unexpected: "Nie udało się wygenerować fiszek. Spróbuj ponownie.",
} as const;

const requestSchema = z.object({
  sourceText: z.string().trim().min(SOURCE_TEXT_MIN).max(SOURCE_TEXT_MAX),
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

export const POST: APIRoute = async ({ locals, request }) => {
  const { user, supabase } = locals;

  if (!user) {
    return error(MESSAGES.unauthorized, 401);
  }

  if (!supabase || !OPENROUTER_API_KEY) {
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
    const result = await createGeneration({
      supabase,
      userId: user.id,
      sourceText: parsed.data.sourceText,
      apiKey: OPENROUTER_API_KEY,
    });

    return json(result, 200);
  } catch (caught) {
    if (caught instanceof GenerationServiceError) {
      return error(caught.message, caught.code === "daily_limit_exceeded" ? 429 : 500);
    }

    if (caught instanceof OpenRouterError || caught instanceof GenerationParseError) {
      return error(caught.message, 502);
    }

    return error(MESSAGES.unexpected, 500);
  }
};
