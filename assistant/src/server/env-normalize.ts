/** Vercel env values often include accidental newlines/tabs from copy-paste. */
export function normalizeEnvToken(raw: string | undefined): string {
  return (raw ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

export function normalizeProviderId(raw: string | undefined): string {
  const id = normalizeEnvToken(raw);
  return id || 'gemini';
}
