import { createHash } from 'node:crypto';

/**
 * HIBP Pwned Passwords range lookup with k-anonymity: only the first five hex
 * characters of the SHA-1 leave the process. Fail-open means a network outage,
 * a non-200 answer or a slow request never blocks sign-up or password reset.
 */
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2_000;

export async function isBreachedPassword(password: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${RANGE_URL}${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const suffix = hash.slice(5);
    const body = await response.text();
    for (const line of body.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      if (line.slice(0, separator).trim().toUpperCase() !== suffix) continue;
      // Count 0 is HIBP padding, not a breach.
      return Number(line.slice(separator + 1).trim()) > 0;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
