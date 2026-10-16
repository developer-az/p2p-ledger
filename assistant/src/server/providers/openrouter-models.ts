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

/** When the configured slug 404s, try this once before failing. */
export function openRouterFallbackModel(configured: string): string {
  const normalized = normalizeOpenRouterModel(configured);
  if (normalized === DEFAULT_OPENROUTER_MODEL) return DEFAULT_OPENROUTER_MODEL;
  return DEFAULT_OPENROUTER_MODEL;
}
