import { describe, expect, it } from 'vitest';
import type { Scores } from './schemas/review.js';
import { computeVerdict } from './verdict.js';

const scores = (overrides: Partial<Scores> = {}): Scores => ({
  correctness: 7,
  idiomaticity: 7,
  complexity: 7,
  testCoverage: 7,
  documentation: 7,
  security: 7,
  ...overrides,
});

// Every criterion but security at 9: the average passes even with security at 5 ((45 + 5) / 6 ≈ 8.33).
const highOthers = { correctness: 9, idiomaticity: 9, complexity: 9, testCoverage: 9, documentation: 9 };

describe('computeVerdict', () => {
  it.each([
    ['41 (average ≈ 6.83)', scores({ correctness: 6 }), false],
    ['42 (average exactly 7)', scores(), true],
    ['43 (average ≈ 7.17)', scores({ correctness: 8 }), true],
  ])('score sum %s with security passing → pass = %s', (_, input, pass) => {
    expect(computeVerdict(input).pass).toBe(pass);
  });

  it.each([
    [5, false],
    [6, true],
    [7, true],
  ])('security %i with the average passing → pass = %s', (security, pass) => {
    expect(computeVerdict(scores({ ...highOthers, security })).pass).toBe(pass);
  });

  it('passes with both thresholds met exactly (average 7, security 6)', () => {
    expect(computeVerdict(scores({ correctness: 8, security: 6 })).pass).toBe(true);
  });

  it('names the security floor when security alone fails', () => {
    const verdict = computeVerdict(scores({ ...highOthers, security: 5 }));

    expect(verdict.reason).toBe(
      'average score 8.33 meets the threshold of 7 and security score 5 is below the floor of 6',
    );
  });

  it('names the average threshold when the average alone fails', () => {
    const verdict = computeVerdict(scores({ correctness: 6 }));

    expect(verdict.reason).toBe(
      'average score 6.83 is below the threshold of 7 and security score 7 meets the floor of 6',
    );
  });
});
