import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import type { LlmProvider } from './types.js';

/**
 * Picks the LLM from the environment. LLM_PROVIDER=gemini (default, free tier) or anthropic;
 * LLM_MODEL overrides the provider's default model.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const which = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();
  const model = env.LLM_MODEL || undefined;
  switch (which) {
    case 'gemini':
      return new GeminiProvider(required(env, 'GEMINI_API_KEY'), model);
    case 'anthropic':
      return new AnthropicProvider(required(env, 'ANTHROPIC_API_KEY'), model);
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${which}`);
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}
