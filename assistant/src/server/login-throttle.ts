/**
 * Sign-in throttle. Without a shared store, counters live in this process only,
 * so a restart clears them and separate serverless instances do not share
 * lockouts. When a SecurityStateStore is supplied, the same curve is applied to
 * rows in Postgres so every instance sees the same lockout.
 *
 * Only `succeed()` resets a key. Waiting out a lockout leaves the failure count
 * in place so the next failure resumes the curve instead of starting at 30 s.
 */
import type { SecurityStateStore } from './security-state.js';

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
  /** Shared counters. When omitted the throttle stays in this process. */
  state?: SecurityStateStore;
}

interface ThrottleEntry {
  failures: number;
  blockedUntil: number;
}

export class LoginThrottle {
  private readonly now: () => number;
  private readonly blockAfter: number;
  private readonly state?: SecurityStateStore;
  private readonly entries = new Map<string, ThrottleEntry>();

  constructor(options: LoginThrottleOptions = {}) {
    this.now = options.now ?? Date.now;
    this.blockAfter = options.blockAfter ?? 5;
    this.state = options.state;
  }

  private verdict(entry: ThrottleEntry | null): ThrottleVerdict {
    if (!entry || entry.failures < this.blockAfter) return { allowed: true, retryAfterSec: 0 };
    const remaining = entry.blockedUntil - this.now();
    if (remaining <= 0) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.ceil(remaining / 1000) };
  }

  private nextBlock(failures: number, at: number): number {
    // Shift the published 0-4 free / 5 => 30 s curve to this key's threshold.
    return at + backoffSeconds(failures - this.blockAfter + 5) * 1000;
  }

  /** Reads the current verdict without counting as an attempt. */
  check(key: string): ThrottleVerdict {
    return this.verdict(this.entries.get(key) ?? null);
  }

  /** Reads the shared verdict when configured, otherwise the local one. */
  async checkAsync(key: string): Promise<ThrottleVerdict> {
    if (!this.state) return this.check(key);
    try {
      const record = await this.state.getThrottle(key);
      const entry = record
        ? { failures: record.failures, blockedUntil: record.lockedUntil?.getTime() ?? 0 }
        : null;
      if (entry) this.entries.set(key, entry);
      else this.entries.delete(key);
      return this.verdict(entry);
    } catch (error) {
      console.warn('[login-throttle] shared store failed; using this instance.', error);
      return this.check(key);
    }
  }

  /** Records one failed attempt. A key already over the limit extends its wait. */
  fail(key: string): void {
    const entry = this.entries.get(key) ?? { failures: 0, blockedUntil: 0 };
    entry.failures += 1;
    entry.blockedUntil = this.nextBlock(entry.failures, this.now());
    this.entries.set(key, entry);
  }

  /** Shared version of fail(); the local map remains the fallback. */
  async failAsync(key: string): Promise<void> {
    if (!this.state) { this.fail(key); return; }
    const at = this.now();
    try {
      const record = await this.state.failThrottle(
        key, new Date(at), failures => new Date(this.nextBlock(failures, at)));
      this.entries.set(key, {
        failures: record.failures,
        blockedUntil: record.lockedUntil?.getTime() ?? 0,
      });
    } catch (error) {
      console.warn('[login-throttle] shared store failed; using this instance.', error);
      this.fail(key);
    }
  }

  /** A correct password clears both the count and any lockout for this key. */
  succeed(key: string): void {
    this.entries.delete(key);
  }

  /** Shared version of succeed(). */
  async succeedAsync(key: string): Promise<void> {
    this.entries.delete(key);
    if (!this.state) return;
    try {
      await this.state.clearThrottle(key);
    } catch (error) {
      console.warn('[login-throttle] shared store failed; using this instance.', error);
    }
  }
}
