import type { Assertion, AssertionValueFunction } from 'promptfoo';
import { computeVerdict, ReviewSchema, type Review } from '../src/index.js';

// A function-valued assertion in a TS config receives the provider's object `output` as a JSON string, a
// YAML string assertion receives the object itself. Every assertion reads the review through here.
export function asReview(output: unknown): Review {
  return ReviewSchema.parse(typeof output === 'string' ? JSON.parse(output) : output);
}

const failsVerdict: AssertionValueFunction = (output) => {
  // The package's own rule and thresholds — never re-typed here.
  const verdict = computeVerdict(asReview(output).scores);
  return { pass: !verdict.pass, score: verdict.pass ? 0 : 1, reason: verdict.reason };
};

// Deterministic: a fixture with seeded flaws must get a failing verdict.
export const verdictFails: Assertion = { type: 'javascript', metric: 'verdict_fails', value: failsVerdict };
