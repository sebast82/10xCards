const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

/**
 * Krótka polska etykieta interwału dla przycisku oceny ("za 8 min", "jutro", "za 3 dni",
 * "za 2 mies."). Czysta funkcja — `now` jest zawsze jawnym argumentem, bez biblioteki lokalizacji.
 */
export function formatInterval(dueIso: string, now: Date): string {
  const diffMs = new Date(dueIso).getTime() - now.getTime();
  const ahead = diffMs > 0 ? diffMs : 0;

  if (ahead < HOUR_MS) {
    return `za ${String(Math.round(ahead / MINUTE_MS))} min`;
  }
  if (ahead < DAY_MS) {
    return `za ${String(Math.round(ahead / HOUR_MS))} godz.`;
  }
  if (ahead < 2 * DAY_MS) {
    return "jutro";
  }
  if (ahead < MONTH_MS) {
    return `za ${String(Math.round(ahead / DAY_MS))} dni`;
  }
  return `za ${String(Math.round(ahead / MONTH_MS))} mies.`;
}
