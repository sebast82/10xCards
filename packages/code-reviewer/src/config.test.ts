import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('throws a readable error naming the missing key', () => {
    expect(() => loadConfig({})).toThrow(/Invalid environment[\s\S]*OPENROUTER_API_KEY/);
  });

  it('defaults the model', () => {
    expect(loadConfig({ OPENROUTER_API_KEY: 'k' }).OPENROUTER_MODEL).toBe('anthropic/claude-sonnet-5');
  });
});
