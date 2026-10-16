import { describe, expect, it } from 'vitest';
import { FallbackChainProvider } from '../src/server/providers/fallback-chain.js';
import { providerFromEnv } from '../src/server/providers/index.js';
import { GeminiProvider } from '../src/server/providers/gemini.js';
import { OpenRouterProvider } from '../src/server/providers/openrouter.js';

describe('providerFromEnv', () => {
  it('chains Gemini with OpenRouter when both keys are set', () => {
    const p = providerFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'g',
      OPENROUTER_API_KEY: 'o',
    });
    expect(p).toBeInstanceOf(FallbackChainProvider);
  });

  it('uses OpenRouter alone when Gemini key is missing', () => {
    const p = providerFromEnv({
      LLM_PROVIDER: 'gemini',
      OPENROUTER_API_KEY: 'o',
    });
    expect(p).toBeInstanceOf(OpenRouterProvider);
  });

  it('openrouter provider mode uses OPENROUTER_MODEL not LLM_MODEL', () => {
    const p = providerFromEnv({
      LLM_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'o',
      OPENROUTER_MODEL: 'meta-llama/llama-3.1-8b-instruct',
      LLM_MODEL: 'google/gemini-2.0-flash-001',
    });
    expect(p).toBeInstanceOf(OpenRouterProvider);
    expect(p.model).toBe('meta-llama/llama-3.1-8b-instruct');
  });

  it('ignores LLM_MODEL when it looks like an OpenRouter slug for Gemini', () => {
    const p = providerFromEnv({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'g',
      LLM_MODEL: 'google/gemini-2.0-flash-001',
    });
    expect(p).toBeInstanceOf(GeminiProvider);
    expect(p.model).toBe('gemini-2.0-flash-lite');
  });
});
