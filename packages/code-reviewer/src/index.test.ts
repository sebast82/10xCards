import { afterEach, describe, expect, it, vi } from 'vitest';

// No vitest config sets `unstubEnvs`, so every stub is undone here.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('library entry point', () => {
  it('imports without reading env or touching the exit code', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.resetModules();

    await expect(import('./index.js')).resolves.toBeDefined();
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects with a config error when the default agent has no key', async () => {
    // Stubbed, not unset: an exported shell key would otherwise make this a real, paid call.
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const { reviewCode } = await import('./index.js');

    await expect(reviewCode('x')).rejects.toThrow('Invalid environment');
  });
});
