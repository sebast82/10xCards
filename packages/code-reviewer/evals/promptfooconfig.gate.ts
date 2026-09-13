import type { UnifiedConfig } from 'promptfoo';
import { allCases } from './cases.js';

// The model CI reviews with: `src/config.ts` defaults `OPENROUTER_MODEL` to this, and the workflow sets
// no override. Point the gate at another model with `GATE_MODEL=…` — `baseline.json` records which model
// it was recorded for, and `report.ts --check` refuses to compare across models.
const GATE_MODEL = process.env.GATE_MODEL ?? 'anthropic/claude-sonnet-5';

// The regression gate: one model, the same three diffs and the same ground truth as the comparison, run
// before a change to the reviewer's prompt, schema or verdict thresholds and compared to `baseline.json`.
const config: UnifiedConfig = {
  description: `code-reviewer evals — regression gate on ${GATE_MODEL}`,
  // Placeholder: the provider reads only `vars.fixture` and builds the prompt with the package's own code.
  prompts: ['{{fixture}}'],
  providers: [{ id: 'file://provider.ts', label: GATE_MODEL, config: { model: GATE_MODEL } }],
  defaultTest: { options: { provider: 'openrouter:openai/gpt-5.4' } },
  tests: allCases({ judge: true }),
  evaluateOptions: { timeoutMs: 300_000 },
};

export default config;
