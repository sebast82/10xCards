import { describe, expect, it } from 'vitest';
import { ScoresSchema, type Scores } from './review.js';

const scores: Scores = { correctness: 8, idiomaticity: 7, complexity: 7, testCoverage: 6, documentation: 7, security: 9 };

describe('ScoresSchema', () => {
  it.each([1, 10])('accepts a score of %s', (security) => {
    expect(ScoresSchema.safeParse({ ...scores, security }).success).toBe(true);
  });

  it.each([0, 11, 7.5])('rejects a score of %s', (security) => {
    expect(ScoresSchema.safeParse({ ...scores, security }).success).toBe(false);
  });

  it('rejects a missing criterion', () => {
    expect(ScoresSchema.safeParse({ ...scores, security: undefined }).success).toBe(false);
  });
});
