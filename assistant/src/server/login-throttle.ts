/**
 * In-memory sign-in throttle. Counters live in this process only, so a restart
 * clears them and separate serverless instances do not share lockouts. That is
 * deliberate for step 2.3: the throttle is a cheap local guard, not durable
 * state. The durable per-minute limiter (rate-limit-store.ts) still applies.
 *
 * Only `succeed()` resets a key. Waiting out a lockout leaves the failure count
 * in place so the next failure resumes the curve instead of starting at 30 s.
 */
export function backoffSeconds(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(15 * 60, 30 * 2 ** (failures - 5));
}

export interface ThrottleVerdict {
  allowed: boolean;
  retryAfterSec: number;
}

export interface LoginThrottleOptions {
  /** Clock in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Failures allowed before the key is refused. Defaults to 5. */
  blockAfter?: number;
}

interface ThrottleEntry {
  failures: number;
  blockedUntil: number;
}

export class LoginThrottle {
  private readonly now: () => number;
  private readonly blockAfter: number;
  private readonly entries = new Map<string, ThrottleEntry>();

  constructor(options: LoginThrottleOptions = {}) {
    this.now = options.now ?? Date.now;
    this.blockAfter = options.blockAfter ?? 5;
  }

  /** Reads the current verdict without counting as an attempt. */
  check(key: string): ThrottleVerdict {
    const entry = this.entries.get(key);
    if (!entry || entry.failures < this.blockAfter) return { allowed: true, retryAfterSec: 0 };
    const remaining = entry.blockedUntil - this.now();
    if (remaining <= 0) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.ceil(remaining / 1000) };
  }

  /** Records one failed attempt. A key already over the limit extends its wait. */
  fail(key: string): void {
    const entry = this.entries.get(key) ?? { failures: 0, blockedUntil: 0 };
    entry.failures += 1;
    // Shift the published 0-4 free / 5 => 30 s curve to this key's threshold.
    const wait = backoffSeconds(entry.failures - this.blockAfter + 5);
    entry.blockedUntil = this.now() + wait * 1000;
    this.entries.set(key, entry);
  }

  /** A correct password clears both the count and any lockout for this key. */
  succeed(key: string): void {
    this.entries.delete(key);
  }
}
