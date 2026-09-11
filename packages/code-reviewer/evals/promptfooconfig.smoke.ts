import type { UnifiedConfig } from 'promptfoo';
import type { Review } from '../src/index.js';
import { verdictFails } from './assertions.js';

// Canned failing review: security below its floor and the average below the pass threshold.
const mockReview: Review = {
  summary: 'Canned review for the offline smoke run.',
  scores: { correctness: 4, idiomaticity: 6, complexity: 7, testCoverage: 3, documentation: 5, security: 2 },
  issues: [{ severity: 'high', message: 'Canned issue: untrusted input reaches the page unsanitised.' }],
};

// Offline check of the loader → provider → assertion chain: mock model, no API key, nothing stored.
const config: UnifiedConfig = {
  description: 'code-reviewer evals — offline smoke run',
  // Placeholder: the provider reads only `vars.fixture` and builds the prompt with the package's own code.
  prompts: ['{{fixture}}'],
  providers: [{ id: 'file://provider.ts', label: 'mock', config: { mockReview } }],
  tests: [{ description: 'Wiring fixture', vars: { fixture: 'wiring' }, assert: [verdictFails] }],
};

export default config;
