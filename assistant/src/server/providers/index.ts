import { AnthropicProvider } from './anthropic.js';
import { FallbackChainProvider } from './fallback-chain.js';
import { GeminiProvider } from './gemini.js';
import { OpenRouterProvider } from './openrouter.js';
import { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModel } from './openrouter-models.js';
import { normalizeProviderId } from '../env-normalize.js';
import type { LlmProvider } from './types.js';

export { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModel } from './openrouter-models.js';

/** Google model ids never contain `/`; OpenRouter slugs do — avoid sending OR models to Gemini. */
function geminiModelId(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.LLM_MODEL?.trim();
  if (!raw || raw.includes('/')) return undefined;
  return raw;
}

/**
 * Picks the LLM from the environment.
 * - LLM_PROVIDER=gemini (default) | anthropic | openrouter
 * - OPENROUTER_API_KEY: when set with Gemini, auto-fallback on 429/5xx; or sole provider if Gemini key missing
 * - OPENROUTER_MODEL for OpenRouter; LLM_MODEL for Gemini/Anthropic only (not OpenRouter slugs)
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const which = normalizeProviderId(env.LLM_PROVIDER);
  const openRouterKey = env.OPENROUTER_API_KEY?.trim();
  const openRouterModel = normalizeOpenRouterModel(env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL);

  switch (which) {
    case 'openrouter':
      return new OpenRouterProvider(required(env, 'OPENROUTER_API_KEY'), openRouterModel);
    case 'anthropic':
      return new AnthropicProvider(required(env, 'ANTHROPIC_API_KEY'), env.LLM_MODEL || undefined);
    case 'gemini': {
      const geminiKey = env.GEMINI_API_KEY?.trim();
      if (!geminiKey && openRouterKey) {
        return new OpenRouterProvider(openRouterKey, openRouterModel);
      }
      const gemini = new GeminiProvider(required(env, 'GEMINI_API_KEY'), geminiModelId(env));
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
