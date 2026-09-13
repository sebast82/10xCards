import type { Assertion, AssertionValueFunction } from 'promptfoo';
import { computeVerdict, PASS_THRESHOLDS, ReviewSchema, type Review } from '../src/index.js';

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

const passesVerdict: AssertionValueFunction = (output) => {
  const verdict = computeVerdict(asReview(output).scores);
  return { pass: verdict.pass, score: verdict.pass ? 1 : 0, reason: verdict.reason };
};

// Calibration, not recall: naming a vulnerability in prose but scoring `security` at or above the floor
// still ships the PR, because `computeVerdict` gates on the score. This assertion checks the score.
const securityBelowFloor: AssertionValueFunction = (output) => {
  const { security } = asReview(output).scores;
  const pass = security < PASS_THRESHOLDS.security;
  return {
    pass,
    score: pass ? 1 : 0,
    reason: `security score ${security} ${pass ? 'is below' : 'meets'} the floor of ${PASS_THRESHOLDS.security}`,
  };
};

// Deterministic: a fixture with seeded flaws must get a failing verdict.
export const verdictFails: Assertion = { type: 'javascript', metric: 'verdict_fails', value: failsVerdict };

// Deterministic: the control fixture has no seeded flaw, so a reviewer that cries wolf fails here.
export const verdictPasses: Assertion = { type: 'javascript', metric: 'verdict_passes', value: passesVerdict };

// Deterministic: an exploitable flaw must push `security` under its floor, not merely be mentioned.
export const securityFloorTrips: Assertion = {
  type: 'javascript',
  metric: 'security_floor_trips',
  value: securityBelowFloor,
};
