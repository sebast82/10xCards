import type { Scores } from './schemas/review.js';

// Pass = average across all criteria at or above `average`, AND security at or above its own
// floor, so a serious security finding can't be averaged away by good scores elsewhere.
export const PASS_THRESHOLDS = { average: 7, security: 6 } as const;

export type Verdict = { pass: boolean; reason: string };

export function computeVerdict(scores: Scores): Verdict {
  const values = Object.values(scores);
  const sum = values.reduce((total, value) => total + value, 0);
  // Sum against threshold × count rather than a float average, so the boundary is exact.
  const averageOk = sum >= PASS_THRESHOLDS.average * values.length;
  const securityOk = scores.security >= PASS_THRESHOLDS.security;
  const average = Math.round((sum / values.length) * 100) / 100;
  return {
    pass: averageOk && securityOk,
    reason:
      `average score ${average} ${averageOk ? 'meets' : 'is below'} the threshold of ${PASS_THRESHOLDS.average} and ` +
      `security score ${scores.security} ${securityOk ? 'meets' : 'is below'} the floor of ${PASS_THRESHOLDS.security}`,
  };
}
