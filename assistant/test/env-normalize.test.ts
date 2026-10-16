import { describe, expect, it } from 'vitest';
import { normalizeProviderId } from '../src/server/env-normalize.js';
import { providerFromEnv } from '../src/server/providers/index.js';
import { OpenRouterProvider } from '../src/server/providers/openrouter.js';

describe('normalizeProviderId', () => {
  it('strips whitespace from Vercel copy-paste', () => {
    expect(normalizeProviderId('\nopenrouter\n')).toBe('openrouter');
    expect(normalizeProviderId('\topenrouter')).toBe('openrouter');
  });

  it('providerFromEnv accepts messy LLM_PROVIDER', () => {
    const p = providerFromEnv({
      LLM_PROVIDER: ' \nopenrouter ',
      OPENROUTER_API_KEY: 'k',
    });
    expect(p).toBeInstanceOf(OpenRouterProvider);
  });
});
