import { describe, expect, it } from "vitest";

import { formatInterval } from "./interval";

const NOW = new Date("2026-09-02T12:00:00.000Z");

function inFuture(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatInterval", () => {
  it("formats sub-hour intervals in minutes", () => {
    expect(formatInterval(inFuture(59 * MINUTE), NOW)).toBe("za 59 min");
    expect(formatInterval(inFuture(MINUTE), NOW)).toBe("za 1 min");
  });

  it("switches to hours at the 60-minute boundary", () => {
    expect(formatInterval(inFuture(60 * MINUTE), NOW)).toBe("za 1 godz.");
    expect(formatInterval(inFuture(23 * HOUR), NOW)).toBe("za 23 godz.");
  });

  it('reads "jutro" between 24 and 48 hours', () => {
    expect(formatInterval(inFuture(25 * HOUR), NOW)).toBe("jutro");
    expect(formatInterval(inFuture(47 * HOUR), NOW)).toBe("jutro");
  });

  it("switches to days at the 48-hour boundary", () => {
    expect(formatInterval(inFuture(49 * HOUR), NOW)).toBe("za 2 dni");
    expect(formatInterval(inFuture(29 * DAY), NOW)).toBe("za 29 dni");
  });

  it("switches to months at the 30-day boundary", () => {
    expect(formatInterval(inFuture(31 * DAY), NOW)).toBe("za 1 mies.");
    expect(formatInterval(inFuture(75 * DAY), NOW)).toBe("za 3 mies.");
  });

  it("clamps a non-positive delta to the minute bucket", () => {
    expect(formatInterval(inFuture(-5 * MINUTE), NOW)).toBe("za 0 min");
  });
});
