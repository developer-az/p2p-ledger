/**
 * Vitest never calls real LLMs. Strip keys so a developer's .env.local cannot leak into tests.
 * Tests that need provider wiring pass explicit env objects to providerFromEnv().
 */
process.env.GEMINI_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
