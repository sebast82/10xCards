import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import type { Config } from './config.js';

export function createOpenRouterModel(config: Config): LanguageModel {
  const openrouter = createOpenRouter({ apiKey: config.OPENROUTER_API_KEY });
  // Reasoning tokens count against `maxOutputTokens`. At the default effort (`high` for Claude Sonnet 5)
  // a near-cap diff spent the whole budget thinking and returned no JSON at all.
  return openrouter(config.OPENROUTER_MODEL, { reasoning: { effort: 'low' } });
}
