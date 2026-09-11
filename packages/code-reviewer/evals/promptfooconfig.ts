import type { UnifiedConfig } from 'promptfoo';
import { reactMigrationCase } from './cases.js';

// [label, OpenRouter model id]. The first is what CI runs today; the others are measured against it.
const MODELS = [
  ['claude-sonnet-5', 'anthropic/claude-sonnet-5'],
  ['glm-5.1', 'z-ai/glm-5.1'],
  ['deepseek-v4-flash', 'deepseek/deepseek-v4-flash'],
] as const;

// Same instructions, agent and output schema for every model — only `config.model` differs.
const config: UnifiedConfig = {
  description: 'code-reviewer evals — React 19 migration, three models',
  // Placeholder: the provider reads only `vars.fixture` and builds the prompt with the package's own code.
  prompts: ['{{fixture}}'],
  providers: MODELS.map(([label, model]) => ({ id: 'file://provider.ts', label, config: { model } })),
  // The judge: a different model family from every reviewer, so no self-preference; same OPENROUTER_API_KEY.
  defaultTest: { options: { provider: 'openrouter:openai/gpt-5.4' } },
  tests: [reactMigrationCase({ judge: true })],
  // Per case; matches the CI action's `timeout 300`. The provider forwards the abort, so a hung call stops billing.
  evaluateOptions: { timeoutMs: 300_000 },
};

export default config;
