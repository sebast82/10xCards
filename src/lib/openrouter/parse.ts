import { z } from "zod";
import { BACK_MAX_LENGTH, FRONT_MAX_LENGTH, MAX_FLASHCARDS } from "@/lib/limits";

export interface FlashcardProposal {
  front: string;
  back: string;
}

export type GenerationParseErrorCode = "truncated" | "malformed_response" | "no_proposals";

// Komunikaty są stałe. Interpolacja czegokolwiek z odpowiedzi albo z wejścia wypuściłaby
// tekst źródłowy do stack trace'u w Workers Logs.
const ERROR_MESSAGES: Record<GenerationParseErrorCode, string> = {
  truncated: "Model przerwał odpowiedź przed jej ukończeniem. Skróć tekst źródłowy i spróbuj ponownie.",
  malformed_response: "Model zwrócił odpowiedź w nieoczekiwanym formacie. Spróbuj ponownie.",
  no_proposals: "Model nie zwrócił żadnej fiszki nadającej się do zapisania. Spróbuj z innym tekstem.",
};

export class GenerationParseError extends Error {
  readonly code: GenerationParseErrorCode;

  constructor(code: GenerationParseErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "GenerationParseError";
    this.code = code;
  }
}

const envelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
});

const contentSchema = z.object({ flashcards: z.array(z.unknown()) });

const proposalSchema = z.object({
  front: z.string().trim().min(1).max(FRONT_MAX_LENGTH),
  back: z.string().trim().min(1).max(BACK_MAX_LENGTH),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GenerationParseError("malformed_response");
  }
}

export function parseGenerationResponse(raw: unknown, cap: number = MAX_FLASHCARDS): FlashcardProposal[] {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new GenerationParseError("malformed_response");
  }

  const choice = envelope.data.choices[0];

  // Obcięta odpowiedź jest nieprawidłowym JSON-em — bez tego rozpoznania dałaby mylący komunikat o awarii.
  if (choice.finish_reason === "length") {
    throw new GenerationParseError("truncated");
  }

  const content = contentSchema.safeParse(parseJson(choice.message.content));
  if (!content.success) {
    throw new GenerationParseError("malformed_response");
  }

  const proposals: FlashcardProposal[] = [];
  for (const candidate of content.data.flashcards) {
    if (proposals.length >= cap) {
      break;
    }
    // Nadgorliwy model gubi pojedyncze pozycje — krótsza lista jest lepsza niż komunikat o awarii.
    const proposal = proposalSchema.safeParse(candidate);
    if (proposal.success) {
      proposals.push(proposal.data);
    }
  }

  if (proposals.length === 0) {
    throw new GenerationParseError("no_proposals");
  }

  return proposals;
}
