/**
 * Model slugs from https://openrouter.ai/api/v1/models (also browse https://openrouter.ai/models).
 * Gemini 2.0 `*-001` ids are not routed on OpenRouter anymore — use 2.5+ slugs.
 */
export const OPENROUTER_MODELS_PAGE = 'https://openrouter.ai/models';

/** Cheap, tool-capable default on OpenRouter as of 2026-03. */
export const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.5-flash-lite';

const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'google/gemini-2.0-flash-001': DEFAULT_OPENROUTER_MODEL,
  'google/gemini-2.0-flash-lite-001': DEFAULT_OPENROUTER_MODEL,
  'google/gemini-2.0-flash-lite': DEFAULT_OPENROUTER_MODEL,
  'google/gemini-2.0-flash': DEFAULT_OPENROUTER_MODEL,
};

export function normalizeOpenRouterModel(model: string): string {
  const trimmed = model.trim();
  return OPENROUTER_MODEL_ALIASES[trimmed] ?? trimmed;
}

/**
 * Tried in order when the configured slug 404s (retired model, no endpoint under our data policy).
 * Override with OPENROUTER_FALLBACK_MODELS (comma-separated slugs).
 */
export const OPENROUTER_FALLBACK_MODELS: readonly string[] = [
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-flash',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.3-70b-instruct',
];

/** Walking more than the configured slug plus two fallbacks only multiplies quota use. */
export const MAX_OPENROUTER_CANDIDATES = 3;

/** Configured slug first, then the env list (or the built-in defaults), de-duplicated, capped at 3. */
export function openRouterModelCandidates(
  configured: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const fromEnv = (env.OPENROUTER_FALLBACK_MODELS ?? '')
    .split(',')
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  const fallbacks = fromEnv.length > 0 ? fromEnv : OPENROUTER_FALLBACK_MODELS;

  const candidates: string[] = [];
  for (const slug of [configured, ...fallbacks]) {
    const normalized = normalizeOpenRouterModel(slug);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  }
  return candidates.slice(0, MAX_OPENROUTER_CANDIDATES);
}

/** When the configured slug 404s, try this once before failing. */
export function openRouterFallbackModel(configured: string): string {
  const candidates = openRouterModelCandidates(configured);
  return candidates[1] ?? candidates[0] ?? DEFAULT_OPENROUTER_MODEL;
}
