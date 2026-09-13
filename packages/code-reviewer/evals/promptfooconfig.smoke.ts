import type { UnifiedConfig } from 'promptfoo';
import type { Review } from '../src/index.js';
import { allCases } from './cases.js';

// Canned reviews, one per fixture, each shaped to satisfy that case's deterministic assertion: the flawed
// fixtures must come out with a failing verdict (and the security one below the security floor), the control
// must pass. Together they check `computeVerdict` wiring in both directions at zero cost. The judge rubrics
// are off here, so the prose is never graded.
const failingReview: Review = {
  summary: 'Canned review for the offline smoke run.',
  scores: { correctness: 4, idiomaticity: 6, complexity: 7, testCoverage: 3, documentation: 5, security: 2 },
  issues: [{ severity: 'high', message: 'Canned issue: untrusted input reaches the page unsanitised.' }],
};

const cleanReview: Review = {
  summary: 'Canned passing review for the offline smoke run.',
  scores: { correctness: 9, idiomaticity: 9, complexity: 9, testCoverage: 8, documentation: 8, security: 9 },
  issues: [],
};

// Offline check of the loader → provider → assertion chain: mock model, no API key, nothing stored.
const config: UnifiedConfig = {
  description: 'code-reviewer evals — offline smoke run',
  // Placeholder: the provider reads only `vars.fixture` and builds the prompt with the package's own code.
  prompts: ['{{fixture}}'],
  providers: [
    {
      id: 'file://provider.ts',
      label: 'mock',
      config: {
        mockReviews: {
          'react-19-migration': failingReview,
          'deck-search-endpoint': failingReview,
          'clean-control': cleanReview,
        },
      },
    },
  ],
  // The real fixtures without the judge: covers their loading and size guards at zero cost.
  tests: allCases({ judge: false }),
};

export default config;
