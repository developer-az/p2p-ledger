import { describe, expect, it } from 'vitest';
import { rateLimiter, retryAfterSeconds } from '../src/server/rate-limit.js';

describe('rateLimiter', () => {
  it('allows up to the limit inside a window, then refuses', () => {
    const limiter = rateLimiter(3, 1_000, { now: () => 0 });
    expect(limiter('ip')).toBe(true);
    expect(limiter('ip')).toBe(true);
    expect(limiter('ip')).toBe(true);
    expect(limiter('ip')).toBe(false);
    expect(limiter.check('ip')).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('frees a slot only when the oldest hit ages out (sliding, not fixed)', () => {
    let clock = 0;
    const limiter = rateLimiter(2, 1_000, { now: () => clock });
    expect(limiter('ip')).toBe(true); // t=0
    clock = 500;
    expect(limiter('ip')).toBe(true); // t=500
    expect(limiter('ip')).toBe(false); // both hits still inside the window

    clock = 1_001; // the t=0 hit has expired, the t=500 hit has not
    expect(limiter('ip')).toBe(true);
    expect(limiter('ip')).toBe(false);
  });

  it('is isolated per key and reports how long to wait', () => {
    let clock = 0;
    const limiter = rateLimiter(1, 4_000, { now: () => clock });
    expect(limiter('a')).toBe(true);
    expect(limiter('b')).toBe(true);

    clock = 1_000;
    const verdict = limiter.check('a');
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).toBe(3_000);
    expect(retryAfterSeconds(verdict)).toBe('3');
  });

  it('reports remaining hits while a caller is still under budget', () => {
    const limiter = rateLimiter(3, 1_000, { now: () => 0 });
    expect(limiter.check('ip').remaining).toBe(2);
    expect(limiter.check('ip').remaining).toBe(1);
    expect(limiter.check('ip').remaining).toBe(0);
  });

  it('never tells a client to retry in zero seconds', () => {
    expect(retryAfterSeconds({ allowed: false, retryAfterMs: 0, remaining: 0 })).toBe('1');
    expect(retryAfterSeconds({ allowed: false, retryAfterMs: 40, remaining: 0 })).toBe('1');
  });

  it('bounds memory by evicting the oldest-inserted keys', () => {
    const limiter = rateLimiter(5, 1_000, { now: () => 0, maxKeys: 2 });
    limiter('a');
    limiter('b');
    limiter('c');
    expect(limiter.size()).toBe(2);
  });
});
