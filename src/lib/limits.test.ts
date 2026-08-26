import { describe, expect, it } from "vitest";
import { MAX_FLASHCARDS, proposalCap, SOURCE_TEXT_MAX, SOURCE_TEXT_MIN } from "./limits";

describe("proposalCap", () => {
  it("returns one proposal at the minimum input length", () => {
    expect(proposalCap(SOURCE_TEXT_MIN)).toBe(1);
  });

  it("returns the ceiling at the maximum input length", () => {
    expect(proposalCap(SOURCE_TEXT_MAX)).toBe(MAX_FLASHCARDS);
  });

  it("rounds up just above the last full bucket", () => {
    expect(proposalCap(9601)).toBe(25);
  });

  it("does not round up on an exact bucket boundary", () => {
    expect(proposalCap(9600)).toBe(24);
  });

  it("never exceeds the ceiling", () => {
    expect(proposalCap(SOURCE_TEXT_MAX * 10)).toBe(MAX_FLASHCARDS);
  });
});
