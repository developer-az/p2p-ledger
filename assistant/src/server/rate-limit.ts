/**
 * Rate limiting for the assistant BFF.
 *
 * Anti-flooding is layered, cheapest first (see docs/AI-SCALE.md):
 *   1. Per-IP sliding window on every write / LLM route — this file. Rejects a
 *      noisy caller before any work is done, and hands back a `Retry-After`.
 *   2. LlmGuard answer cache + in-flight coalescing (llm-guard.ts) — a repeat
 *      question costs zero provider calls even when it is allowed through here.
 *   3. LlmGuard daily budget — a hard ceiling checked before the provider runs.
 *
 * A *sliding window log* is used instead of a fixed counter. A fixed window can
 * be doubled by bursting either side of its boundary ("40 at :59, 40 at :00");
 * a sliding window cannot, because the timestamps themselves are the allowance.
 *
 * Memory is bounded: only timestamps still inside the window are retained, so a
 * key holds at most `limit` numbers regardless of request volume, and idle keys
 * are evicted once the map passes `maxKeys`.
 */

export interface LimiterOptions {
  /** Injectable clock so tests are deterministic. Defaults to Date.now. */
  now?: () => number;
  /** Cap on tracked keys; oldest-inserted keys are evicted first. Default 20_000. */
  maxKeys?: number;
}

export interface LimiterVerdict {
  allowed: boolean;
  /** Milliseconds until the oldest hit leaves the window. 0 when allowed. */
  retryAfterMs: number;
  /** Hits still available in the current window (floored at 0). */
  remaining: number;
}

/**
 * A callable limiter. Called directly it returns a boolean (the shape the
 * existing routes use); `.check()` returns the full verdict when the caller
 * needs a `Retry-After` header or a remaining-quota hint.
 */
export interface Limiter {
  (key: string): boolean;
  check(key: string): LimiterVerdict;
  /** How many keys are currently tracked (observability + tests). */
  size(): number;
}

const DEFAULT_MAX_KEYS = 20_000;

/**
 * Build a sliding-window limiter.
 *
 * @param limit   Allowed hits per key per window.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimiter(limit: number, windowMs: number, options: LimiterOptions = {}): Limiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  // Insertion-ordered: the first key is the oldest-inserted and the eviction target.
  const hits = new Map<string, number[]>();

  function check(key: string): LimiterVerdict {
    const at = now();
    let stamps = hits.get(key);
    if (!stamps) {
      stamps = [];
      // Re-insert so a reused key moves to the end of the eviction order.
      hits.delete(key);
      hits.set(key, stamps);
    }

    const cutoff = at - windowMs;
    // Drop everything that has aged out. Stamps are pushed in time order, so the
    // expired ones are always a prefix.
    let expired = 0;
    while (expired < stamps.length && stamps[expired]! <= cutoff) expired += 1;
    if (expired > 0) stamps.splice(0, expired);

    if (stamps.length >= limit) {
      const oldest = stamps[0] ?? at;
      return { allowed: false, retryAfterMs: Math.max(1, oldest + windowMs - at), remaining: 0 };
    }

    stamps.push(at);
    evict();
    return { allowed: true, retryAfterMs: 0, remaining: Math.max(0, limit - stamps.length) };
  }

  /** Keep the map from growing without bound when keys are never reused. */
  function evict(): void {
    while (hits.size > maxKeys) {
      const oldestKey = hits.keys().next().value;
      if (oldestKey === undefined) return;
      hits.delete(oldestKey);
    }
  }

  const limiter = ((key: string) => check(key).allowed) as Limiter;
  limiter.check = check;
  limiter.size = () => hits.size;
  return limiter;
}

/**
 * Header value for a `Retry-After` response. Seconds, rounded up, minimum 1 —
 * a client should never be told to retry in "0 seconds".
 */
export function retryAfterSeconds(verdict: LimiterVerdict): string {
  return String(Math.max(1, Math.ceil(verdict.retryAfterMs / 1000)));
}
