import { AnthropicProvider } from './anthropic.js';
import { FallbackChainProvider } from './fallback-chain.js';
import { GeminiProvider } from './gemini.js';
import { OpenRouterProvider } from './openrouter.js';
import type { LlmProvider } from './types.js';

const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';

/**
 * Picks the LLM from the environment.
 * - LLM_PROVIDER=gemini (default) | anthropic | openrouter
 * - OPENROUTER_API_KEY: when set with Gemini, auto-fallback on 429/5xx; or sole provider if Gemini key missing
 * - LLM_MODEL / OPENROUTER_MODEL override defaults
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const which = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  const model = env.LLM_MODEL || undefined;
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  const openRouterModel = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL;

  switch (which) {
    case 'openrouter':
      return new OpenRouterProvider(required(env, 'OPENROUTER_API_KEY'), model ?? openRouterModel);
    case 'anthropic':
      return new AnthropicProvider(required(env, 'ANTHROPIC_API_KEY'), model);
    case 'gemini': {
      const geminiKey = env.GEMINI_API_KEY?.trim();
      if (!geminiKey && openRouterKey) {
        return new OpenRouterProvider(openRouterKey, model ?? openRouterModel);
      }
      const gemini = new GeminiProvider(required(env, 'GEMINI_API_KEY'), model);
      if (openRouterKey) {
        const secondaryModel = env.OPENROUTER_FALLBACK_MODEL?.trim() || openRouterModel;
        return new FallbackChainProvider(gemini, new OpenRouterProvider(openRouterKey, secondaryModel));
      }
      return gemini;
    }
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${which}`);
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}
