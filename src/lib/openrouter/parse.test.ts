import { describe, expect, it } from "vitest";
import { GenerationParseError, parseGenerationResponse } from "./parse";

function envelope(content: string, finishReason = "stop"): unknown {
  return {
    model: "google/gemini-2.5-flash",
    choices: [{ finish_reason: finishReason, message: { role: "assistant", content } }],
  };
}

function withFlashcards(flashcards: unknown[], finishReason = "stop"): unknown {
  return envelope(JSON.stringify({ flashcards }), finishReason);
}

describe("parseGenerationResponse", () => {
  it("returns proposals from a well-formed response", () => {
    const raw = withFlashcards([
      { front: "Co to jest RLS?", back: "Mechanizm izolacji wierszy w Postgresie." },
      { front: "Ile ms CPU daje Workers Free?", back: "10 ms na żądanie." },
    ]);

    expect(parseGenerationResponse(raw)).toEqual([
      { front: "Co to jest RLS?", back: "Mechanizm izolacji wierszy w Postgresie." },
      { front: "Ile ms CPU daje Workers Free?", back: "10 ms na żądanie." },
    ]);
  });

  it("trims whitespace around both sides", () => {
    const raw = withFlashcards([{ front: "  Pytanie?  ", back: "\nOdpowiedź.\n" }]);

    expect(parseGenerationResponse(raw)).toEqual([{ front: "Pytanie?", back: "Odpowiedź." }]);
  });

  it("reports a malformed response when the content is not JSON", () => {
    expect(() => parseGenerationResponse(envelope("to nie jest JSON"))).toThrow(
      expect.objectContaining({ code: "malformed_response" }),
    );
  });

  it("reports truncation separately from malformed JSON", () => {
    const raw = envelope('{"flashcards":[{"front":"Pytanie?","ba', "length");

    expect(() => parseGenerationResponse(raw)).toThrow(expect.objectContaining({ code: "truncated" }));
  });

  it("reports a malformed response when the envelope has no choices", () => {
    expect(() => parseGenerationResponse({ choices: [] })).toThrow(
      expect.objectContaining({ code: "malformed_response" }),
    );
  });

  it("drops a proposal missing the back side and keeps the rest", () => {
    const raw = withFlashcards([{ front: "Bez tyłu?" }, { front: "Pytanie?", back: "Odpowiedź." }]);

    expect(parseGenerationResponse(raw)).toEqual([{ front: "Pytanie?", back: "Odpowiedź." }]);
  });

  it("drops a proposal whose front exceeds the column limit and keeps the rest", () => {
    const raw = withFlashcards([
      { front: "x".repeat(501), back: "Odpowiedź." },
      { front: "Pytanie?", back: "Odpowiedź." },
    ]);

    expect(parseGenerationResponse(raw)).toEqual([{ front: "Pytanie?", back: "Odpowiedź." }]);
  });

  it("drops a proposal whose front is whitespace only", () => {
    const raw = withFlashcards([
      { front: "   ", back: "Odpowiedź." },
      { front: "Pytanie?", back: "Odpowiedź." },
    ]);

    expect(parseGenerationResponse(raw)).toEqual([{ front: "Pytanie?", back: "Odpowiedź." }]);
  });

  it("throws when nothing survives validation", () => {
    const raw = withFlashcards([{ front: "   ", back: "" }]);

    expect(() => parseGenerationResponse(raw)).toThrow(expect.objectContaining({ code: "no_proposals" }));
  });

  it("truncates the list to the cap", () => {
    const flashcards = Array.from({ length: 8 }, (_, index) => ({
      front: `Pytanie ${String(index)}?`,
      back: "Odpowiedź.",
    }));

    expect(parseGenerationResponse(withFlashcards(flashcards), 3)).toHaveLength(3);
  });

  it("keeps the source text out of the error message", () => {
    const secret = "TAJNY-FRAGMENT-WKLEJONEGO-TEKSTU";

    try {
      parseGenerationResponse(envelope(`{"flashcards": [ ${secret}`));
      expect.unreachable("parseGenerationResponse should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationParseError);
      expect((error as GenerationParseError).message).not.toContain(secret);
      expect(JSON.stringify(error)).not.toContain(secret);
    }
  });
});
